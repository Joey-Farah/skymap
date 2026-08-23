import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildComboEntries, searchEntries } from "../src/combo.ts";

// These test the reports, not the implementation. A reader said a Spyhouse
// in a Marriott lobby was missing; the question this file answers is
// whether someone who walks into the skyway looking for it now finds it --
// through the same search the app's From/To picker uses, against the
// dataset the app actually ships.
const data = JSON.parse(readFileSync("public/data/skymap-data.json", "utf8"));
const entries = buildComboEntries(data.buildings, data.pois);
const find = (q) => searchEntries(entries, q);

test("the reported coffee shop is findable by name", () => {
  const hits = find("spyhouse");
  assert.ok(hits.length > 0, "Spyhouse Coffee returns nothing in search");
  assert.equal(hits[0].label, "Spyhouse Coffee");
});

test("it is filed in the building it is actually in", () => {
  const poi = data.pois.find((p) => p.name === "Spyhouse Coffee");
  assert.equal(poi.buildingId, "emery-autograph-collection-62006964");
  // Giulia, in the same lobby, was already there. Both, now.
  const giulia = data.pois.find((p) => p.name === "Giulia");
  assert.equal(giulia.buildingId, poi.buildingId);
});

test("it appears under the chip someone hunting coffee would tap", () => {
  const poi = data.pois.find((p) => p.name === "Spyhouse Coffee");
  assert.equal(poi.group, "coffee");
});

test("the venues OSM mapped as buildings are places again", () => {
  // The class of bug the report exposed: mapped in OSM as a tagged
  // polygon, read by the extractor as a building only, so present on the
  // map as an unlabelled shape and absent from search entirely.
  for (const name of ["Murray's", "Cowboy Jack's", "Monte Carlo", "Gluek's Restaurant & Bar"]) {
    const hits = find(name);
    assert.ok(hits.length > 0, `${name} returns nothing in search`);
  }
});

test("a restaurant that is its own building is filed under food", () => {
  const murrays = data.pois.filter((p) => p.name === "Murray's");
  assert.equal(murrays.length, 1, "Murray's should be one record, not two");
  assert.equal(murrays[0].group, "food");
});

test("a single-tenant building does not list twice in search", () => {
  // It is both a building and a business; only one row should come back.
  for (const name of ["Murray's", "Cowboy Jack's"]) {
    const labels = find(name).map((e) => e.label);
    assert.equal(labels.filter((l) => l === name).length, 1, `${name} lists ${labels.filter((l) => l === name).length} times`);
  }
});

test("the buildings marked in the previous release still carry their markers", () => {
  // This change emits POIs from building tags, and fetch-osm suppresses a
  // building's marker when a POI of the same name exists -- so the failure
  // mode is silently undoing the earlier release. Hotels are the case that
  // report was about.
  const markers = data.pois.filter((p) => p.kind === "building");
  assert.ok(markers.length >= 20, `only ${markers.length} building markers remain`);
  for (const name of ["Minneapolis Marriott City Center", "The Westin Minneapolis", "Hilton Minneapolis"]) {
    assert.ok(
      markers.some((m) => m.name === name),
      `${name} lost its marker`,
    );
  }
});

test("closed places are gone and re-verified ones stayed", () => {
  const ids = new Set(data.pois.map((p) => p.id));
  assert.ok(!ids.has("poi-2387569338"), "The Seville is closed and should be removed");
  assert.ok(!ids.has("poi-11248557998"), "Midwest Motorcycle is closed and should be removed");
  // Both of these were on a fortnight-old list of closures and are open.
  assert.ok(ids.has("poi-9219442092"), "FedEx Office is open and must not be removed");
  assert.ok(ids.has("poi-6780251057"), "Dreamgirls is open and must not be removed");
});

test("every curated place carries its sources", () => {
  // The overlay is only trustworthy if each entry can be re-checked.
  const overlay = JSON.parse(readFileSync("data/poi-overlay.json", "utf8"));
  for (const [id, entry] of Object.entries(overlay.added)) {
    assert.ok(entry.sources?.length >= 2, `${id} has fewer than two sources`);
    assert.match(entry.checkedOn, /^\d{4}-\d{2}-\d{2}$/, `${id} has no check date`);
  }
});

test("re-applying the overlay never recommends deleting curated data", () => {
  // The overlay reports an entry as retirable when OSM has caught up with
  // it, and its README says to delete retirable entries. The check matched
  // the script's own previously-inserted POI, so a second run declared all
  // seven redundant — and following that instruction would have deleted the
  // only record of every place OSM doesn't have.
  const out = execFileSync("node", ["scripts/apply-poi-overlay.mjs"], { encoding: "utf8" });
  assert.match(out, /Curated POIs applied: 7 of 7\./);
  assert.doesNotMatch(out, /caught up with/);
  assert.doesNotMatch(out, /PROBLEM/);
});
