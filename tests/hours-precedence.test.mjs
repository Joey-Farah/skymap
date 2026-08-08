import test from "node:test";
import assert from "node:assert/strict";

import { decideBuilding, decidePoi, stalenessWarnings, STALE_AFTER_DAYS } from "../scripts/hours-precedence.mjs";

const NOW = new Date(2026, 7, 8); // 2026-08-08
const entry = {
  name: "111 Washington Square",
  openingHours: "Mo-Fr 06:00-18:00",
  source: "https://example.com/tenant-handbook",
  checkedOn: "2026-08-07",
};

test("an operator's own published hours outrank OSM", () => {
  // The reason for the flip: of the eight buildings with operator-sourced
  // hours, seven were stricter than what would otherwise show. Overstating
  // hours sends someone to a locked door; understating costs a detour. The
  // operator is the primary source for its own front door.
  const osmHours = Array(7).fill([390, 1320]); // open every day, 06:30-22:00
  const d = decideBuilding({ hours: osmHours }, entry);
  assert.equal(d.action, "apply");
});

test("a storefront's own published hours outrank OSM too", () => {
  // Storefronts ran the opposite rule until 2026-08-08 — OSM won and the
  // overlay entry was reported as retirable. Regenerating after OSM picked
  // up hours for Hibachi Daruma would have shipped a 19:00 close over the
  // restaurant's own 18:30, which is the overstatement the whole curation
  // pass exists to avoid. One rule for both shapes.
  const d = decidePoi({ openingHours: "Mo-Fr 11:00-19:00; Sa 11:30-19:00; Su off" }, entry);
  assert.equal(d.action, "apply");
  assert.equal(d.openingHours, entry.openingHours);
});

test("a storefront entry that merely agrees with OSM is retirable, not a conflict", () => {
  // The overlay has done its job here; keeping it around means re-checking
  // a claim OSM already carries.
  const d = decidePoi({ openingHours: entry.openingHours }, entry);
  assert.equal(d.action, "retire");
});

test("re-running over an already-applied storefront changes nothing", () => {
  const applied = { openingHours: entry.openingHours, hoursSource: entry.source };
  assert.equal(decidePoi(applied, entry).action, "skip");
});

test("an operator entry still fills a gap when OSM knows nothing", () => {
  assert.equal(decideBuilding({ hours: null }, entry).action, "apply");
});

test("re-running over already-applied data changes nothing", () => {
  const applied = { hours: Array(7).fill([360, 1080]), hoursSource: entry.source };
  assert.equal(decideBuilding(applied, entry).action, "skip");
});

test("an entry without a source is refused, however plausible its hours", () => {
  // Winning by default is only defensible when the entry says where it came
  // from — otherwise the flip would let unsourced guesses beat OSM.
  const d = decideBuilding({ hours: null }, { ...entry, source: undefined });
  assert.equal(d.action, "problem");
  assert.match(d.reason, /source/i);
});

test("an entry whose hours the parser can't hold is refused, not shipped blank", () => {
  const d = decideBuilding({ hours: null }, { ...entry, openingHours: "Sep-May Mo-Fr 09:00-21:00" });
  assert.equal(d.action, "problem");
  assert.match(d.reason, /unparseable/i);
});

test("curated hours go stale, and staleness is reported rather than trusted", () => {
  // Beating OSM by default means the curated set can rot into being wrong
  // in the confident direction. OSM keeps getting edited; a checkedOn date
  // does not.
  const old = new Date(NOW);
  old.setDate(old.getDate() - (STALE_AFTER_DAYS + 1));
  const iso = (d) => d.toISOString().slice(0, 10);

  const warnings = stalenessWarnings(
    {
      "fresh-1": { name: "Fresh", checkedOn: iso(NOW), source: "x" },
      "stale-1": { name: "Stale", checkedOn: iso(old), source: "x" },
    },
    NOW,
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Stale/);
});

test("an entry with no checkedOn counts as stale", () => {
  const warnings = stalenessWarnings({ "x-1": { name: "Undated", source: "x" } }, NOW);
  assert.equal(warnings.length, 1);
});
