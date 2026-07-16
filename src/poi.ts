/** POI grouping: one place that decides how a business/feature is classed,
 * colored, and sectioned — shared by the extraction script, map, and sheet. */

export type PoiGroup = "food" | "shop" | "service" | "restroom" | "landmark" | "transit" | "elevator";

const FOOD = /^(cafe|restaurant|fast_food|bar|pub|ice_cream|bakery|confectionery|deli|coffee)$/;
const LANDMARK_AMENITY = /^(library|townhall|courthouse|place_of_worship|theatre|cinema)$/;
const TRANSIT = /^(bus_stop|station|tram_stop|stop)$/;

export function groupFor(kind: string, category: string): PoiGroup {
  if (category === "elevator") return "elevator";
  if (category === "toilets") return "restroom";
  if (kind === "transit" || TRANSIT.test(category)) return "transit";
  if (kind === "tourism" || LANDMARK_AMENITY.test(category)) return "landmark";
  if (FOOD.test(category)) return "food";
  if (kind === "shop") return "shop";
  return "service";
}

export const GROUP_LABELS: Record<PoiGroup, string> = {
  food: "Food & drink",
  shop: "Shops",
  service: "Services",
  restroom: "Restrooms",
  landmark: "Landmarks",
  transit: "Transit nearby",
  elevator: "Elevators",
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
