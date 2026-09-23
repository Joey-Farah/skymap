import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CHIP_GROUPS } from "../src/chips.ts";
import { GROUP_LABELS } from "../src/poi.ts";

test("the chips, in the order they wrap onto two rows", () => {
  // Four on top, three below — at 375pt too, which is why the pills are
  // tighter than they were with six. Parking sits beside Hotels: the two
  // things a visitor arriving downtown is looking for.
  assert.deepEqual(Object.keys(CHIP_GROUPS), ["coffee", "food", "hotel", "parking", "other", "restroom", "elevator"]);
});

test("every group that gets a pin can be switched on by some chip", () => {
  // Transit is the exception on purpose: stops are drawn on a layer of
  // their own, always on. Anything else missing here would be a group of
  // pins no one can ever see.
  const reachable = new Set(Object.values(CHIP_GROUPS).flat());
  const unreachable = Object.keys(GROUP_LABELS).filter((g) => g !== "transit" && !reachable.has(g));
  assert.deepEqual(unreachable, []);
});

test("a building's card has a heading for every group that can be inside it", () => {
  // ui.ts lists a building's interior places group by group; a group left
  // out of that list silently drops its places from the card (it happened
  // to 16 hotels once).
  const ui = readFileSync("src/ui.ts", "utf8");
  const order = ui.match(/const order: PoiGroup\[\] = \[([^\]]+)\]/)[1];
  const listed = new Set([...order.matchAll(/"(\w+)"/g)].map((m) => m[1]));
  const missing = Object.keys(GROUP_LABELS).filter((g) => g !== "transit" && !listed.has(g));
  assert.deepEqual(missing, []);
});
