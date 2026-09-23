import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GROUP_COLORS, GROUP_LABELS, groupFor } from "../src/poi.ts";

// A reader asked for parking "as an icon like the elevators and food and
// hotels, so when you click the map lights up with the parking garages".
// Ramps were buildings with no pin — filed under Landmarks, reachable only
// by searching for one by name.
const data = JSON.parse(readFileSync("public/data/skymap-data.json", "utf8"));
const ramps = data.buildings.filter((b) => b.category === "parking");

test("parking is its own group, whatever kind of record names the ramp", () => {
  for (const kind of ["building", "landmark"]) assert.equal(groupFor(kind, "parking"), "parking", kind);
  assert.equal(GROUP_LABELS.parking, "Parking");
});

test("every ramp has exactly one pin, and it opens the ramp itself", () => {
  // Including the four hand-curated ramps that the skyway graph reaches
  // only through a neighbour: each is a building of its own, which search
  // and routing already treat as the destination.
  assert.ok(ramps.length >= 25, `expected the 25 known ramps, found ${ramps.length}`);
  const missing = [];
  for (const ramp of ramps) {
    const pins = data.pois.filter((p) => p.group === "parking" && p.buildingId === ramp.id);
    if (pins.length !== 1) missing.push(`${ramp.name}: ${pins.length} pins`);
  }
  assert.deepEqual(missing, []);
});

// CIE76 color difference: ~2 is a just-noticeable difference, and the
// closest pair already on the map (Misc. vs Elevators) is about 29.
function deltaE(a, b) {
  const lab = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const [x, y, z] = [(r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, r * 0.2126 + g * 0.7152 + b * 0.0722, (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883].map(f);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

test("every Parking pin opens a parking ramp", () => {
  // The inverse of the check above. A pin hosted by a neighbour — which
  // fetch-osm's landmark path would make for an unreachable OSM ramp — would
  // light up under Parking and then open, and route to, some other building.
  const rampIds = new Set(ramps.map((r) => r.id));
  const strays = data.pois.filter((p) => p.group === "parking" && !rampIds.has(p.buildingId)).map((p) => `${p.name} -> ${p.buildingId}`);
  assert.deepEqual(strays, []);
});

test("the parking pin stands out from the skyway lines and the other pins", () => {
  // Blue is the usual parking color, and on this map it is also the color of
  // every skyway (NETWORK in src/map.ts): a blue pin on a blue line all but
  // disappeared (deltaE 6).
  const SKYWAY = "#2257c9";
  const pin = GROUP_COLORS.parking;
  assert.ok(pin, "no parking color");
  const neighbours = { skyway: SKYWAY, ...Object.fromEntries(Object.entries(GROUP_COLORS).filter(([g]) => g !== "parking")) };
  for (const [name, color] of Object.entries(neighbours)) {
    assert.ok(deltaE(pin, color) >= 30, `parking ${pin} is only ${deltaE(pin, color).toFixed(1)} from ${name} ${color}`);
  }
});
