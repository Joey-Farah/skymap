import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildComboEntries, searchEntries } from "../src/combo.ts";
import { parkedAt } from "../src/ramp.ts";

// A reader said they "can never seem to get the Hennepin @ 10th ramp to
// show up". They were right, and it was not a search-matching problem: the
// extractor only takes OSM buildings that carry a name, so every unnamed
// parking structure downtown -- 27 of the 50 OSM maps -- has always been
// invisible. This file asks the reader's question of the dataset the app
// actually ships: type the ramp's name, get the ramp.
const data = JSON.parse(readFileSync("public/data/skymap-data.json", "utf8"));
const entries = buildComboEntries(data.buildings, data.pois);
const find = (q) => searchEntries(entries, q);

/** The Hennepin Ave & 10th St S stop -- the corner the reader named. The ramp
 * fronts Hennepin between 9th and 10th (cars in from 9th, out onto 10th), so
 * it stands a part-block off the intersection itself; a downtown block is
 * roughly 100m. */
const CORNER = { lat: 44.975493, lon: -93.278433 };

function metresFrom(building, point) {
  const dLat = (building.lat - point.lat) * 111_320;
  const dLon = (building.lon - point.lon) * 111_320 * Math.cos((point.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

test("the reported ramp is findable by the name on its sign", () => {
  const hits = find("Hennepin at 10th");
  assert.ok(hits.length > 0, "Hennepin at 10th returns nothing in search");
  assert.equal(hits[0].label, "Hennepin at 10th");
});

test("it is a parking ramp, standing on the corner the reader named", () => {
  const ramp = data.buildings.find((b) => b.name === "Hennepin at 10th");
  assert.ok(ramp, "Hennepin at 10th is not in the dataset");
  assert.equal(ramp.category, "parking");
  const off = metresFrom(ramp, CORNER);
  assert.ok(off <= 120, `Hennepin at 10th sits ${Math.round(off)}m from the corner it is named after`);
});

test("you can walk out of it -- a findable ramp with no skyway link is worse than none", () => {
  const edges = data.edges.filter((e) => e.from === "hennepin-at-10th-x" || e.to === "hennepin-at-10th-x");
  assert.ok(edges.length > 0, "Hennepin at 10th has no skyway link and cannot be routed out of");
});

test("every curated ramp carries its sources", () => {
  const overlay = JSON.parse(readFileSync("data/parking-overlay.json", "utf8"));
  for (const [id, entry] of Object.entries(overlay.added)) {
    assert.ok(entry.sources?.length >= 2, `${id} has fewer than two sources`);
    assert.match(entry.checkedOn, /^\d{4}-\d{2}-\d{2}$/, `${id} has no check date`);
  }
});

test("re-applying the overlay never recommends deleting curated data", () => {
  // The POI overlay shipped this bug: the retirable check matched the
  // script's own previously-inserted record, so a second run declared every
  // entry redundant and the README said to delete them.
  const out = execFileSync("node", ["scripts/apply-parking-overlay.mjs"], { encoding: "utf8" });
  assert.match(out, /Curated ramps applied: (\d+) of \1\./);
  assert.doesNotMatch(out, /caught up with/);
  assert.doesNotMatch(out, /PROBLEM/);
});

// --- Save My Ramp asked the wrong question -----------------------------
// "Am I parked in this ramp?" and "where would I join the skyway?" are two
// different questions -- onPosition's own comment says so -- and both were
// answered from mainNetworkBuildings(). Four real ramps sit off that
// component, so parking at any of them could never raise the prompt: the
// feature was silently unavailable exactly where someone had just parked.
test("standing in an off-network ramp still counts as parked there", () => {
  const off = ["hcmc-purple-parking-ramp-27346755", "riverfront-municipal-parking-ramp-99717608", "portland-avenue-ramp-156909997"];
  for (const id of off) {
    const ramp = data.buildings.find((b) => b.id === id);
    assert.ok(ramp, `${id} is not in the dataset`);
    const at = parkedAt(ramp.lat, ramp.lon, data.buildings);
    assert.equal(at?.id, id, `standing in ${ramp.name} does not read as parked there`);
  }
});

test("standing in the reported ramp counts as parked there", () => {
  const ramp = data.buildings.find((b) => b.name === "Hennepin at 10th");
  assert.equal(parkedAt(ramp.lat, ramp.lon, data.buildings)?.id, ramp.id);
});

test("a block away from a ramp is not parking in it", () => {
  // The budget that made this "essentially at it" rather than "somewhere
  // near it" is the whole reason the prompt isn't noise. Two blocks north
  // of Hennepin at 10th you are standing in Hawthorne Transportation
  // Center, which is a different ramp and the right answer -- what must
  // not happen is being offered the one you have walked away from.
  const ramp = data.buildings.find((b) => b.name === "Hennepin at 10th");
  assert.notEqual(parkedAt(ramp.lat + 0.0018, ramp.lon, data.buildings)?.id, ramp.id);
});

test("standing in an office building is not parking in one", () => {
  const office = data.buildings.find((b) => b.category === "office" && b.footprint.length > 2);
  const at = parkedAt(office.lat, office.lon, data.buildings);
  assert.equal(at, null, `standing in ${office.name} read as parked in ${at?.name}`);
});

test("every curated ramp is findable, and can be walked out of", () => {
  const overlay = JSON.parse(readFileSync("data/parking-overlay.json", "utf8"));
  for (const [id, entry] of Object.entries(overlay.added)) {
    const hits = find(entry.name);
    assert.ok(hits.length > 0, `${entry.name} returns nothing in search`);
    const building = data.buildings.find((b) => b.id === id);
    assert.equal(building?.category, "parking", `${entry.name} is not in the dataset as a ramp`);
    const linked = data.edges.some((e) => e.from === id || e.to === id);
    assert.ok(linked, `${entry.name} has no skyway link and cannot be routed out of`);
  }
});
