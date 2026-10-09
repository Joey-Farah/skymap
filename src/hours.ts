import type { Building, DayHours, RouteResult } from "./types.ts";

/**
 * Whether a building is open, when that is something we actually know.
 *
 * `hours: null` means nobody publishes them — a different thing from a
 * building that is closed, and the distinction has teeth here because the
 * router filters on this. Every unverified building used to inherit the
 * city ordinance (Mo-Fr 06:30-22:00, Sa 09:30-20:00, Su 12:00-18:00), and
 * the City's own 2025 committee record says most skyway buildings do not
 * keep it — "most skyway connected buildings are open Monday through
 * Friday until 6:00 p.m. and are closed on weekends". So the default was
 * routing people through towers that had been locked for four hours.
 *
 * Replacing one guess with a stricter guess would have been the same
 * mistake pointed the other way, and would refuse paths that are genuinely
 * open. Unknown therefore asserts nothing: it does not claim the building
 * is open, it declines to claim it is shut, and the route stands or falls
 * on what is actually known about it.
 */
export function isOpenAt(building: Building, when: Date): boolean {
  if (building.hours === null) return true;
  return windowAt(building.hours, when) !== null;
}

/** True when a building is open right now but closes within `thresholdMin`. */
export function isClosingSoon(building: Building, when: Date, thresholdMin = 20): boolean {
  if (building.hours === null) return false; // nothing known to be ending
  const w = windowAt(building.hours, when);
  if (!w || isAllDay(w)) return false; // a place that never closes is never closing soon
  return w.close - minuteOf(when) <= thresholdMin;
}

/** One stretch of opening, in minutes after some day's midnight. */
interface OpenWindow {
  open: number;
  close: number;
}

/** A day's windows, in order. See DayHours for the encoding. */
function windowsOf(h: DayHours): OpenWindow[] {
  const windows: OpenWindow[] = [];
  for (let i = 0; h && i + 1 < h.length; i += 2) windows.push({ open: h[i], close: h[i + 1] });
  return windows;
}

const minuteOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

/**
 * The window `when` falls in, in minutes after `when`'s own midnight: one
 * of today's, or last night's still running past midnight (its open is
 * then negative). Without the second half, a bar open 4pm–2am read
 * "Closed · opens 4pm" at 1am, under a table saying 4pm–2am (QA 007).
 */
function windowAt(hours: DayHours[], when: Date): OpenWindow | null {
  const day = when.getDay();
  const now = minuteOf(when);
  const today = windowsOf(hours[day]).find((w) => now >= w.open && now < w.close);
  if (today) return today;
  const lastNight = windowsOf(hours[(day + 6) % 7]).find((w) => now < w.close - 1440);
  return lastNight ? { open: lastNight.open - 1440, close: lastNight.close - 1440 } : null;
}

/** When it next opens after `when` — later today (daysAhead 0) or on a
 * coming day — or null if it never does. */
function nextOpening(hours: DayHours[], when: Date): { daysAhead: number; minute: number } | null {
  const day = when.getDay();
  const later = windowsOf(hours[day]).find((w) => w.open > minuteOf(when));
  if (later) return { daysAhead: 0, minute: later.open };
  for (let i = 1; i <= 7; i++) {
    const first = windowsOf(hours[(day + i) % 7])[0];
    if (first) return { daysAhead: i, minute: first.open };
  }
  return null;
}

/** "tomorrow", or the day's short name. */
function dayAhead(when: Date, daysAhead: number): string {
  return daysAhead === 1 ? "tomorrow" : DAY_NAMES[(when.getDay() + daysAhead) % 7];
}

/** Open from midnight to midnight or beyond — this codebase's encoding of
 * "never closes". parseOpeningHours maps `24/7` to exactly [0, 1440] on
 * every day. */
function isAllDay(w: OpenWindow): boolean {
  return w.open <= 0 && w.close >= 1440;
}

/** A day as read in a table or a one-line summary: "7am–4pm", or
 * "6:30–9:30am, 5–10pm" — or null when closed all day. */
function formatDay(h: DayHours): string | null {
  const windows = windowsOf(h);
  if (!windows.length) return null;
  if (windows.some(isAllDay)) return "Open 24 hours";
  return windows.map((w) => `${formatMinute(w.open)}–${formatMinute(w.close)}`).join(", ");
}

