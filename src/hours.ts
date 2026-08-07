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
  const day = when.getDay();
  const minutes = when.getHours() * 60 + when.getMinutes();
  const h: DayHours = building.hours[day];
  return h !== null && minutes >= h[0] && minutes < h[1];
}

/** True when a building is open right now but closes within `thresholdMin`. */
export function isClosingSoon(building: Building, when: Date, thresholdMin = 20): boolean {
  if (building.hours === null) return false; // nothing known to be ending
  const day = when.getDay();
  const minutes = when.getHours() * 60 + when.getMinutes();
  const h = building.hours[day];
  if (!h || minutes < h[0] || minutes >= h[1]) return false;
  if (isAllDay(h)) return false; // a place that never closes is never closing soon
  return h[1] - minutes <= thresholdMin;
}

/** A day encoded as open from midnight to midnight — this codebase's
 * representation of "never closes". parseOpeningHours maps `24/7` to
 * exactly [0, 1440] on every day. */
export function isAllDay(h: DayHours): boolean {
  return !!h && h[0] === 0 && h[1] >= 1440;
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
      const value = g.h ? `${formatMinute(g.h[0])}–${formatMinute(g.h[1])}` : "closed";
      return `${label} ${value}`;
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
    const h = hours[d];
    return {
      // Full names here, unlike the abbreviations used inline in sentences
      // elsewhere: in a table each name sits on its own row with room to
      // spare, and "Wednesday" is read without the beat of expanding "Wed".
      day: DAY_NAMES_FULL[d],
      value: !h ? "Closed" : isAllDay(h) ? "Open 24 hours" : `${formatMinute(h[0])}–${formatMinute(h[1])}`,
      closed: !h,
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

export interface ClosureWarning {
  building: Building;
  /** Minutes between the walker's arrival and the building closing. */
  minutesLeft: number;
  label: string;
}

/**
 * Buildings along the route that close within `thresholdMin` minutes of the
 * walker reaching them, given a departure at `when`.
 */
export function closingSoonWarnings(
  route: RouteResult,
  when: Date,
  thresholdMin = 30,
): ClosureWarning[] {
  const warnings: ClosureWarning[] = [];
  for (const step of route.steps) {
    const arrival = new Date(when.getTime() + step.arrivalMinutes * 60_000);
    if (step.building.hours === null) continue; // no published hours to close
    const h = step.building.hours[arrival.getDay()];
    if (!h) continue;
    const arrivalMin = arrival.getHours() * 60 + arrival.getMinutes();
    if (arrivalMin < h[0] || arrivalMin >= h[1]) continue; // not open on arrival
    if (isAllDay(h)) continue; // never closes, so never closes soon after you arrive
    const minutesLeft = h[1] - arrivalMin;
    if (minutesLeft <= thresholdMin) {
      warnings.push({
        building: step.building,
        minutesLeft,
        label: `${step.building.name} closes at ${formatMinute(h[1])} — ${minutesLeft} min after you'd arrive`,
      });
    }
  }
  return warnings;
}

/** Human description of a weekly-hours status at `when`, e.g. "Open until
 * 10pm" — the logic `statusAt` uses for buildings, but not tied to one,
 * so a POI's own (separately parsed) hours can get the same treatment. */
export function statusFromHours(hours: DayHours[], when: Date): { open: boolean; label: string } {
  const day = when.getDay();
  const minutes = when.getHours() * 60 + when.getMinutes();
  const today = hours[day];
  if (today && minutes >= today[0] && minutes < today[1]) {
    // 1440 formats as "12am", which at 11:45pm reads as fifteen minutes'
    // notice for somewhere that never shuts — five downtown garages and
    // The Nicollet Diner among them.
    if (isAllDay(today)) return { open: true, label: "Open 24 hours" };
    return { open: true, label: `Open until ${formatMinute(today[1])}` };
  }
  if (today && minutes < today[0]) {
    return { open: false, label: `Closed · opens ${formatMinute(today[0])}` };
  }
  // Find the next day with hours.
  for (let i = 1; i <= 7; i++) {
    const h = hours[(day + i) % 7];
    if (h) {
      const dayLabel = i === 1 ? "tomorrow" : DAY_NAMES[(day + i) % 7];
      return { open: false, label: `Closed · opens ${dayLabel} ${formatMinute(h[0])}` };
    }
  }
  return { open: false, label: "Closed" };
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
  if (!hours || hours.every((h) => !h)) return null;
  const day = when.getDay();
  const minutes = when.getHours() * 60 + when.getMinutes();
  const today = hours[day];
  if (today && minutes >= today[0] && minutes < today[1]) {
    return isAllDay(today) ? "Access 24 hours" : `Access until ${formatMinute(today[1])}`;
  }
  if (today && minutes < today[0]) {
    return `Access from ${formatMinute(today[0])}`;
  }
  for (let i = 1; i <= 7; i++) {
    const h = hours[(day + i) % 7];
    if (h) {
      const dayLabel = i === 1 ? "tomorrow" : DAY_NAMES[(day + i) % 7];
      return `Access from ${formatMinute(h[0])} ${dayLabel}`;
    }
  }
  return null;
}

/** Human description of the building's status at `when`, e.g. "Open until
 * 10pm" — or null when nobody publishes hours for it, so the caller omits
 * the badge rather than picking between "Open" and "Closed" on no
 * evidence. */
export function statusAt(building: Building, when: Date): { open: boolean; label: string } | null {
  if (building.hours === null) return null;
  return statusFromHours(building.hours, when);
}
