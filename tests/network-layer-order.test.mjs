import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A reader saw "little breakpoints in the paths all over the place". They
// were white nicks, not gaps: casing and line were added as a pair per
// source, so the bridges' 8px white casing landed above the indoor 4.5px
// blue line and painted across it at every junction. On a map whose whole
// job is saying "you can walk from here to there", an accidental gap is
// the worst thing it can draw.
const src = readFileSync("src/map.ts", "utf8");
const order = [...src.matchAll(/id: "(skyway-(?:indoor|bridges)-(?:casing|line))"/g)].map((m) => m[1]);

test("the network's casings are all drawn before any of its lines", () => {
  assert.deepEqual(order, [
    "skyway-indoor-casing",
    "skyway-bridges-casing",
    "skyway-indoor-line",
    "skyway-bridges-line",
  ]);
  const lastCasing = order.findLastIndex((id) => id.endsWith("-casing"));
  const firstLine = order.findIndex((id) => id.endsWith("-line"));
  assert.ok(lastCasing < firstLine, "a casing is drawn after a line and will paint over it");
});

test("bridges still sit above the indoor stretches they join", () => {
  // The fix is two coats, not a flattening: a bridge crossing a corridor
  // must still read as the thing on top.
  assert.ok(
    order.indexOf("skyway-bridges-line") > order.indexOf("skyway-indoor-line"),
    "the indoor line now paints over the bridge it joins",
  );
});