export function formatMinute(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ampm = h24 >= 12 ? "pm" : "am";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** e.g. "Tue 12:15pm" */
export function formatWhen(d: Date): string {
  return `${DAY_NAMES[d.getDay()]} ${formatMinute(d.getHours() * 60 + d.getMinutes())}`;
}

/** Compact weekly hours summary, grouping consecutive identical days. */
export function formatWeeklyHours(hours: DayHours[]): string {
  // Walk Monday-first for natural reading order.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups: { days: number[]; h: DayHours }[] = [];
  for (const d of order) {
    const h = hours[d];
    const last = groups[groups.length - 1];
    if (last && JSON.stringify(last.h) === JSON.stringify(h)) last.days.push(d);
    else groups.push({ days: [d], h });
  }
  return groups
    .map((g) => {
      const label =
        g.days.length === 1
          ? DAY_NAMES[g.days[0]]
          : `${DAY_NAMES[g.days[0]]}–${DAY_NAMES[g.days[g.days.length - 1]]}`;
      return `${label} ${formatDay(g.h) ?? "closed"}`;
    })
    .join(" · ");
}

export interface WeeklyHoursRow {
  day: string;
  value: string;
  closed: boolean;
  today: boolean;
}

/** The week as seven rows, for rendering as an actual table.
 *
 * formatWeeklyHours() collapses runs into "Mon–Fri 7am–4pm · Sat–Sun closed",
 * which is compact but reads as a run-on sentence — you have to parse a
 * string to answer "what about Thursday?". A row per day is scannable at a
 * glance and is what every other maps app shows. The grouped string stays
 * for the issue-report text, where one line is the point.
 */
export function weeklyHoursRows(hours: DayHours[], when: Date): WeeklyHoursRow[] {
  const today = when.getDay();
  // Monday-first: the working week reads as a block rather than being split
  // across the top and bottom of the list.
  return [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const value = formatDay(hours[d]);
    return {
      // Full names here, unlike the abbreviations used inline in sentences
      // elsewhere: in a table each name sits on its own row with room to
      // spare, and "Wednesday" is read without the beat of expanding "Wed".
      day: DAY_NAMES_FULL[d],
      value: value ?? "Closed",
      closed: value === null,
      today: d === today,
    };
  });
}

/**
 * The next date falling on `day` (0=Sun) at `minuteOfDay`, at or after `from`.
 * A slot earlier today rolls to the same weekday next week.
 */
export function nextOccurrence(day: number, minuteOfDay: number, from = new Date()): Date {
  const d = new Date(from);
  d.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  let ahead = (day - from.getDay() + 7) % 7;
  if (ahead === 0 && d.getTime() < from.getTime()) ahead = 7;
  d.setDate(d.getDate() + ahead);
  return d;
}

/**
 * When the walker reaches `step`, setting off at `when`: the street walk to
 * the skyway first, if the trip has one, then the skyway walk to that step.
 * The one clock the step list and both closing warnings read. Worked out in
 * each place separately, they disagreed about whether a building would be
 * open — the list left out the street walk (QA 006).
 */
export function stepArrival(route: Pick<RouteResult, "approach">, step: { arrivalMinutes: number }, when: Date): Date {
  return new Date(when.getTime() + ((route.approach?.minutes ?? 0) + step.arrivalMinutes) * 60_000);
}

export interface ClosureWarning {
  building: Building;
  /** Minutes between the walker's arrival and the building closing. */
  minutesLeft: number;
  label: string;
}

/**
 * Buildings along the route that close within `thresholdMin` minutes of the
 * walker reaching them, given a departure at `when` — tightest first.
 *
 * The preview shows only the first two, so the order decides what anyone
 * sees: in route order, the destination locking 2 minutes after arrival hid
 * behind the building you were standing in, 20 minutes from closing
 * (QA 050). That building is left out when the trip starts inside it.
 */
export function closingSoonWarnings(
  route: RouteResult,
  when: Date,
  thresholdMin = 30,
): ClosureWarning[] {
  const warnings: ClosureWarning[] = [];
  route.steps.forEach((step, i) => {
    if (i === 0 && !route.approach) return; // you're in it, and leaving now
    const arrival = stepArrival(route, step, when);
    if (step.building.hours === null) return; // no published hours to close
    const w = windowAt(step.building.hours, arrival);
    if (!w) return; // not open on arrival
    if (isAllDay(w)) return; // never closes, so never closes soon after you arrive
    const minutesLeft = w.close - minuteOf(arrival);
    if (minutesLeft <= thresholdMin) {
      warnings.push({
        building: step.building,
        minutesLeft,
        label: `${step.building.name} closes at ${formatMinute(w.close)} — ${minutesLeft} min after you'd arrive`,
      });
    }
  });
  return warnings.sort((a, b) => a.minutesLeft - b.minutesLeft);
}

