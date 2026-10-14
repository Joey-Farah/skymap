/**
 * SkyMap Supporters: businesses that pay to help keep SkyMap free, and in
 * return get a glow behind their pin when a filter they're in is on, plus a
 * tag on their card. The decisions behind every rule here are in
 * docs/business-listings-plan.md.
 *
 * The list ships inside the app (data/supporters.json), so a term starts
 * only with a release but ends on its own: each phone compares its own date
 * with the term. Nothing here touches search, routes, or which pins and
 * names the map places.
 */

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
