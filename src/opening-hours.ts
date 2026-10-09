import type { DayHours } from "./types.ts";

/**
 * Parses a (subset of) the OSM opening_hours syntax into the app's
 * DayHours[7] model, indexed like Date#getDay() (0 = Sunday).
 *
 * Only the constructs actually seen in the downtown Minneapolis extract
 * are supported: semicolon rules, comma-joined additional rules, day
 * ranges/lists, split hours ("08:00-12:00,13:00-17:00"), closes after
 * midnight (either "20:00-02:00" or "20:00-26:00"), "24/7", "off", and PH
 * (public holiday — skipped, not modeled).
 *
 * Anything else — a month scope, an nth weekday — marks the WHOLE value
 * unresolved: the entire tag is discarded, not just that day, so a good
 * day never gets kept alongside a guessed one. Returns null when nothing
 * usable was found, so the caller can fall back to another source (a
 * different tag, then the generic schedule).
 */

const CHRONO = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
// Storage index matches Date#getDay(): Sunday = 0.
const DAY_INDEX: Record<string, number> = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };
const DAY_TOKEN = /^(Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/;

function expandDayToken(token: string): string[] {
  const m = DAY_TOKEN.exec(token);
  if (!m) return [];
  if (m[1] === "PH") return ["PH"];
  if (!m[2]) return [m[1]];
  const start = CHRONO.indexOf(m[1] as (typeof CHRONO)[number]);
  const end = CHRONO.indexOf(m[2] as (typeof CHRONO)[number]);
  const days: string[] = [];
  for (let i = start; ; i = (i + 1) % 7) {
    days.push(CHRONO[i]);
    if (i === end) break;
  }
  return days;
}

const DAY_LIST = "(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?";
// Whitespace after the comma is common in the wild and means nothing:
// two Naf Naf branches differ only by one space ("Sa,Su off" vs
// "Sa, Su off"), and the spaced one had its whole tag discarded, so its
// card read "Hours unknown" for hours that are perfectly well known.
const LEADING_DAY_SPEC = new RegExp(`^${DAY_LIST}(?:\\s*,\\s*${DAY_LIST})*`);

/** Splits a leading day-spec ("Mo-Fr", "Mo,We,Fr", "PH") off a clause.
 *
 * Returns null when the clause opens with something that is neither a
 * day-spec nor the time itself — a month scope, most usefully. OSM writes
 * seasonal hours as "Sep-May Mo-Fr 09:00-21:00", and treating a missing
 * day-spec as "every day" swallowed both the months and the Mo-Fr,
 * yielding a confident all-week schedule from a rule that applied to five
 * days of the year's back half. MacPhail publishes exactly this shape, so
 * it is not hypothetical. A null here taints the whole value, which is the
 * honest outcome: this parser holds one week, and a seasonal schedule is
 * not one week.
 */
function parseDaySpec(clause: string): { days: string[]; rest: string } | null {
  const match = LEADING_DAY_SPEC.exec(clause);
  if (match) {
    return {
      // Split on the same optional whitespace LEADING_DAY_SPEC allows, or
      // " Su" fails DAY_TOKEN and drops out silently (QA 033).
      days: match[0].split(/\s*,\s*/).flatMap(expandDayToken),
      rest: clause.slice(match[0].length).trim(),
    };
  }
  // No day-spec is legitimate only when the clause is the schedule itself.
  const rest = clause.trim();
  if (/^(?:\d{1,2}:\d{2}|24\/7|off|closed)/i.test(rest)) return { days: [...CHRONO], rest };
  return null;
}

const TIME_RANGE = /(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/g;

/**
 * A clause's open windows as flat [open, close] pairs (see DayHours), or
 * null when no time range leads it. Each range is its own window, so split
 * hours keep their gap rather than being spanned over it. A close at or
 * before the open runs past midnight: "20:00-02:00" is 8pm-2am, as
 * "20:00-26:00" spells the same thing.
 */
function parseWindows(rest: string): number[] | null {
  if (/^24\/7$/.test(rest)) return [0, 1440];
  // The time has to come first. Anything between the day-spec and it is
  // syntax this parser doesn't hold — "Su[4] 17:00-18:00" is the 4th Sunday
  // of the month, and ignoring the [4] showed a monthly free meal as open
  // every Sunday (QA 008). Text after the time (a quoted note) is fine.
  if (!/^\d{1,2}:\d{2}/.test(rest)) return null;
  const windows: number[] = [];
  for (const m of rest.matchAll(TIME_RANGE)) {
    const open = Number(m[1]) * 60 + Number(m[2]);
    const close = Number(m[3]) * 60 + Number(m[4]);
    windows.push(open, close > open ? close : close + 1440);
  }
  return windows.length ? merged(windows) : null;
}

/** Windows in order, with any that overlap or touch joined into one. */
function merged(windows: number[]): number[] {
  const pairs: [number, number][] = [];
  for (let i = 0; i + 1 < windows.length; i += 2) pairs.push([windows[i], windows[i + 1]]);
  pairs.sort((a, b) => a[0] - b[0]);
  const out: number[] = [];
  for (const [open, close] of pairs) {
    if (out.length && open <= out[out.length - 1]) out[out.length - 1] = Math.max(out[out.length - 1], close);
    else out.push(open, close);
  }
  return out;
}

export function parseOpeningHours(value: string | undefined | null): DayHours[] | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^off$/i.test(trimmed)) return null;
  if (/^24\/7$/.test(trimmed)) return Array(7).fill([0, 1440]) as DayHours[];

  // ';' starts a rule that replaces the hours of the days it names. A ','
  // after a completed time range starts an additional rule, which adds to
  // them: "Mo-Fr 06:30-09:30, Mo-Fr 17:00-22:00" is breakfast and dinner.
  // Read as a replacement, breakfast vanished (QA 034). On different days
  // ("Mo-Fr 08:30-17:00, Sa …") the two readings agree.
  const rules = trimmed.split(";").flatMap((r) =>
    r.split(/(?<=\d),\s*(?=[A-Z])/).map((clause, i) => ({ clause, adds: i > 0 })),
  );

  const result: (DayHours | undefined)[] = Array(7).fill(undefined);
  let unresolved = false;
  for (const rule of rules) {
    const clause = rule.clause.trim();
    if (!clause) continue;
    const spec = parseDaySpec(clause);
    if (!spec) {
      unresolved = true; // month scope or other syntax this parser cannot hold
      continue;
    }
    const { days, rest } = spec;
    const dayIndices = days.filter((d) => d !== "PH").map((d) => DAY_INDEX[d]);
    if (!dayIndices.length) continue; // PH-only clause: not modeled
    // "closed" is an accepted synonym for "off" in opening_hours. Not
    // recognising it discarded the entire tag, not just the clause.
    if (/^(off|closed)$/i.test(rest)) {
      // Later rule wins, exactly as it does for a time span below. Guarding
      // this on "untouched so far" made `off` the one clause type that
      // couldn't override an earlier rule, so the common "open all week
      // except Tuesday" pattern left Tuesday reading as open.
      for (const i of dayIndices) result[i] = null;
      continue;
    }
    const windows = parseWindows(rest);
    if (!windows) {
      unresolved = true; // unparseable: taint the whole value
      continue;
    }
    for (const i of dayIndices) result[i] = rule.adds && result[i] ? merged([...result[i]!, ...windows]) : windows;
  }
  if (unresolved) return null;

  const days: DayHours[] = result.map((d) => d ?? null);
  if (days.every((d) => d === null)) return null;
  return days;
}
