import test from "node:test";
import assert from "node:assert/strict";
import { locateTransition, tapPosition } from "../src/locate-mode.ts";

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

test("a tap reads the cycle from the control's own state (QA 037)", () => {
  // The launch-time fix locks the map on without a "focus" event; the tap
  // must still see a locked map, so it goes to heading-up, not off.
  assert.equal(tapPosition("ACTIVE_LOCK", false), "lock");
  assert.equal(tapPosition("ACTIVE_LOCK", true), "heading");
  assert.equal(tapPosition("BACKGROUND", false), "background");
  assert.equal(tapPosition("WAITING_ACTIVE", false), "waiting");
  assert.equal(tapPosition("ACTIVE_ERROR", false), "error");
  assert.equal(tapPosition("BACKGROUND_ERROR", false), "error");
  assert.equal(tapPosition("OFF", false), "off");
  assert.equal(tapPosition(undefined, false), "off");
  assert.equal(locateTransition(tapPosition("ACTIVE_LOCK", false), "tap").mode, "heading");
});

test("a tap while searching keeps searching; after a failed search it can stop it, except mid-trip (QA 038, 027)", () => {
  const keep = { mode: "lock", intercept: true, heading: false, resetBearing: false };
  // Mid-trip, nothing a tap does turns location off.
  assert.deepEqual(locateTransition("waiting", "tap", { navigating: true }), keep);
  assert.deepEqual(locateTransition("error", "tap", { navigating: true }), keep);
  // The first search, on any screen: "find me", not "cancel".
  assert.deepEqual(locateTransition("waiting", "tap"), keep);
  // A search that has failed, outside a trip: the tap is the way to stop it.
  assert.deepEqual(locateTransition("error", "tap"), {
    mode: "off", intercept: false, heading: false, resetBearing: false,
  });
});

test("without a compass the cycle is on/off, but never off mid-trip", () => {
  assert.deepEqual(locateTransition("lock", "tap", { compassUnavailable: true }), {
    mode: "off", intercept: false, heading: false, resetBearing: false,
  });
  assert.deepEqual(locateTransition("lock", "tap", { compassUnavailable: true, navigating: true }), {
    mode: "lock", intercept: true, heading: false, resetBearing: false,
  });
});
