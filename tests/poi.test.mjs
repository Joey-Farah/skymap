import test from "node:test";
import assert from "node:assert/strict";
import { dedupePois, groupFor, landmarkNear, resolvePoiHost, safeWebsiteUrl } from "../src/poi.ts";

test("a hotel is a hotel however it got into the dataset", () => {
  // Off-network landmark buildings are emitted with kind "landmark", and
  // that path used to hardcode group "landmark" rather than asking here.
  // 13 of downtown's hotels ended up filed under Landmarks that way —
  // more than were in Hotels — so the Hotels filter was mostly empty and
  // the Lofton, the Hewing and the Chambers were unfindable by it.
  assert.equal(groupFor("landmark", "hotel"), "hotel");
  assert.equal(groupFor("tourism", "hotel"), "hotel");
  assert.equal(groupFor("landmark", "hostel"), "hotel");
});

test("a landmark building stays a landmark", () => {
  // The same path carries genuine landmarks, which must survive the fix
  // above — groupFor knows nothing about these categories on its own.
  assert.equal(groupFor("landmark", "venue"), "landmark");
  assert.equal(groupFor("landmark", "government"), "landmark");
  assert.equal(groupFor("landmark", "artwork"), "landmark");
});

test("a hotel is a usable wayfinding cue", () => {
  // Splitting hotels out of the landmark group silently cost four
  // buildings their only "past X" cue — parking ramps among them, which is
  // exactly where a named hotel earns its place.
  const pois = [
    { name: "Hilton Garden Inn", buildingId: "ramp", group: "hotel" },
    { name: "Zebra Lounge", buildingId: "ramp", group: "food" },
  ];
  assert.equal(landmarkNear(pois, "ramp").name, "Hilton Garden Inn", "alphabetical, and hotels count");
  assert.equal(landmarkNear([pois[0]], "ramp").name, "Hilton Garden Inn", "a hotel alone is still a cue");

  // Things you can't see from a corridor are still not cues.
  assert.equal(landmarkNear([{ name: "Lift", buildingId: "ramp", group: "elevator" }], "ramp"), null);
});

test("wayfinding and food classification is unchanged", () => {
  assert.equal(groupFor("amenity", "elevator"), "elevator");
  assert.equal(groupFor("amenity", "toilets"), "restroom");
  assert.equal(groupFor("transit", "bus_stop"), "transit");
  assert.equal(groupFor("amenity", "cafe"), "coffee");
  assert.equal(groupFor("amenity", "restaurant"), "food");
  assert.equal(groupFor("shop", "jewelry"), "other");
});

test("ordinary http and https links pass through unchanged", () => {
  assert.equal(safeWebsiteUrl("https://example.com/menu"), "https://example.com/menu");
  assert.equal(safeWebsiteUrl("http://example.com"), "http://example.com");
});

test("surrounding whitespace is trimmed", () => {
  assert.equal(safeWebsiteUrl("  https://example.com  "), "https://example.com");
});

test("javascript: URIs are rejected", () => {
  // The reason this guard exists: OSM is publicly editable and the tag
  // value lands straight in an anchor href, so this would execute in the
  // app's own context the moment someone taps "Website".
  assert.equal(safeWebsiteUrl("javascript:alert(1)"), undefined);
  assert.equal(safeWebsiteUrl("JavaScript:alert(1)"), undefined);
  // The URL parser strips tabs/newlines, so an obfuscated scheme still
  // has to be caught after normalization rather than by naive prefix match.
  assert.equal(safeWebsiteUrl("java\nscript:alert(1)"), undefined);
});

test("data: and other non-web schemes are rejected", () => {
  assert.equal(safeWebsiteUrl("data:text/html,<script>alert(1)</script>"), undefined);
  assert.equal(safeWebsiteUrl("file:///etc/passwd"), undefined);
});

test("missing or unparseable values yield undefined so the link is omitted", () => {
  assert.equal(safeWebsiteUrl(undefined), undefined);
  assert.equal(safeWebsiteUrl(""), undefined);
  assert.equal(safeWebsiteUrl("not a url at all"), undefined);
});

// --- resolvePoiHost: which building a place belongs to --------------------
// Two network buildings, ~150 m apart, each a small square footprint.
const near = {
  id: "near-tower",
  lat: 44.975,
  lon: -93.27,
  footprint: [
    [-93.2705, 44.9747],
    [-93.2695, 44.9747],
    [-93.2695, 44.9753],
    [-93.2705, 44.9753],
  ],
};
const far = {
  id: "far-tower",
  lat: 44.9765,
  lon: -93.2725,
  footprint: [
    [-93.273, 44.9762],
    [-93.272, 44.9762],
    [-93.272, 44.9768],
    [-93.273, 44.9768],
  ],
};
const buildings = [near, far];

