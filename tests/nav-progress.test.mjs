import test from "node:test";
import assert from "node:assert/strict";

import { DETOUR_METERS, settleRemaining } from "../src/nav-progress.ts";

test("the first fix of a trip is taken as-is", () => {
  assert.equal(settleRemaining(null, 240), 240);
});

test("walking towards the destination always counts", () => {
  assert.equal(settleRemaining(240, 200), 200);
  assert.equal(settleRemaining(200, 0), 0);
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
  for (const raw of [210, 225, 240, 260]) settled = settleRemaining(settled, raw);
  assert.equal(settled, 260, "a sustained walk away is eventually believed");
});
