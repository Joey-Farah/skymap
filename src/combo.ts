import type { Building, Poi } from "./types.ts";

/** One searchable result in the from/to picker: a building or a business inside one. */
export interface ComboEntry {
  label: string;
  sublabel: string;
  buildingId: string;
  poiId?: string;
  /** "building" for a plain building result, else the POI's group (food, shop, …) — drives the result row icon. */
  icon: string;
}

/** Buildings plus their interior businesses, as one searchable, sorted list. */
export function buildComboEntries(
  buildings: Pick<Building, "id" | "name" | "address">[],
  pois: Pick<Poi, "id" | "name" | "buildingId" | "exterior" | "group">[],
): ComboEntry[] {
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const entries: ComboEntry[] = buildings.map((b) => ({
    label: b.name,
    sublabel: b.address,
    buildingId: b.id,
    icon: "building",
  }));
  for (const p of pois) {
    if (p.exterior) continue; // bus stops etc. aren't routable destinations
    const host = byId.get(p.buildingId);
    if (!host) continue;
    entries.push({
      label: p.name,
      sublabel: host.name,
      buildingId: p.buildingId,
      poiId: p.id,
      icon: p.group ?? "building",
    });
  }
  return entries.sort((a, b) => a.label.localeCompare(b.label));
}

/** True at the start of the string or right after a non-word character —
 * "central" matches at a word boundary in "Minneapolis Central Library"
 * but not inside "centralized". */
function atWordBoundary(text: string, index: number): boolean {
  return index === 0 || !/\w/.test(text[index - 1]);
}

/** Higher is more relevant; null means the entry doesn't match at all. Every
 * query word has to appear somewhere in the label or sublabel (so "central
 * library" finds "Minneapolis Central Library" regardless of word order),
 * then results are ranked by how prominent the match is — a name that
 * starts with the query beats one that merely contains it, word-boundary
 * matches beat mid-word substrings. */
function score(entry: ComboEntry, words: string[]): number | null {
  const label = entry.label.toLowerCase();
  const sublabel = entry.sublabel.toLowerCase();
  const full = words.join(" ");
  let total = 0;

  if (label === full) total += 1000;
  else if (label.startsWith(full)) total += 500;

  for (const word of words) {
    const inLabel = label.indexOf(word);
    const inSub = sublabel.indexOf(word);
    if (inLabel === -1 && inSub === -1) return null; // every word must hit somewhere
    if (inLabel !== -1) total += atWordBoundary(label, inLabel) ? 200 : 100;
    if (inSub !== -1) total += atWordBoundary(sublabel, inSub) ? 50 : 20;
  }
  // Tie-breaker: "Target Field" for query "field target" should outrank
  // "Plaza Near Target Field" — both hit every word at a boundary, but the
  // first IS the query (just reordered) while the second buries it in a
  // longer name. Small enough not to override a real relevance gap above.
  total -= Math.max(0, label.length - full.length) * 0.3;
  return total;
}

export function searchEntries(entries: ComboEntry[], query: string): ComboEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return entries;
  return entries
    .map((e) => ({ e, s: score(e, words) }))
    .filter((r): r is { e: ComboEntry; s: number } => r.s !== null)
    .sort((a, b) => b.s - a.s || a.e.label.localeCompare(b.e.label))
    .map((r) => r.e);
}
