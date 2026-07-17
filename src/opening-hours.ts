import type { DayHours } from "./types.ts";

/**
 * Parses a (subset of) the OSM opening_hours syntax into the app's
 * DayHours[7] model, indexed like Date#getDay() (0 = Sunday).
 *
 * Only the constructs actually seen in the downtown Minneapolis extract
 * are supported: semicolon rules, day ranges/lists, "24/7", "off", PH
 * (public holiday — skipped, not modeled), and comma used non-standardly
 * as a rule separator.
 *
 * The DayHours model can only express one open/closed window per day, but
 * OSM can express things it can't hold — split hours ("08:00-12:00,
 * 13:00-17:00", a lunch closure) and overnight wraps ("Fr 20:00-02:00").
 * Rather than approximate those into something that fits (e.g. collapsing
 * split hours to their outer span, which would falsely claim "open" during
 * the actual midday closure), any clause the model can't represent marks
 * the WHOLE value unresolved: the entire tag is discarded, not just that
 * day, so a good day never gets kept alongside a guessed one. Returns null
 * when nothing usable was found, so the caller can fall back to another
 * source (a different tag, then the generic schedule).
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

/**
 * A single unambiguous open/close window, or null when the value can't be
 * represented by one: no time range found, every range wraps past
 * midnight (close <= open), or more than one non-wrapping range is present
 * (split hours — collapsing to their outer span would invent an "open"
 * period across the actual gap).
 */
function parseTimeSpan(rest: string): [number, number] | null {
  if (/^24\/7$/.test(rest)) return [0, 1440];
  const spans: [number, number][] = [];
  for (const m of rest.matchAll(TIME_RANGE)) {
    const open = Number(m[1]) * 60 + Number(m[2]);
    const close = Number(m[3]) * 60 + Number(m[4]);
    if (close > open) spans.push([open, close]);
  }
  return spans.length === 1 ? spans[0] : null;
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
  let unresolved = false;
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
    const span = parseTimeSpan(rest);
    if (!span) {
      unresolved = true; // wraps, split hours, or unparseable: taint the whole value
      continue;
    }
    for (const i of dayIndices) result[i] = span;
  }
  if (unresolved) return null;

  const days: DayHours[] = result.map((d) => d ?? null);
  if (days.every((d) => d === null)) return null;
  return days;
}
