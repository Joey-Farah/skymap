import type { DayHours } from "./types.ts";

/**
 * Parses a (subset of) the OSM opening_hours syntax into the app's
 * DayHours[7] model, indexed like Date#getDay() (0 = Sunday).
 *
 * Only the constructs actually seen in the downtown Minneapolis extract
 * are supported: semicolon rules, day ranges/lists, "24/7", "off", PH
 * (public holiday — skipped, not modeled), and comma used non-standardly
 * as a rule separator. Overnight wraps (close <= open) are dropped rather
 * than guessed at — the app has no representation for "past midnight",
 * and a wrong guess is worse than falling back to the caller's default.
 * Returns null when nothing usable was found, so the caller can fall back
 * to another source (a different tag, then the generic schedule).
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
const LEADING_DAY_SPEC = new RegExp(`^${DAY_LIST}(?:,${DAY_LIST})*`);

/** Splits a leading day-spec ("Mo-Fr", "Mo,We,Fr", "PH") off a clause. */
function parseDaySpec(clause: string): { days: string[]; rest: string } {
  const match = LEADING_DAY_SPEC.exec(clause);
  if (!match) return { days: [...CHRONO], rest: clause.trim() };
  return {
    days: match[0].split(",").flatMap(expandDayToken),
    rest: clause.slice(match[0].length).trim(),
  };
}

const TIME_RANGE = /(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/g;

function parseTimeSpans(rest: string): [number, number] | null {
  const spans: [number, number][] = [];
  for (const m of rest.matchAll(TIME_RANGE)) {
    const open = Number(m[1]) * 60 + Number(m[2]);
    const close = Number(m[3]) * 60 + Number(m[4]);
    if (close > open) spans.push([open, close]);
  }
  if (!spans.length) return null;
  const open = Math.min(...spans.map((s) => s[0]));
  const close = Math.max(...spans.map((s) => s[1]));
  return [open, close];
}

export function parseOpeningHours(value: string | undefined | null): DayHours[] | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^off$/i.test(trimmed)) return null;
  if (/^24\/7$/.test(trimmed)) return Array(7).fill([0, 1440]) as DayHours[];

  // Split on ';' (the standard separator), and additionally on a ','
  // immediately after a completed time range — real-world data sometimes
  // uses a comma where a semicolon belongs ("Mo-Fr 08:30-17:00, Sa …").
  const rules = trimmed.split(";").flatMap((r) => r.split(/(?<=\d),\s*(?=[A-Z])/));

  const result: (DayHours | undefined)[] = Array(7).fill(undefined);
  for (const rule of rules) {
    const clause = rule.trim();
    if (!clause) continue;
    const { days, rest } = parseDaySpec(clause);
    const dayIndices = days.filter((d) => d !== "PH").map((d) => DAY_INDEX[d]);
    if (!dayIndices.length) continue; // PH-only clause: not modeled
    if (/^off$/i.test(rest)) {
      for (const i of dayIndices) if (result[i] === undefined) result[i] = null;
      continue;
    }
    const span = parseTimeSpans(rest);
    if (!span) continue; // unparseable or fully wrapped: leave untouched
    for (const i of dayIndices) result[i] = span;
  }

  const days: DayHours[] = result.map((d) => d ?? null);
  if (days.every((d) => d === null)) return null;
  return days;
}
