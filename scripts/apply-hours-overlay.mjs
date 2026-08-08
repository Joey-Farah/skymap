/**
 * Merge the curated hours overlay into the extracted dataset.
 *
 * The overlay is the durable artefact; `public/data/skymap-data.json` is
 * regenerated from OSM and would otherwise lose every curated hour on the
 * next `npm run data:osm`. Run this after any extraction.
 *
 * The operator wins — for storefronts as well as buildings, since 2026-08-08.
 * See hours-precedence.mjs for why. Where OSM has independently arrived at
 * the same hours the overlay entry is redundant and reported as retirable.
 *
 *   node scripts/apply-hours-overlay.mjs [--write]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseOpeningHours } from "../src/opening-hours.ts";
import { decideBuilding, decidePoi, stalenessWarnings } from "./hours-precedence.mjs";

const DATA = "public/data/skymap-data.json";
const OVERLAY = "data/hours-overlay.json";
const write = process.argv.includes("--write");

const data = JSON.parse(readFileSync(DATA, "utf8"));
const overlay = JSON.parse(readFileSync(OVERLAY, "utf8"));
const byId = new Map(data.pois.map((p) => [p.id, p]));
// Buildings are curated through the same overlay but stored differently:
// a POI keeps the raw opening_hours string and the app parses it at
// render time, while a building keeps the parsed DayHours[7] the router
// reads directly. Same source of truth, two shapes.
const buildingsById = new Map(data.buildings.map((b) => [b.id, b]));

let applied = 0;
const problems = [];
// Entries OSM has independently caught up with. Not problems — the data is
// right either way — so they are reported separately and don't fail the run.
const retirable = [];
for (const [id, entry] of Object.entries(overlay.hours)) {
  const parsed = parseOpeningHours(entry.openingHours);
  const building = buildingsById.get(id);
  if (building) {
    // The precedence policy lives in hours-precedence.mjs so it can be read
    // and tested on its own. Short version: the operator wins.
    const decision = decideBuilding(building, entry);
    if (decision.action === "problem") {
      problems.push(`${id} (${entry.name}): ${decision.reason}`);
      continue;
    }
    if (decision.action === "skip") continue;
    building.hours = decision.hours;
    building.hoursNote = "Curated from the operator's own published hours.";
    building.hoursSource = entry.source;
    building.hoursCheckedOn = entry.checkedOn;
    applied++;
    continue;
  }
  const poi = byId.get(id);
  if (!poi) {
    problems.push(`${id} (${entry.name}): no such POI or building — id changed or the place was removed`);
    continue;
  }
  // Refuse to ship syntax the app can't read: a value that fails to parse
  // renders as nothing, which looks identical to having no hours at all.
  if (!parsed) {
    problems.push(`${id} (${entry.name}): unparseable opening_hours ${JSON.stringify(entry.openingHours)}`);
    continue;
  }
  // Same policy as buildings, and for the same reason: the operator is the
  // primary source for its own storefront.
  const decision = decidePoi(poi, entry);
  if (decision.action === "problem") {
    problems.push(`${id} (${entry.name}): ${decision.reason}`);
    continue;
  }
  if (decision.action === "skip") continue;
  if (decision.action === "retire") {
    retirable.push(`${id} (${entry.name}): OSM independently has the same hours — overlay entry is redundant`);
    continue;
  }
  poi.openingHours = decision.openingHours;
  poi.hoursSource = entry.source;
  poi.hoursCheckedOn = entry.checkedOn;
  applied++;
}

// Retractions run after the additions above, so a building can never be
// both given curated hours and stripped of them in the same pass — if an
// operator ever publishes a real access window for one of these, its
// `hours` entry lands first and the retraction below is what has to be
// removed, which the mismatch reported here makes obvious.
let retracted = 0;
for (const [id, entry] of Object.entries(overlay.notAccessHours ?? {})) {
  const building = buildingsById.get(id);
  if (!building) {
    problems.push(`${id} (${entry.name}): no such building — id changed or the building was removed`);
    continue;
  }
  if (!entry.reason) {
    problems.push(`${id} (${entry.name}): retracted without saying why it isn't an access claim`);
    continue;
  }
  if (building.hours === null) continue; // idempotent re-run, or OSM dropped the tag
  building.hours = null;
  building.hoursNote = "OSM publishes hours for the venue here, not for walking through.";
  delete building.hoursSource;
  delete building.hoursCheckedOn;
  retracted++;
}

console.log(`applied ${applied} of ${Object.keys(overlay.hours).length} overlay entries`);
console.log(`retracted (OSM hours that were never an access claim): ${retracted}`);
console.log(`skipped (recorded, deliberately not applied): ${Object.keys(overlay.skipped ?? {}).length}`);
for (const p of problems) console.log(`  ! ${p}`);

if (retirable.length) {
  console.log(`\n${retirable.length} overlay entries OSM has caught up with:`);
  for (const r of retirable) console.log(`  - ${r}`);
}

// Not a failure — the data is still the best we have. But these now beat
// OSM by default, so a silent decay would be wrong in the confident
// direction, which is the failure mode this whole pass existed to remove.
const stale = stalenessWarnings(overlay.hours);
if (stale.length) {
  console.log(`\n${stale.length} curated entries want re-checking:`);
  for (const s of stale) console.log(`  ~ ${s}`);
}

const eat = data.pois.filter((p) => ["food", "coffee"].includes(p.group));
const have = eat.filter((p) => p.openingHours).length;
console.log(`food+coffee hours coverage: ${have}/${eat.length} (${Math.round((100 * have) / eat.length)}%)`);
const known = data.buildings.filter((b) => b.hours !== null).length;
console.log(`buildings with published hours: ${known}/${data.buildings.length}`);

if (write) {
  writeFileSync(DATA, JSON.stringify(data, null, 1) + "\n");
  console.log(`wrote ${DATA}`);
} else {
  console.log("(dry run — pass --write to apply)");
}
process.exit(problems.length ? 1 : 0);
