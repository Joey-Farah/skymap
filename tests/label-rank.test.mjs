import test from "node:test";
import assert from "node:assert/strict";
import { labelRank } from "../src/poi.ts";

// When a block is too crowded to name everything, MapLibre drops whatever
// it placed last. Without a sort key that order is the order records sit
// in the JSON file — so which restaurant keeps its name downtown was
// decided by the extractor's output order. This makes the choice a real
// one, and a stable one: the same place wins every time you pan back.

const base = { id: "p1", name: "Somewhere", category: "restaurant", kind: "amenity",
               group: "food", lat: 44.97, lon: -93.27, buildingId: "b1" };

test("a place with published hours outranks one without", () => {
  const known = labelRank({ ...base, openingHours: "Mo-Fr 07:00-18:00" });
  const unknown = labelRank({ ...base });
  assert.ok(known < unknown, `hours ${known} should sort before bare ${unknown}`);
});

test("a website or a logo beats knowing nothing at all", () => {
  const bare = labelRank({ ...base });
  assert.ok(labelRank({ ...base, website: "https://example.com" }) < bare);
  assert.ok(labelRank({ ...base, logo: "example-com" }) < bare);
});

test("hours still beat a website — hours are the curated signal", () => {
  // 372 places were researched by hand for hours; a website is just an OSM
  // tag. The one we paid for should win the space.
  assert.ok(
    labelRank({ ...base, openingHours: "Mo-Fr 09:00-17:00" }) <
    labelRank({ ...base, website: "https://example.com" }),
  );
});

test("the rank is stable and numeric, so MapLibre can sort on it", () => {
  const r = labelRank({ ...base, openingHours: "24/7" });
  assert.equal(typeof r, "number");
  assert.ok(Number.isFinite(r));
  assert.equal(r, labelRank({ ...base, openingHours: "24/7" }));
});
