import type { Building, DayHours } from "./types.ts";

export function isOpenAt(building: Building, when: Date): boolean {
  const day = when.getDay();
  const minutes = when.getHours() * 60 + when.getMinutes();
  const h: DayHours = building.hours[day];
  return h !== null && minutes >= h[0] && minutes < h[1];
}

export function formatMinute(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ampm = h24 >= 12 ? "pm" : "am";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

/** Human description of the building's status at `when`, e.g. "Open until 10pm". */
export function statusAt(building: Building, when: Date): { open: boolean; label: string } {
  const day = when.getDay();
  const minutes = when.getHours() * 60 + when.getMinutes();
  const today = building.hours[day];
  if (today && minutes >= today[0] && minutes < today[1]) {
    return { open: true, label: `Open until ${formatMinute(today[1])}` };
  }
  if (today && minutes < today[0]) {
    return { open: false, label: `Closed · opens ${formatMinute(today[0])}` };
  }
  // Find the next day with hours.
  for (let i = 1; i <= 7; i++) {
    const h = building.hours[(day + i) % 7];
    if (h) {
      const dayLabel = i === 1 ? "tomorrow" : DAY_NAMES[(day + i) % 7];
      return { open: false, label: `Closed · opens ${dayLabel} ${formatMinute(h[0])}` };
    }
  }
  return { open: false, label: "Closed" };
}
