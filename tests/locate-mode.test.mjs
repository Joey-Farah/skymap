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
