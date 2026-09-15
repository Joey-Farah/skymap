import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 1.14 screenshots: straight lines across the map where there is no skyway --
// LaSalle at 10th's label drawn to Target Plaza III's, cutting through the
// block. Each was a curated ramp's skyway link. The operator says the link
// exists; nobody has traced where it runs, so the app drew it centroid to
// centroid. A path the app can't show truthfully is a path it doesn't show.
const data = JSON.parse(readFileSync("public/data/skymap-data.json", "utf8"));

test("every skyway link the app ships follows a traced path", () => {
  const untraced = data.edges
    .filter((e) => !(e.geometry?.length >= 2))
    .map((e) => `${e.from} -> ${e.to}`);
  assert.deepEqual(untraced, []);
});
