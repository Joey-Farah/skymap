import test from "node:test";
import assert from "node:assert/strict";

import { DETOUR_METERS, canDismissArrival, hasArrived, settleArrival, settleRemaining } from "../src/nav-progress.ts";

test("arrival is the last step, not the last instruction", () => {
  // A three-building trip: steps 0 and 1 still have somewhere to head into.
  assert.equal(hasArrived(0, 3), false);
  assert.equal(hasArrived(1, 3), false);
  assert.equal(hasArrived(2, 3), true);

  // Past the end counts as arrived rather than as a missing step — a step
  // index is derived from position and can overshoot.
  assert.equal(hasArrived(5, 3), true);

  // No route is not an arrival; nothing was ever under way.
  assert.equal(hasArrived(0, 0), false);
  assert.equal(hasArrived(0, 1), false);
});

test("the arrival clock holds still on a steady walk", () => {
  // The defect this release claims to fix, reproduced with ZERO GPS noise:
  // eta = now + round(remaining minutes) sawtooths +/-30s around the true
  // arrival, because now advances continuously while the rounded minute
  // count steps. Smoothing the distance term does nothing to it.
  const totalM = 240;
  const totalMin = 3;
  const start = new Date(2026, 7, 6, 11, 12, 0).getTime();

  const shown = [];
  let settledEta = null;
  for (let s = 0; s <= 170; s += 3) {
    const now = start + s * 1000;
    const remainingMeters = totalM * (1 - s / 180); // perfectly steady
    const rawEta = now + (totalMin * (remainingMeters / totalM)) * 60_000;
    settledEta = settleArrival(settledEta, rawEta);
    const d = new Date(settledEta);
    shown.push(`${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`);
  }

  const flips = shown.filter((v, i) => i > 0 && v !== shown[i - 1]).length;
  assert.ok(flips <= 1, `arrival clock changed ${flips} times on a steady walk: ${[...new Set(shown)]}`);
});

test("the arrival clock still moves when the walk really changes", () => {
  const base = new Date(2026, 7, 6, 11, 15, 0).getTime();
  // A minor recomputation is absorbed rather than shown.
  assert.equal(settleArrival(base, base + 20_000), base);
  // Genuinely losing two minutes is not.
  assert.equal(settleArrival(base, base + 120_000), base + 120_000);
  // First reading of a trip is taken as-is.
  assert.equal(settleArrival(null, base), base);
});

test("a trip only ends itself once you're actually there", () => {
  // routeStepIndex picks the nearest building centroid, so a big
  // destination reads as "arrived" from its far edge — visible in the
  // recorded walk, where the banner flipped while the walk continued.
  // Ending navigation on that would close the map mid-trip.
  assert.equal(canDismissArrival(true, 120), false, "step says arrived, distance disagrees");
  assert.equal(canDismissArrival(true, 8), true, "at the door");

  // Not arrived is never dismissable, however close the destination is.
  assert.equal(canDismissArrival(false, 0), false);

  // No fix to check against: the step index is all there is, so trust it
  // rather than leaving the banner up forever.
  assert.equal(canDismissArrival(true, null), true);
});

test("the first fix of a trip is taken as-is", () => {
  assert.equal(settleRemaining(null, 240), 240);
});

test("ordinary progress towards the destination counts immediately", () => {
  // A fix every few seconds moves you metres, not hundreds of metres, so
  // real walking is always inside the slew limit and shows up at once.
  assert.equal(settleRemaining(240, 200), 200);
  assert.equal(settleRemaining(200, 195), 195);
  assert.equal(settleRemaining(40, 0), 0, "the last stretch still reaches zero");
});

test("a fix that teleports forward is eased in, not believed at once", () => {
  // Skyways run parallel a block apart, so a route that doubles back lets a
  // drifting fix project onto a much later leg — remaining distance
  // collapses in one reading and the arrival time leaps minutes earlier.
  const eased = settleRemaining(400, 150);
  assert.ok(eased > 150, "a 250m collapse is not taken at face value");
  assert.equal(eased, 400 - DETOUR_METERS, "it moves by at most one detour's worth");

  // It must converge rather than deadlock: a walker who really is there
  // gets believed within a few fixes.
  let settled = 400;
  for (let i = 0; i < 6; i++) settled = settleRemaining(settled, 150);
  assert.equal(settled, 150, "a genuine jump is reached, not refused forever");
});

test("GPS jitter never pushes the destination further away", () => {
  // The recorded walk drifted ~45m off the skyway; on a 3-minute trip that
  // showed up as an arrival time going 11:15 -> 11:16 -> 11:15 -> 11:14.
  assert.equal(settleRemaining(200, 210), 200, "a small bounce backwards is held");
  assert.equal(settleRemaining(200, 200 + DETOUR_METERS), 200, "held right up to the threshold");
});

test("a genuine detour still moves the arrival time out", () => {
  const detoured = settleRemaining(200, 200 + DETOUR_METERS + 1);
  assert.equal(detoured, 200 + DETOUR_METERS + 1, "past the threshold the raw value wins");
});

test("a held value doesn't ratchet a real detour away one fix at a time", () => {
  // Each individual fix creeps up by less than the threshold, but the walker
  // really is heading the wrong way: the comparison is against the settled
  // value, so the trip has to cross the threshold once to give up on it —
  // and then tracks honestly from there.
  let settled = settleRemaining(null, 200);
  const away = [0.3, 0.6, 0.9, 1.2].map((f) => 200 + DETOUR_METERS * f);
  for (const raw of away) settled = settleRemaining(settled, raw);
  assert.equal(settled, away[away.length - 1], "a sustained walk away is eventually believed");
});

test("the detour threshold clears the drift it exists to absorb", () => {
  // map.ts accepts snapped corrections out to 60m on the grounds that
  // indoor skyway error runs 20-50m. A detour threshold inside that band
  // would classify the same drift as a real detour and believe it, which
  // is the bug this constant was introduced to prevent.
  assert.ok(DETOUR_METERS > 60, `threshold ${DETOUR_METERS} sits inside the drift band`);
  assert.ok(DETOUR_METERS < 100, "and must stay under a downtown block");
  assert.equal(settleRemaining(200, 245), 200, "a 45m indoor wander is still drift");
});
