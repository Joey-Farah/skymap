import test from "node:test";
import assert from "node:assert/strict";

import { routeCoords } from "../src/route-geometry.ts";

/**
 * 733 Building exactly as the shipped dataset has it — the destination of
 * the recorded 1.6 walk. Four skyway doors, six corridors between them with
 * real shape, and a pin at the building's own lon/lat.
 */
const DEST = "733-building-126116972";
/** The door the walk arrives through, from Deluxe Plaza. */
const DOOR = [-93.271015, 44.975199];
const PIN = [-93.271044, 44.975516];

const LINKS = [
  { buildingId: DEST, doorA: [-93.271049, 44.975918], doorB: [-93.270665, 44.975757],
    geometry: [[-93.271049, 44.975918], [-93.270914, 44.975858], [-93.270665, 44.975757]] },
  { buildingId: DEST, doorA: [-93.271049, 44.975918], doorB: [-93.27096, 44.975271],
    geometry: [[-93.271049, 44.975918], [-93.270914, 44.975858], [-93.271229, 44.975426],
               [-93.271254, 44.975393], [-93.271012, 44.975293], [-93.27096, 44.975271]] },
  { buildingId: DEST, doorA: [-93.271049, 44.975918], doorB: DOOR,
    geometry: [[-93.271049, 44.975918], [-93.270914, 44.975858], [-93.271229, 44.975426],
               [-93.271254, 44.975393], [-93.271012, 44.975293], [-93.27096, 44.975271], DOOR] },
  { buildingId: DEST, doorA: [-93.270665, 44.975757], doorB: [-93.27096, 44.975271],
    geometry: [[-93.270665, 44.975757], [-93.270914, 44.975858], [-93.271229, 44.975426],
               [-93.271254, 44.975393], [-93.271012, 44.975293], [-93.27096, 44.975271]] },
  { buildingId: DEST, doorA: [-93.270665, 44.975757], doorB: DOOR,
    geometry: [[-93.270665, 44.975757], [-93.270914, 44.975858], [-93.271229, 44.975426],
               [-93.271254, 44.975393], [-93.271012, 44.975293], [-93.27096, 44.975271], DOOR] },
  { buildingId: DEST, doorA: [-93.27096, 44.975271], doorB: DOOR,
    geometry: [[-93.27096, 44.975271], DOOR] },
];

const ROUTE = {
  steps: [
    { building: { id: "deluxe-plaza-1462073358", lon: -93.2712, lat: 44.9748 } },
    { building: { id: DEST, lon: PIN[0], lat: PIN[1] },
      legGeometry: [[-93.271102, 44.975062], DOOR] },
  ],
  totalMeters: 160,
  totalMinutes: 3,
  ignoredClosures: false,
};

const M_PER_DEG_LAT = 111320;

/** Distance from a point to a segment, in metres. A corridor is a line, not
 * a handful of vertices — a point beside its middle is on it. */
function toSegment(p, a, b) {
  const k = Math.cos((a[1] * Math.PI) / 180) * M_PER_DEG_LAT;
  const sx = (b[0] - a[0]) * k;
  const sy = (b[1] - a[1]) * M_PER_DEG_LAT;
  const px = (p[0] - a[0]) * k;
  const py = (p[1] - a[1]) * M_PER_DEG_LAT;
  const len2 = sx * sx + sy * sy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (px * sx + py * sy) / len2)) : 0;
  return Math.hypot(px - sx * t, py - sy * t);
}

/** How far a point is from the nearest corridor the building actually has —
 * that is, from anywhere the walker could be standing. */
function offCorridor(p) {
  let best = Infinity;
  for (const l of LINKS) {
    for (let i = 1; i < l.geometry.length; i++) {
      best = Math.min(best, toSegment(p, l.geometry[i - 1], l.geometry[i]));
    }
  }
  return best;
}

/** Sampled along the drawn line rather than at its vertices: a line cutting
 * a corner is furthest from the corridors mid-segment, where there is no
 * vertex to check. */
function worstOffCorridor(coords) {
  const at = coords.findIndex((c) => c[0] === DOOR[0] && c[1] === DOOR[1]);
  const tail = coords.slice(at);
  let worst = 0;
  for (let i = 1; i < tail.length; i++) {
    for (let t = 0; t <= 20; t++) {
      worst = Math.max(worst, offCorridor([
        tail[i - 1][0] + (tail[i][0] - tail[i - 1][0]) * (t / 20),
        tail[i - 1][1] + (tail[i][1] - tail[i - 1][1]) * (t / 20),
      ]));
    }
  }
  return worst;
}

/**
 * The last leg of the recorded 1.6 walk, at 3:52: a straight 35 m line from
 * the arrival door to the pin in the middle of the building, while every
 * other in-building leg follows a real corridor.
 *
 * Buildings passed *through* mid-route already get their indoor path
 * spliced in by findIndoorLink. The building you finish in never did —
 * routeCoords just pushed the destination point on after the last door, so
 * the final approach was drawn across whatever the straight line happened
 * to cross.
 *
 * The bar is a property, not a chosen number. The pin sits off the corridors
 * by however far it sits off them, and the walker covers that last stretch
 * whatever we draw. What the line must not do is get *further* from the
 * walkable corridors than the destination itself is — that is the signature
 * of cutting across the floor instead of walking round it.
 */
test("the final approach follows a corridor, not a straight line to the pin", () => {
  const coords = routeCoords(ROUTE, [-93.2712, 44.9748], PIN, LINKS);

  assert.deepEqual(coords[coords.length - 1], PIN, "the line must still end on the destination pin");

  const unavoidable = offCorridor(PIN);
  const worst = worstOffCorridor(coords);
  assert.ok(
    worst <= unavoidable + 0.5,
    `the approach reaches ${worst.toFixed(1)} m from any corridor, further than the pin's own ` +
      `${unavoidable.toFixed(1)} m — it is cutting across the building, not walking round it`,
  );
});

/** No corridor reaches this door, so a straight line is the truest thing
 * left to draw and the old behaviour is still right. */
test("a door with no corridor still gets a straight line to the pin", () => {
  const coords = routeCoords(ROUTE, [-93.2712, 44.9748], PIN,
    LINKS.map((l) => ({ ...l, buildingId: "somewhere-else" })));
  assert.deepEqual(coords[coords.length - 2], DOOR);
  assert.deepEqual(coords[coords.length - 1], PIN);
});
