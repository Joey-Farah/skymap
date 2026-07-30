import test from "node:test";
import assert from "node:assert/strict";
import { shouldExpand } from "../src/sheet-snap.ts";

const peekHeight = 200;
const expandedHeight = 600;
const at = (height, velocity) => shouldExpand({ height, velocity, peekHeight, expandedHeight });

test("a slow release settles to whichever end is nearer", () => {
  assert.equal(at(250, 0), false, "just above peek collapses");
  assert.equal(at(550, 0), true, "just under expanded opens");
  assert.equal(at(450, 0), true, "past the midpoint opens");
  assert.equal(at(350, 0), false, "short of the midpoint collapses");
});

test("a flick upward opens even when barely moved", () => {
  // The complaint this fixes: you flick up from peek, travel a fraction of
  // the way, and the sheet drops back because position alone decided it.
  assert.equal(at(240, 0.9), true);
});

test("a flick downward collapses even from near the top", () => {
  assert.equal(at(580, -0.9), false);
});

test("a drift too slow to be a flick still uses position", () => {
  // Otherwise a slow, deliberate drag to a chosen spot would get overridden
  // by whatever direction the finger happened to be creeping.
  assert.equal(at(250, 0.05), false);
  assert.equal(at(550, -0.05), true);
});