/**
 * Why the destination will be shut when the walker gets there, or null.
 *
 * The router never refuses a destination for its hours — you chose it, and
 * may be meeting someone at its door — so this is the only place a closed
 * destination surfaces. Unknown hours assert nothing, as in isOpenAt.
 */
export function destinationClosedWarning(route: Pick<RouteResult, "steps" | "approach">, when: Date): string | null {
  const last = route.steps[route.steps.length - 1];
  if (!last || route.steps.length < 2) return null;
  const arrival = stepArrival(route, last, when);
  if (isOpenAt(last.building, arrival)) return null;
  const name = last.building.name;
  const today = windowsOf(last.building.hours?.[arrival.getDay()] ?? null);
  const now = minuteOf(arrival);
  // Between two windows, the one still to come is the useful thing to say.
  const opens = today.find((w) => w.open > now);
  if (opens) return `${name} opens at ${formatMinute(opens.open)}, after you'd arrive`;
  const closed = today.filter((w) => w.close <= now).pop();
  if (closed) return `${name} closes at ${formatMinute(closed.close)}, before you'd arrive`;
  return `${name} is closed when you'd arrive`;
}

/**
 * Why the building a street walk leads to will be locked when the walker
 * reaches it, or null. nearestApproach prefers an open way in, but with
 * none in range it falls back to the nearest — and that has to be said,
 * not left to a "(closed)" in a collapsed step list (QA 009).
 */
export function approachClosedWarning(route: Pick<RouteResult, "steps" | "approach">, when: Date): string | null {
  const first = route.steps[0];
  if (!route.approach || !first) return null;
  if (isOpenAt(first.building, stepArrival(route, first, when))) return null;
  return `${first.building.name} is closed when you'd get there`;
}

/** Human description of a weekly-hours status at `when`, e.g. "Open until
 * 10pm" — the logic `statusAt` uses for buildings, but not tied to one,
 * so a POI's own (separately parsed) hours can get the same treatment. */
export function statusFromHours(hours: DayHours[], when: Date): { open: boolean; label: string } {
  const w = windowAt(hours, when);
  if (w) {
    // 1440 formats as "12am", which at 11:45pm reads as fifteen minutes'
    // notice for somewhere that never shuts — five downtown garages and
    // The Nicollet Diner among them.
    if (isAllDay(w)) return { open: true, label: "Open 24 hours" };
    return { open: true, label: `Open until ${formatMinute(w.close)}` };
  }
  const next = nextOpening(hours, when);
  if (!next) return { open: false, label: "Closed" };
  if (next.daysAhead === 0) return { open: false, label: `Closed · opens ${formatMinute(next.minute)}` };
  return { open: false, label: `Closed · opens ${dayAhead(when, next.daysAhead)} ${formatMinute(next.minute)}` };
}

/** When you can physically reach a place through the skyway, which is a
 * different question from whether the business itself is serving — and the
 * only one we can answer for every POI, since every building has hours
 * while most businesses don't.
 *
 * Deliberately worded "Access …" rather than "Open …": the business's own
 * open/closed badge already owns that phrasing, and a second "Open until"
 * on the same card is exactly how someone reads the building's hours as
 * the restaurant's. Returns null when there's nothing usable, so the caller
 * omits the row instead of guessing.
 */
export function skywayAccessLabel(hours: DayHours[] | undefined, when: Date): string | null {
  if (!hours) return null;
  const w = windowAt(hours, when);
  if (w) return isAllDay(w) ? "Access 24 hours" : `Access until ${formatMinute(w.close)}`;
  const next = nextOpening(hours, when);
  if (!next) return null;
  if (next.daysAhead === 0) return `Access from ${formatMinute(next.minute)}`;
  return `Access from ${formatMinute(next.minute)} ${dayAhead(when, next.daysAhead)}`;
}

/** Human description of the building's status at `when`, e.g. "Open until
 * 10pm" — or null when nobody publishes hours for it, so the caller omits
 * the badge rather than picking between "Open" and "Closed" on no
 * evidence. */
export function statusAt(building: Building, when: Date): { open: boolean; label: string } | null {
  if (building.hours === null) return null;
  return statusFromHours(building.hours, when);
}
