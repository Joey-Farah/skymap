/** POI grouping: one place that decides how a business/feature is classed,
 * colored, and sectioned — shared by the extraction script, map, and sheet. */

import { distanceToFootprint, haversineMeters, pointInRing } from "./router.ts";

export type PoiGroup =
  | "food"
  | "coffee"
  | "other"
  | "restroom"
  | "landmark"
  | "hotel"
  | "transit"
  | "elevator";

// Coffee split out from food generally: someone who wants "where can I get
// a coffee" doesn't want a restaurant list to dig through, and vice versa.
const COFFEE = /^(cafe|coffee)$/;
// Convenience stores read as "food" to someone deciding where to grab a
// snack — the same instinct that reaches for a restaurant, not a filter
// most people would think to check under "shopping."
const FOOD = /^(restaurant|fast_food|bar|pub|ice_cream|bakery|confectionery|deli|convenience)$/;
const LANDMARK_AMENITY = /^(library|townhall|courthouse|place_of_worship|theatre|cinema)$/;
// Somewhere to sleep is its own errand. Filed under Landmarks a hotel is
// technically findable and practically invisible — and a visitor with a
// reservation is exactly the person a skyway map is most useful to.
const LODGING = /^(hotel|hostel|motel|guest_house)$/;
const TRANSIT = /^(bus_stop|station|tram_stop|stop)$/;
// Parks, plazas and historic markers are things you navigate *to* and
// point at, which is what the Landmarks group is for.
const LANDMARK_PLACE = /^(park|garden|memorial|monument|sign|ruins|archaeological_site)$/;

export function groupFor(kind: string, category: string): PoiGroup {
  if (category === "elevator") return "elevator";
  if (category === "toilets") return "restroom";
  if (kind === "transit" || TRANSIT.test(category)) return "transit";
  if (LODGING.test(category)) return "hotel";
  // Off-network landmark buildings arrive with kind "landmark" and a
  // building category ("venue", "government") that none of the rules below
  // recognise. The pipeline used to paper over that by hardcoding the
  // group at the call site, which also swallowed every hotel it passed —
  // 13 of downtown's hotels were filed under Landmarks, more than were in
  // Hotels. Answering it here instead keeps one classifier, and keeps it
  // *after* LODGING so lodging still wins.
  if (kind === "landmark") return "landmark";
  if (kind === "historic" || LANDMARK_PLACE.test(category)) return "landmark";
  if (kind === "tourism" || LANDMARK_AMENITY.test(category)) return "landmark";
  if (COFFEE.test(category)) return "coffee";
  if (FOOD.test(category)) return "food";
  // Everything else that isn't food/coffee/wayfinding — clothing and
  // jewelry stores alongside banks, dentists, chiropractors: whether a
  // place is a "shop" or a "service" isn't a distinction anyone filtering
  // while walking around actually cares about.
  return "other";
}

export const GROUP_LABELS: Record<PoiGroup, string> = {
  food: "Food",
  coffee: "Coffee",
  other: "Misc.",
  restroom: "Restrooms",
  landmark: "Landmarks",
  hotel: "Hotels",
  transit: "Transit",
  elevator: "Elevators",
};

/** One color per group — shared by the map's pins and the search result
 * icons, so a coffee cup means the same thing wherever you see it. */
export const GROUP_COLORS: Record<PoiGroup, string> = {
  food: "#e08a00",
  coffee: "#7c4a2d",
  other: "#17356e",
  restroom: "#0d9488",
  landmark: "#7c3aed",
  hotel: "#b3306e",
  transit: "#178740",
  elevator: "#475569",
};

interface HostCandidate {
  id: string;
  lat: number;
  lon: number;
  footprint?: [number, number][];
}

export interface PoiHost<T> {
  building: T;
  /** True when the place isn't actually inside its host — it's the nearest
   * building the skyway reaches. Callers must say so rather than implying
   * containment. */
  nearby: boolean;
}

/**
 * Which network building a place belongs to.
 *
 * Point-in-polygon first: that's the honest answer when it's available. But
 * requiring it discarded real places wholesale — the downtown Target sits
 * inside a building the skyway graph never captured, so it resolved to
 * nothing and simply ceased to exist, with no signal that anything was
 * missing. Transit stops and landmark buildings already had a nearest-host
 * fallback; ordinary businesses didn't, and that gap is what the first
 * external bug report found.
 *
 * So: fall back to the nearest building within `maxNearbyMeters`, flagged
 * `nearby` so the place card can say *nearest skyway access* instead of
 * claiming the place is somewhere it isn't. Beyond that radius, still
 * nothing — a place the skyway can't plausibly reach shouldn't be attached
 * to it just to avoid an empty result.
 */
