import test from "node:test";
import assert from "node:assert/strict";
import { locateTransition } from "../src/locate-mode.ts";

test("tap cycle: off -> lock -> heading -> off", () => {
  let t = locateTransition("off", "tap");
  assert.deepEqual(t, { mode: "lock", intercept: false, heading: false, resetBearing: false });
  t = locateTransition("lock", "tap");
  assert.deepEqual(t, { mode: "heading", intercept: true, heading: true, resetBearing: false });
  t = locateTransition("heading", "tap");
  assert.deepEqual(t, { mode: "off", intercept: false, heading: false, resetBearing: true });
});

test("while navigating, the cycle can't tap its way to tracking off", () => {
  // The control is visible during navigation as of 1.2 so the map can be
  // turned heading-up mid-corridor. That also puts the cycle's third state
  // — tracking off — one tap away, and turning tracking off mid-trip stops
  // every position callback: the banner keeps naming a building, the
  // arrival clock freezes, the walker and the walked line vanish, and
  // nothing on screen says the trip is no longer live. End exists for
  // stopping a trip deliberately; the locate button must not do it by
  // accident. Navigating, the cycle is lock <-> heading.
  const t = locateTransition("heading", "tap", { navigating: true });
  assert.deepEqual(t, { mode: "lock", intercept: true, heading: false, resetBearing: true });

  // Getting into heading mode is unchanged.
  assert.deepEqual(locateTransition("lock", "tap", { navigating: true }), {
    mode: "heading", intercept: true, heading: true, resetBearing: false,
  });

  // Outside navigation the third tap still turns tracking off.
  assert.equal(locateTransition("heading", "tap").mode, "off");
  assert.equal(locateTransition("heading", "tap", { navigating: false }).mode, "off");
});

test("panning away (blur) drops heading but keeps the rotation the user sees", () => {
  const t = locateTransition("heading", "blur");
  assert.deepEqual(t, { mode: "background", intercept: false, heading: false, resetBearing: false });
});

test("tap from background re-centers via MapLibre, no interception", () => {
  const t = locateTransition("background", "tap");
  assert.deepEqual(t, { mode: "lock", intercept: false, heading: false, resetBearing: false });
});

test("refocus after re-center returns to lock", () => {
  const t = locateTransition("background", "focus");
  assert.equal(t.mode, "lock");
});

test("tracking ending while heading is active resets north", () => {
  const t = locateTransition("heading", "end");
  assert.deepEqual(t, { mode: "off", intercept: false, heading: false, resetBearing: true });
});

test("tracking ending from plain lock does not touch bearing", () => {
  const t = locateTransition("lock", "end");
  assert.deepEqual(t, { mode: "off", intercept: false, heading: false, resetBearing: false });
});
