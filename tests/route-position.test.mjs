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
    assert.ok(!placed.offRoute, `fix ${t}: 90 m of drift was mistaken for leaving the route`);
    const error = haversineMeters(placed.coord[1], placed.coord[0], truth[1], truth[0]);
    worstError = Math.max(worstError, error);
  }

  assert.ok(fixes > 20, "expected a walk long enough to be meaningful");
  assert.ok(
    worstError <= 25,
    `worst placement was ${worstError.toFixed(0)} m from the walker; want <= 25 m`,
  );
});

/**
 * The flip side of never giving up: a tracker that always finds an answer
 * will happily coast someone along a route they abandoned two blocks ago.
 * Leaving has to be noticed and said out loud, not absorbed as noise.
 */
test("walking away from the route is reported, and the dot stops", () => {
  const tracker = new RouteTracker(ROUTE);
  let atMs = walkTo(tracker, 100);

  // Turn east and keep going — off the route, at a walking pace.
  let placed = null;
  let declaredAt = null;
  const coords = [];
  for (let i = 1; i <= 120; i++) {
    const away = i * 1.35 * 2;
    const fix = [LON0 + away / M_PER_DEG_LON, LAT0 + 100 / M_PER_DEG_LAT];
    placed = tracker.update(fix[1], fix[0], (atMs += 2000));
    if (placed.offRoute && declaredAt === null) declaredAt = away;
    if (declaredAt !== null) coords.push(placed.coord);
  }

  assert.ok(declaredAt !== null, "walked 300 m off the route and it was never reported");
  assert.ok(
    declaredAt <= 150,
    `took ${declaredAt.toFixed(0)} m of walking away to notice; want <= 150 m`,
  );
  const moved = coords.map((c) => haversineMeters(c[1], c[0], coords[0][1], coords[0][0]));
  assert.ok(
    Math.max(...moved) < 1,
    "the dot kept moving after we knew we'd lost the walker; it should hold",
  );
});

/**
 * Detours end. Someone who ducks out to street level and comes back up
 * three buildings along has to be picked up where they actually are — if
 * rejoining had to be earned back at walking pace from where they left,
 * the dot would stay wrong for the rest of the trip.
 */
test("rejoining the route is picked up again", () => {
  const tracker = new RouteTracker(ROUTE);
  let atMs = walkTo(tracker, 100);

  for (let i = 1; i <= 120; i++) {
    const away = i * 1.35 * 2;
    tracker.update(LAT0 + 100 / M_PER_DEG_LAT, LON0 + away / M_PER_DEG_LON, (atMs += 2000));
  }
  assert.ok(tracker.update(LAT0 + 100 / M_PER_DEG_LAT, LON0 + 300 / M_PER_DEG_LON, (atMs += 2000)).offRoute);

  // Back on the skyway, 220 m along — well past where they stepped off.
  let placed = null;
  for (let i = 0; i < 4; i++) {
    const truth = truthAt(220);
    placed = tracker.update(truth[1], truth[0], (atMs += 2000));
  }

  assert.equal(placed.offRoute, false, "walker rejoined the route and was still reported lost");
  assert.ok(
    Math.abs(placed.alongMeters - 220) <= 25,
    `picked back up at ${placed.alongMeters.toFixed(0)} m; walker was at 220 m`,
  );
});

/** Walk a tracker to `meters` along at a believable pace, and hand back the
 * clock so a test can carry on from there. */
function walkTo(tracker, meters, { speed = 1.35, dtMs = 2000, drift = 0 } = {}) {
  let atMs = 0;
  for (let walked = 0; walked <= meters; walked += speed * (dtMs / 1000)) {
    atMs += dtMs;
    const truth = truthAt(walked);
    const fix = drift ? driftedFix(truth, drift, walked) : truth;
    tracker.update(fix[1], fix[0], atMs);
  }
  return atMs;
}

/**
 * Waiting for a lift, reading a directory, or queuing for coffee is a
 * normal part of a trip. The motion window has to permit standing still:
 * if it only ever admits candidates ahead of the estimate, a stationary
 * walker is quietly marched toward the destination by their own GPS noise
 * — and the arrival clock and step list follow them there.
 */
test("standing still does not walk the dot forward", () => {
  const tracker = new RouteTracker(ROUTE);
  let atMs = walkTo(tracker, 100);

  const before = tracker.update(LAT0 + 100 / M_PER_DEG_LAT, LON0, (atMs += 2000)).alongMeters;

  // Two minutes of not moving, with fixes wandering 40 m around the spot.
  for (let i = 0; i < 60; i++) {
    const fix = driftedFix(truthAt(100), 40, i);
    tracker.update(fix[1], fix[0], (atMs += 2000));
  }

  const after = tracker.update(LAT0 + 100 / M_PER_DEG_LAT, LON0, (atMs += 2000)).alongMeters;
  const crept = after - before;
  assert.ok(
    Math.abs(crept) <= 15,
    `stationary walker moved ${crept.toFixed(0)} m along the route; want <= 15 m`,
  );
});
