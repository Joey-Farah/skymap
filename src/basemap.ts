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
export type BasemapPlan = { hide: true; filter?: undefined } | { hide?: false; filter?: FilterSpecification };

// Skyways are OSM footways (mostly indoor, many bridges). The basemap drew
// its own copy of every one of them, and every sidewalk, underneath ours —
// so wherever the two disagreed the map showed paths SkyMap never routes
// on. Our network layer is the only path drawing the map should have.
const FOOTPATH_CLASSES = ["path", "pedestrian"];
const NOT_FOOTPATH = ["!", ["match", ["get", "class"], FOOTPATH_CLASSES, true, false]] as unknown as FilterSpecification;

export function planBasemapLayer(layer: LayerSpecification): BasemapPlan {
  // The map is top-down, but MapLibre's camera is still a perspective one:
  // tall buildings near the edge of the screen show their walls, leaning
  // outward as grey bands that read as extra-thick paths.
  if (layer.type === "fill-extrusion") return { hide: true };

  const sourceLayer = "source-layer" in layer ? layer["source-layer"] : undefined;

  // The stock labels compete with SkyMap's own building/POI labels. "place"
  // (city/neighborhood names) is the one set worth keeping for orientation.
  if (layer.type === "symbol") return sourceLayer === "place" ? {} : { hide: true };

  if (layer.type === "line" && sourceLayer === "transportation") {
    return { filter: layer.filter ? (["all", layer.filter, NOT_FOOTPATH] as FilterSpecification) : NOT_FOOTPATH };
  }
  return {};
}
