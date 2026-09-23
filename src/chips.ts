import type { PoiGroup } from "./poi.ts";

// Hotels earn a chip: they were searchable but unbrowsable, which for a
// visitor is close to not being there.
//
// Landmarks deliberately have no chip of their own — at the pill size of
// the time, a seventh wrapped onto three lines and made the panel taller
// than the map it describes.
// They ride along with Misc. instead. The *group* stays: landmarkNear
// picks turn-instruction cues ("past Bill & Marty's") from food, coffee
// and landmark POIs, so collapsing it in the data would have the nav
// banner citing dentists and banks as the thing to walk past.
//
// Parking joined as the seventh (a reader asked for the map to "light up
// with the parking garages"). Seven fit on two rows only with tighter
// pills — see .suggestion-pill in styles.css — and the order is the row
// order: Coffee, Food, Hotels, Parking / Elevators, Restrooms, Misc. —
// Misc. last, as the catch-all.
export const CHIP_GROUPS = {
  coffee: ["coffee"],
  food: ["food"],
  hotel: ["hotel"],
  parking: ["parking"],
  elevator: ["elevator"],
  restroom: ["restroom"],
  other: ["other", "landmark"],
} as const satisfies Record<string, readonly PoiGroup[]>;
