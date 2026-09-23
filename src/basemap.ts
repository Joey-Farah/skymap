import type { FilterSpecification, LayerSpecification } from "maplibre-gl";

/**
 * What SkyMap keeps of the stock OpenFreeMap basemap, decided one layer at
 * a time. Pure, so it can be checked against the real style JSON
 * (tests/fixtures/basemap) without a map.
 *
 * The rules key on the OpenMapTiles schema — layer type, source-layer and
 * the `class` field — never on the style's own layer ids, which differ
 * between the light and dark styles and can be renamed under us.
 */
export type BasemapPlan =
  | { hide: true; filter?: undefined; paint?: undefined }
  | { hide?: false; filter?: FilterSpecification; paint?: Record<string, string | number>; minzoom?: number };

// Skyways are OSM footways (mostly indoor, many bridges). The basemap drew
// its own copy of every one of them, and every sidewalk, underneath ours —
// so wherever the two disagreed the map showed paths SkyMap never routes
// on. Our network layer is the only path drawing the map should have.
const FOOTPATH_CLASSES = ["path", "pedestrian"];
const NOT_FOOTPATH = ["!", ["match", ["get", "class"], FOOTPATH_CLASSES, true, false]] as unknown as FilterSpecification;

// Street names sit a step quieter than SkyMap's own ink labels, so where
// the two are both on screen the eye lands on the place first. The stock
// dark style's own grey (rgba(80,78,78) on black) was barely legible.
// Zoomed out to 14 the whole grid's names pile up across the skyway
// network; from 15 (the default view is 15.4) they fit between the pins.
const STREET_NAME_MINZOOM = 15;

const STREET_NAME_PAINT = {
  light: { "text-color": "#6b7489", "text-halo-color": "rgba(255,255,255,0.9)", "text-halo-width": 1.4, "text-halo-blur": 0 },
  dark: { "text-color": "#8f98ab", "text-halo-color": "rgba(10,14,22,0.9)", "text-halo-width": 1.4, "text-halo-blur": 0 },
};

function withoutFootpaths(filter: FilterSpecification | undefined): FilterSpecification {
  return filter ? (["all", filter, NOT_FOOTPATH] as FilterSpecification) : NOT_FOOTPATH;
}

export function planBasemapLayer(layer: LayerSpecification, { dark = false } = {}): BasemapPlan {
  // The map is top-down, but MapLibre's camera is still a perspective one:
  // tall buildings near the edge of the screen show their walls, leaning
  // outward as grey bands that read as extra-thick paths. Flattened, not
  // hidden — Liberty's flat building layer stops at zoom 14 and this one
  // takes over, so hiding it erased every off-network building.
  if (layer.type === "fill-extrusion") return { paint: { "fill-extrusion-height": 0, "fill-extrusion-base": 0 } };

  const sourceLayer = "source-layer" in layer ? layer["source-layer"] : undefined;

  if (layer.type === "symbol") {
    // "place" (city/neighborhood names) is kept for orientation.
    if (sourceLayer === "place") return {};
    // Street names, drawn along the street. Everything else in the stock
    // style — shop and landmark labels, highway shields — competes with
    // SkyMap's own building/POI labels and stays hidden. The basemap sits
    // below our layers, so where a street name and one of ours collide,
    // MapLibre places ours.
    if (sourceLayer === "transportation_name" && layer.layout?.["symbol-placement"] === "line") {
      return {
        filter: withoutFootpaths(layer.filter),
        paint: STREET_NAME_PAINT[dark ? "dark" : "light"],
        minzoom: STREET_NAME_MINZOOM,
      };
    }
    return { hide: true };
  }

  if (layer.type === "line" && sourceLayer === "transportation") return { filter: withoutFootpaths(layer.filter) };
  return {};
}
