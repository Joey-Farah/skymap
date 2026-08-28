import test from "node:test";
import assert from "node:assert/strict";
import {
  LABEL_INK,
  LABEL_WARNING,
  LABEL_HALO_SOLID,
  contrastRatio,
} from "../src/label-colors.ts";
import { GROUP_COLORS } from "../src/poi.ts";

// A reader told us the food places on the map took several passes to read.
// Amber #e08a00 on the labels' white halo is 2.69:1 — WCAG AA wants 4.5:1
// for text this size. The fix was to stop tinting label text by category
// at all: color lives in the pin, which carries the glyph anyway.
const AA = 4.5;

test("contrastRatio matches the WCAG definition", () => {
  assert.equal(contrastRatio("#ffffff", "#000000"), 21);
  assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);
  // Symmetric — order of arguments must not matter.
  assert.equal(
    contrastRatio("#e08a00", "#ffffff"),
    contrastRatio("#ffffff", "#e08a00"),
  );
});

test("every map label color clears AA against its halo", () => {
  for (const [name, color] of [
    ["ink", LABEL_INK],
    ["warning", LABEL_WARNING],
  ]) {
    const ratio = contrastRatio(color, LABEL_HALO_SOLID);
    assert.ok(
      ratio >= AA,
      `${name} label ${color} is ${ratio}:1 on the halo, needs ${AA}:1`,
    );
  }
});

test("category color never becomes label text", () => {
  // The guard that actually encodes the decision: these are pin fills.
  // Most of them cannot pass as text on a white halo, and the two that
  // could are not a licence to start tinting labels again.
  const failing = Object.entries(GROUP_COLORS).filter(
    ([, color]) => contrastRatio(color, LABEL_HALO_SOLID) < AA,
  );
  assert.ok(
    failing.length > 0,
    "if every pin color now clears AA this guard needs rewriting, not deleting",
  );
});
