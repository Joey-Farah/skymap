/**
 * SkyMap Supporters: businesses that pay to help keep SkyMap free, and in
 * return get a glow behind their pin when a filter they're in is on, plus a
 * tag on their card. The decisions behind every rule here are in
 * docs/adr/0002-supporters-highlight-never-rank.md.
 *
 * The list ships inside the app (data/supporters.json), so a term starts
 * only with a release but ends on its own: each phone compares its own date
 * with the term. Nothing here touches search, routes, or which pins and
 * names the map places.
 */

import { statusFromHours } from "./hours.ts";
import { parseOpeningHours } from "./opening-hours.ts";

/** One paid term, as written in data/supporters.json. */
export interface SupporterEntry {
  /** The POI id, e.g. "poi-12862838545". */
  id: string;
  /** The place's name as it was when the term was sold. A mismatch means
   * the OSM id now points at something else (see checkSupporters). */
  name: string;
  /** First and last day of the term, "YYYY-MM-DD", both inclusive. */
  from: string;
  until: string;
  /** The invoice it was paid on. */
  ref?: string;
  founding?: boolean;
}

/** The phone's local day as "YYYY-MM-DD": the same clock the opening hours
 * use, so a term and a place's hours never disagree about what day it is. */
function localDay(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

/** The entries whose term covers `when`'s day. */
export function activeSupporters(list: SupporterEntry[], when: Date): SupporterEntry[] {
  const today = localDay(when);
  return list.filter((s) => s.from <= today && today <= s.until);
}

/** The supporters whose pins glow at `when`: their term covers the day, and
 * their place isn't known to be closed. A glow says "go here", and pointing
 * someone at a shut door wastes their walk. Known means the place's own
 * published hours, the same ones its card reads from; no hours, or hours we
 * can't read, leave the glow on. */
export function glowingSupporters(
  list: SupporterEntry[],
  places: { id: string; openingHours?: string }[],
  when: Date,
): SupporterEntry[] {
  const byId = new Map(places.map((p) => [p.id, p]));
  return activeSupporters(list, when).filter((s) => {
    const place = byId.get(s.id);
    if (!place) return false;
    const hours = parseOpeningHours(place.openingHours);
    return !hours || statusFromHours(hours, when).open;
  });
}

/** Which filters can carry a supporter, and how many at once in each.
 * Rare enough that the glow still means something, and part of what a
 * supporter buys ("one of at most 3"). Raise a cap when businesses are being
 * turned away; lowering one would mean removing someone who paid. */
export const SUPPORTER_CAPS: Readonly<Record<string, number>> = { coffee: 3, food: 8 };

type PlaceForCheck = { id: string; name: string; group: string; buildingId: string; nearby?: boolean };

/** A real calendar day written "YYYY-MM-DD". */
function isDay(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

const overlaps = (a: SupporterEntry, b: SupporterEntry) => a.from <= b.until && b.from <= a.until;

/** Everything wrong with a supporter list, as sentences; empty when it can
 * ship. The build runs this (scripts/check-supporters.mjs), so a list that
 * names a place that's gone, renamed, ineligible, or over a cap never
 * reaches a release. */
export function checkSupporters(list: SupporterEntry[], places: PlaceForCheck[]): string[] {
  const problems: string[] = [];
  const byId = new Map(places.map((p) => [p.id, p]));
  const sound: { s: SupporterEntry; place: PlaceForCheck }[] = [];

  for (const s of list) {
    const place = byId.get(s.id);
    let ok = true;
    if (!place) {
      problems.push(`${s.id} (${s.name}): not on the map`);
      continue;
    }
    if (!(place.group in SUPPORTER_CAPS)) {
      problems.push(`${s.id} (${s.name}): is a ${place.group} place; only ${Object.keys(SUPPORTER_CAPS).join(" and ")} can have supporters`);
      ok = false;
    }
    if (place.name !== s.name) {
      problems.push(`${s.id}: sold as "${s.name}" but the map now calls it "${place.name}"; check it's the same business`);
      ok = false;
    }
    if (!isDay(s.from)) {
      problems.push(`${s.id}: from "${s.from}" isn't a real day (YYYY-MM-DD)`);
      ok = false;
    }
    if (!isDay(s.until)) {
      problems.push(`${s.id}: until "${s.until}" isn't a real day (YYYY-MM-DD)`);
      ok = false;
    }
    if (ok && s.until < s.from) {
      problems.push(`${s.id}: ends before it starts (${s.from} to ${s.until})`);
      ok = false;
    }
    if (ok) sound.push({ s, place });
  }

  for (const [group, cap] of Object.entries(SUPPORTER_CAPS)) {
    const inGroup = sound.filter((x) => x.place.group === group).map((x) => x.s);
    // The most at once is always reached on some term's first day.
    const starts = [...new Set(inGroup.map((s) => s.from))].sort();
    for (const day of starts) {
      const count = inGroup.filter((s) => s.from <= day && day <= s.until).length;
      if (count > cap) {
        problems.push(`${group}: ${count} supporters on ${day}; the limit is ${cap}`);
        break;
      }
    }
  }

  for (let i = 0; i < sound.length; i++) {
    for (let j = i + 1; j < sound.length; j++) {
      const a = sound[i], b = sound[j];
      // A "nearby" place is outside the skyway: its buildingId is only the
      // closest skyway building, not one it shares with the places inside.
      if (a.place.nearby || b.place.nearby) continue;
      if (a.place.group === b.place.group && a.place.buildingId === b.place.buildingId && overlaps(a.s, b.s)) {
        problems.push(`building ${a.place.buildingId}: two ${a.place.group} supporters at once (${a.s.id}, ${b.s.id}); the limit is one per building`);
      }
    }
  }
  return problems;
}