test("a place inside a building's footprint belongs to that building", () => {
  const host = resolvePoiHost(44.975, -93.27, buildings, 120);
  assert.equal(host?.building.id, "near-tower");
  assert.equal(host?.nearby, false, "it is genuinely inside, not merely close");
});

test("a place just outside every footprint attaches to the nearest building", () => {
  // The Target at 900 Nicollet is exactly this: inside a building the skyway
  // graph never captured, ~78 m from the nearest one it did. Before this it
  // was discarded and JEB couldn't find it.
  const host = resolvePoiHost(44.9756, -93.27, buildings, 120);
  assert.equal(host?.building.id, "near-tower");
  assert.equal(host?.nearby, true, "must be flagged so the card doesn't claim containment");
});

test("a place beyond the radius is still not invented into the network", () => {
  assert.equal(resolvePoiHost(44.99, -93.3, buildings, 120), null);
});

test("nearest wins when two buildings are both in range", () => {
  const host = resolvePoiHost(44.9762, -93.2724, buildings, 200);
  assert.equal(host?.building.id, "far-tower");
});

// --- dedupePois: the same place mapped twice -----------------------------
// Calibrated against the real extraction: genuine duplicates sit at ~0 m
// (one business, two OSM objects), while the closest pair of same-name
// chain branches downtown is 182 m apart. 25 m sits between them with a lot
// of room, so collapsing by name alone is never necessary.
const at = (name, lat, lon, extra = {}) => ({
  id: `${name}-${lat}-${lon}`,
  name,
  category: "cafe",
  group: "coffee",
  lat,
  lon,
  buildingId: "b1",
  ...extra,
});

test("the same business mapped twice collapses to one", () => {
  const kept = dedupePois([at("CRAVE", 44.975, -93.27), at("CRAVE", 44.975, -93.27)], 25);
  assert.equal(kept.length, 1);
});

test("two branches of a chain both survive", () => {
  // ~180 m apart, the real Starbucks spacing downtown. Collapsing these
  // would delete a shop someone is standing next to.
  const kept = dedupePois([at("Starbucks", 44.975, -93.27), at("Starbucks", 44.9766, -93.27)], 25);
  assert.equal(kept.length, 2);
});

test("generically-named features are never collapsed", () => {
  // "Elevator" and "Public restroom" are our own fallback names for unnamed
  // OSM features — two elevators 17 m apart in one lobby are two elevators,
  // not one mapped twice.
  const lifts = [
    at("Elevator", 44.975, -93.27, { category: "elevator", group: "elevator" }),
    at("Elevator", 44.975, -93.27, { category: "elevator", group: "elevator" }),
  ];
  assert.equal(dedupePois(lifts, 25).length, 2);
});

test("different names at the same spot are both kept", () => {
  const kept = dedupePois([at("CRAVE", 44.975, -93.27), at("Muffin Top", 44.975, -93.27)], 25);
  assert.equal(kept.length, 2);
});

test("the first occurrence is the one kept", () => {
  const first = at("CRAVE", 44.975, -93.27, { website: "https://crave.example" });
  const second = at("CRAVE", 44.975, -93.27);
  assert.equal(dedupePois([first, second], 25)[0].id, first.id);
});

test("the same name inside one building is one place, however far apart the pins", () => {
  // Gold Metal Flour is mapped twice as two 'sign' records 27m apart in
  // Humboldt Annex — just past the 25m distance rule, so both survived and
  // the map drew two pins for one sign. Across the whole dataset only five
  // name+building groups exist and the other four are "Elevator", which is
  // generically named and exempt, so this rule collapses exactly the real
  // duplicate and nothing else.
  const at = (name, lat, lon, buildingId, category = "sign") => ({
    id: `${name}-${lat}`, name, category, lat, lon, buildingId,
  });
  // ~27m apart, the real separation — deliberately past the 25m rule.
  const same = dedupePois([at("Gold Metal Flour", 44.98, -93.27, "humboldt"),
                           at("Gold Metal Flour", 44.98027, -93.27, "humboldt")], 25);
  assert.equal(same.length, 1, "one sign, one pin");

  // Two branches of a chain in DIFFERENT buildings both survive, however
  // close — Classic Cookie Co. and Sorrento Cucina are real pairs 44m and
  // 53m apart in neighbouring buildings.
  const branches = dedupePois([at("Sorrento Cucina", 44.98, -93.27, "emery", "fast_food"),
                               at("Sorrento Cucina", 44.98047, -93.27, "mcknight", "fast_food")], 25);
  assert.equal(branches.length, 2, "different buildings are different branches");

  // Generic names stay exempt: two lifts in one lobby are two lifts.
  const lifts = dedupePois([at("Elevator", 44.98, -93.27, "b", "elevator"),
                            at("Elevator", 44.98, -93.27, "b", "elevator")], 25);
  assert.equal(lifts.length, 2);
});