export function resolvePoiHost<T extends HostCandidate>(
  lat: number,
  lon: number,
  buildings: T[],
  maxNearbyMeters: number,
): PoiHost<T> | null {
  const inside = buildings.find((b) => b.footprint && pointInRing(lon, lat, b.footprint));
  if (inside) return { building: inside, nearby: false };

  let best: T | null = null;
  let bestMeters = maxNearbyMeters;
  for (const b of buildings) {
    // Distance to the footprint, not the centroid. A centroid measurement
    // makes a big tower "far" from a place pressed against its own wall and
    // hands the place to a smaller building across the street — which then
    // routes you out of the wrong door onto the wrong block.
    const meters = distanceToFootprint(lat, lon, b);
    if (meters <= bestMeters) {
      bestMeters = meters;
      best = b;
    }
  }
  return best ? { building: best, nearby: true } : null;
}

/** Categories whose "name" is our own fallback rather than something a
 * mapper typed — two of these in a lobby are two real facilities. */
const GENERICALLY_NAMED = new Set(["elevator", "toilets"]);

/**
 * Collapse a place that OSM holds twice — a node and a way for one shop,
 * or two nodes nobody merged — while leaving chain branches alone.
 *
 * Name alone can't decide it: downtown has six Starbucks, and deleting five
 * would remove shops people are standing next to. Distance settles it. In
 * the real extraction the duplicates sit at ~0 m and the closest pair of
 * genuine same-name branches is 182 m apart, so a 25 m cut has an order of
 * magnitude of headroom on both sides.
 *
 * The first occurrence wins, which keeps whichever record the extraction
 * saw first — in practice the more complete one, since the richer OSM
 * object tends to be the one that also carries the tags we query on.
 */
export function dedupePois<T extends { name: string; category: string; lat: number; lon: number }>(
  pois: T[],
  maxMeters: number,
): T[] {
  const kept: T[] = [];
  const byName = new Map<string, T[]>();
  for (const p of pois) {
    if (GENERICALLY_NAMED.has(p.category)) {
      kept.push(p);
      continue;
    }
    const seen = byName.get(p.name);
    if (seen?.some((q) => haversineMeters(p.lat, p.lon, q.lat, q.lon) <= maxMeters)) continue;
    if (seen) seen.push(p);
    else byName.set(p.name, [p]);
    kept.push(p);
  }
  return kept;
}

/** OSM building-way tags -> our building category. */
/** OSM's `website` tag is free text from a publicly editable dataset, and
 * it lands directly in an anchor's href — so a `javascript:` or `data:`
 * value would run in the app's own context the moment someone taps the
 * link. Only http(s) is ever a legitimate website here; anything else
 * returns undefined and the caller omits the link rather than rendering a
 * dead or dangerous one. Every website value in the current extraction is
 * already http(s), so nothing real is lost. */
export function safeWebsiteUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  // Checked against the parsed protocol, not the raw string: the URL
  // parser strips tabs and newlines, so "java\nscript:" normalizes to
  // something a prefix test on the original text would wave through.
  return url.protocol === "http:" || url.protocol === "https:" ? trimmed : undefined;
}

export function buildingCategory(tags: Record<string, string>): string {
  const b = tags.building ?? "";
  if (/^(parking|garage)$/.test(b) || tags.amenity === "parking") return "parking";
  if (b === "hotel" || tags.tourism === "hotel") return "hotel";
  if (b === "retail") return "retailHub";
  if (/^(civic|government)$/.test(b) || /^(townhall|courthouse)$/.test(tags.amenity ?? "")) return "government";
  if (/^(church|cathedral)$/.test(b) || tags.amenity === "place_of_worship") return "venue";
  if (b === "stadium" || b === "sports_centre") return "venue";
  if (b === "hospital") return "hospital";
  if (/^(apartments|residential)$/.test(b)) return "residential";
  return "office";
}

/**
 * The most recognizable business in a building, for "past X" wayfinding
 * cues — deterministic (alphabetically first food POI) so instructions
 * don't flicker between re-renders.
 */
export function landmarkNear<T extends { name: string; buildingId: string; group: PoiGroup }>(
  pois: T[],
  buildingId: string,
): T | null {
  // Hotels count. A named hotel is one of the best things to be told to
  // walk past, and they were already being used as cues by accident while
  // misfiled as landmarks — splitting them out silently cost four
  // buildings their only cue, parking ramps among them, which is exactly
  // where "past the Hilton Garden Inn" earns its place.
  const CUE_GROUPS = new Set<PoiGroup>(["food", "coffee", "landmark", "hotel"]);
  const candidates = pois
    .filter((p) => p.buildingId === buildingId && CUE_GROUPS.has(p.group))
    .sort((a, b) => a.name.localeCompare(b.name));
  return candidates[0] ?? null;
}

export const CATEGORY_LABELS: Record<string, string> = {
  retailHub: "Retail hub",
  office: "Office building",
  government: "Government",
  hotel: "Hotel",
  venue: "Venue",
  parking: "Parking ramp",
  hospital: "Hospital",
  residential: "Residential",
};
