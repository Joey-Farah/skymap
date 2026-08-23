import type { Building, Poi } from "./types.ts";
import { isBuildingMarker } from "./poi.ts";

/** One searchable result in the from/to picker: a building or a business inside one. */
export interface ComboEntry {
  label: string;
  sublabel: string;
  buildingId: string;
  poiId?: string;
  /** "building" for a plain building result, else the POI's group (food, shop, …) — drives the result row icon. */
  icon: string;
  /** Own coordinates (the business's spot, or the building centroid) —
   * lets equally-relevant results (chains: four Starbucks, two Grayfox)
   * sort closest-first to wherever the search is anchored. */
  lat?: number;
  lon?: number;
}

/** Buildings plus their interior businesses, as one searchable, sorted list. */
export function buildComboEntries(
  buildings: (Pick<Building, "id" | "name" | "address"> & Partial<Pick<Building, "lat" | "lon">>)[],
  pois: (Pick<Poi, "id" | "name" | "buildingId" | "exterior" | "group"> &
    Partial<Pick<Poi, "lat" | "lon" | "category" | "kind">>)[],
): ComboEntry[] {
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const entries: ComboEntry[] = buildings.map((b) => ({
    label: b.name,
    sublabel: b.address,
    buildingId: b.id,
    icon: "building",
    lat: b.lat,
    lon: b.lon,
  }));
  for (const p of pois) {
    // Exterior POIs are kept out because a bus stop isn't somewhere you
    // route to — with one exception. Named LRT stations are landmarks
    // people search by name, and Government Plaza and Warehouse District
    // had no other record carrying theirs, so they returned nothing at
    // all. Target Field and US Bank Stadium only looked fine because
    // separate landmark POIs happen to share those names.
    if (p.exterior && p.category !== "station") continue;
    // A building's own marker exists so the building gets a pin under its
    // category's chip — the pins layer is the only thing that draws
    // buildings. It is not a separate place: listing it here put the
    // Marriott in the results twice, once as itself and once as a business
    // inside itself whose sublabel was its own name. The building entry
    // above already covers it, and carries the address.
    if (isBuildingMarker(p)) continue;
    const host = byId.get(p.buildingId);
    if (!host) continue;
    entries.push({
      label: p.name,
      sublabel: host.name,
      buildingId: p.buildingId,
      poiId: p.id,
      icon: p.group ?? "building",
      lat: p.lat ?? host.lat,
      lon: p.lon ?? host.lon,
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

/**
 * Normalises text for matching: case, accents, and the several characters
 * that all mean "apostrophe".
 *
 * Without it, twelve real downtown places were unreachable by typing their
 * names the way anyone would — Pizza Lucé, Fogo de Chão, Jalapeño Mexican
 * Grill — and the dropdown simply stayed empty, indistinguishable from the
 * place not existing. The apostrophe half cuts both ways: two names are
* stored with a curly U+2019 and thirty-six with a straight quote, and iOS
 * smart punctuation rewrites whichever one you type, so the direction that
 * breaks depends on the keyboard rather than the data. Dropping the
 * character entirely rather than normalising it also catches the person who
 * simply doesn't type one: "Toms Watch Bar".
 *
 * NFD splits an accented letter into letter + combining mark; stripping the
 * marks leaves the plain letter, so "Lucé" and "Luce" compare equal while
 * either spelling still matches itself.
 */
export function foldForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2018\u2019\u02bc\u02bb`\u00b4]/g, "")
    .toLowerCase();
}

/** Higher is more relevant; null means the entry doesn't match at all. Every
 * query word has to appear somewhere in the label or sublabel (so "central
 * library" finds "Minneapolis Central Library" regardless of word order),
 * then results are ranked by how prominent the match is — a name that
 * starts with the query beats one that merely contains it, word-boundary
 * matches beat mid-word substrings. */
function score(entry: ComboEntry, words: string[]): number | null {
  const label = foldForSearch(entry.label);
  const sublabel = foldForSearch(entry.sublabel);
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

/** Rough equirectangular distance — plenty for ranking results a few
 * downtown blocks apart, without pulling the router's full haversine in. */
function roughDistance(a: { lat?: number; lon?: number }, near: { lat: number; lon: number }): number {
  if (a.lat === undefined || a.lon === undefined) return Number.POSITIVE_INFINITY;
  const dLat = a.lat - near.lat;
  const dLon = (a.lon - near.lon) * Math.cos((near.lat * Math.PI) / 180);
  return dLat * dLat + dLon * dLon;
}

/**
 * `near`, when known (the chosen From, or the live GPS fix), breaks
 * relevance ties by proximity: searching a chain name ("Starbucks",
 * "Grayfox") lists the closest branch first instead of whichever sorted
 * first alphabetically. Only a tie-breaker — a genuinely better text match
 * still outranks a nearer, weaker one.
 */
export function searchEntries(
  entries: ComboEntry[],
  query: string,
  near?: { lat: number; lon: number } | null,
): ComboEntry[] {
  const words = foldForSearch(query.trim()).split(/\s+/).filter(Boolean);
  if (words.length === 0) return entries;
  return entries
    .map((e) => ({ e, s: score(e, words), d: near ? roughDistance(e, near) : 0 }))
    .filter((r): r is { e: ComboEntry; s: number; d: number } => r.s !== null)
    .sort((a, b) => b.s - a.s || a.d - b.d || a.e.label.localeCompare(b.e.label))
    .map((r) => r.e);
}
