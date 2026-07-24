/** POI grouping: one place that decides how a business/feature is classed,
 * colored, and sectioned — shared by the extraction script, map, and sheet. */

export type PoiGroup = "food" | "coffee" | "other" | "restroom" | "landmark" | "transit" | "elevator";

// Coffee split out from food generally: someone who wants "where can I get
// a coffee" doesn't want a restaurant list to dig through, and vice versa.
const COFFEE = /^(cafe|coffee)$/;
// Convenience stores read as "food" to someone deciding where to grab a
// snack — the same instinct that reaches for a restaurant, not a filter
// most people would think to check under "shopping."
const FOOD = /^(restaurant|fast_food|bar|pub|ice_cream|bakery|confectionery|deli|convenience)$/;
const LANDMARK_AMENITY = /^(library|townhall|courthouse|place_of_worship|theatre|cinema)$/;
const TRANSIT = /^(bus_stop|station|tram_stop|stop)$/;

export function groupFor(kind: string, category: string): PoiGroup {
  if (category === "elevator") return "elevator";
  if (category === "toilets") return "restroom";
  if (kind === "transit" || TRANSIT.test(category)) return "transit";
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
  transit: "#178740",
  elevator: "#475569",
};

/** OSM building-way tags -> our building category. */
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
  const candidates = pois
    .filter(
      (p) => p.buildingId === buildingId && (p.group === "food" || p.group === "coffee" || p.group === "landmark"),
    )
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
