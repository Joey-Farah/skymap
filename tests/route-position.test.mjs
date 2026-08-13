import test from "node:test";
import assert from "node:assert/strict";

import { haversineMeters } from "../src/router.ts";
import { RouteTracker } from "../src/route-position.ts";

const M_PER_DEG_LAT = 111320;
const LAT0 = 44.975;
const LON0 = -93.27;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

/** A straight 300 m run due north — the simplest thing a skyway can be. */
const ROUTE = [
  [LON0, LAT0],
  [LON0, LAT0 + 300 / M_PER_DEG_LAT],
];

/** Where a walker genuinely is, `meters` into that run. */
function truthAt(meters) {
  return [LON0, LAT0 + meters / M_PER_DEG_LAT];
}

/** Deterministic stand-in for indoor GPS: a fix thrown `meters` off in a
 * direction that wanders, so the error can't be cancelled by symmetry the
 * way a constant bias would be. */
function driftedFix(truth, meters, seed) {
  const bearing = (seed * 2.399963) % (2 * Math.PI); // golden-angle scatter
  return [
    truth[0] + (meters * Math.sin(bearing)) / M_PER_DEG_LON,
    truth[1] + (meters * Math.cos(bearing)) / M_PER_DEG_LAT,
  ];
}

/**
 * The bug, as reported: walking the route, on the route, and the app
 * decides you are out in the street. Today's rule (snapToRoute at 60 m)
 * returns nothing for every one of these fixes, which is what hands the
 * screen back to MapLibre's raw dot.
 */
test("a walker on the route is placed on every fix, despite 90 m of drift", () => {
  const tracker = new RouteTracker(ROUTE);
  const SPEED = 1.35; // m/s
  const DT_MS = 2000;

  let worstError = 0;
  let fixes = 0;

  for (let t = 0; t * SPEED * (DT_MS / 1000) <= 300; t++) {
    const walked = t * SPEED * (DT_MS / 1000);
    const truth = truthAt(walked);
    const fix = driftedFix(truth, 90, t);

    const placed = tracker.update(fix[1], fix[0], t * DT_MS);
    fixes++;

    assert.ok(placed, `fix ${t} produced no position — this is the street jump`);
    const error = haversineMeters(placed.coord[1], placed.coord[0], truth[1], truth[0]);
    worstError = Math.max(worstError, error);
  }

  assert.ok(fixes > 20, "expected a walk long enough to be meaningful");
  assert.ok(
    worstError <= 25,
    `worst placement was ${worstError.toFixed(0)} m from the walker; want <= 25 m`,
  );
});
