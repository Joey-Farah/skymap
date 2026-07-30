import test from "node:test";
import assert from "node:assert/strict";
import { nearestCandidate } from "../src/tap-target.ts";

test("no candidates means no hit", () => {
  assert.equal(nearestCandidate([], { x: 100, y: 100 }), null);
});

test("a single candidate wins regardless of distance within the box", () => {
  const only = { id: "a", x: 112, y: 108 };
  assert.equal(nearestCandidate([only], { x: 100, y: 100 }), only);
});

test("the closest candidate to the finger wins", () => {
  // The case this exists for: two businesses a few pixels apart, both
  // inside the tap box. Picking the first one the renderer happened to
  // return would feel arbitrary — you'd tap one icon and open its neighbour.
  const near = { id: "near", x: 104, y: 100 };
  const far = { id: "far", x: 118, y: 100 };
  assert.equal(nearestCandidate([far, near], { x: 100, y: 100 }), near);
  assert.equal(nearestCandidate([near, far], { x: 100, y: 100 }), near);
});

test("distance is measured in both axes, not just horizontally", () => {
  const across = { id: "across", x: 110, y: 100 };
  const below = { id: "below", x: 100, y: 104 };
  assert.equal(nearestCandidate([across, below], { x: 100, y: 100 }), below);
});

test("an exact hit beats anything nearby", () => {
  const exact = { id: "exact", x: 100, y: 100 };
  const other = { id: "other", x: 101, y: 100 };
  assert.equal(nearestCandidate([other, exact], { x: 100, y: 100 }), exact);
});
