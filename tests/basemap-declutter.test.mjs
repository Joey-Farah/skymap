import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { featureFilter, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { planBasemapLayer } from "../src/basemap.ts";

// The two OpenFreeMap styles the app loads, captured as fixtures so these
// rules are checked against the real layer list rather than names we
// remember. Re-fetch them if the basemap ever changes shape:
//   curl -s https://tiles.openfreemap.org/styles/liberty > tests/fixtures/basemap/liberty.json
const STYLES = ["liberty", "dark"].map((name) => {
  const style = JSON.parse(readFileSync(`tests/fixtures/basemap/${name}.json`, "utf8"));
  return { name, style, layers: style.layers };
});

/** The layers of a style as SkyMap leaves them after decluttering. */
function applied(layers) {
  return layers.flatMap((layer) => {
    const plan = planBasemapLayer(layer);
    if (plan.hide) return [];
    return [plan.filter ? { ...layer, filter: plan.filter } : layer];
  });
}

const GEOMETRY = { Point: 1, LineString: 2, Polygon: 3 };

/** Ids of the visible layers that would draw this feature at this zoom. */
function drawnBy(layers, { sourceLayer, type = "LineString", properties, zoom = 16.5 }) {
  return applied(layers)
    .filter((l) => l["source-layer"] === sourceLayer)
    .filter((l) => (l.layout?.visibility ?? "visible") === "visible")
    .filter((l) => zoom >= (l.minzoom ?? 0) && zoom < (l.maxzoom ?? 24))
    .filter((l) => featureFilter(l.filter).filter({ zoom }, { type: GEOMETRY[type], properties }))
    .map((l) => l.id);
}

// Skyways are OSM footways, mostly tagged indoor, many as bridges. The
// basemap drew its own copy of them under ours — and of every sidewalk —
// so wherever the two disagreed the map showed paths nobody routes on.
const FOOTPATHS = [
  { class: "path", subclass: "footway", brunnel: "bridge", indoor: 1 },
  { class: "path", subclass: "footway", indoor: 1 },
  { class: "path", subclass: "corridor", indoor: 1 },
  { class: "path", subclass: "steps" },
  { class: "path", subclass: "footway" },
  { class: "path", subclass: "footway", brunnel: "tunnel" },
  { class: "pedestrian" },
];

for (const { name, style, layers } of STYLES) {
  test(`${name}: every rewritten filter is one MapLibre accepts`, () => {
    // map.setFilter rejects an invalid filter with a console error and keeps
    // the old one, so a malformed rewrite would silently change nothing.
    const errors = validateStyleMin({ ...style, layers: applied(layers) }).map((e) => e.message);
    assert.deepEqual(errors, []);
  });

  test(`${name}: the basemap draws no footpaths — skyways are the only paths on the map`, () => {
    for (const properties of FOOTPATHS) {
      assert.deepEqual(drawnBy(layers, { sourceLayer: "transportation", properties }), [], JSON.stringify(properties));
    }
  });

  test(`${name}: streets are still drawn`, () => {
    // Nicollet Mall is class "minor" in the tiles; it must survive this.
    for (const cls of ["minor", "secondary", "primary"]) {
      assert.notDeepEqual(drawnBy(layers, { sourceLayer: "transportation", properties: { class: cls } }), [], cls);
    }
  });

  test(`${name}: no 3D buildings — their walls lean out at the screen edge like thick paths`, () => {
    assert.deepEqual(
      applied(layers).filter((l) => l.type === "fill-extrusion").map((l) => l.id),
      [],
    );
  });

  test(`${name}: neighborhood names stay for orientation`, () => {
    assert.ok(applied(layers).some((l) => l.type === "symbol" && l["source-layer"] === "place"));
  });

  test(`${name}: the basemap's own shop and landmark labels stay hidden`, () => {
    assert.deepEqual(
      applied(layers).filter((l) => l.type === "symbol" && ["poi", "aerodrome_label"].includes(l["source-layer"])).map((l) => l.id),
      [],
    );
  });
}
