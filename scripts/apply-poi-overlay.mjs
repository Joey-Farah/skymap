/**
 * Merge the curated POI overlay into the extracted dataset.
 *
 * `npm run data:osm` rewrites public/data/skymap-data.json from OpenStreetMap,
 * so anything OSM doesn't know has to live outside it and be re-applied. That
 * is what data/poi-overlay.json is: places OSM is missing, recorded with their
 * sources. Run this after every extraction, alongside apply-hours-overlay.mjs.
 *
 * An entry whose place OSM has since acquired is reported as retirable rather
 * than added twice — the upstream record is the better one, and carrying both
 * would put two identical rows in search.
 *
 *   node scripts/apply-poi-overlay.mjs [--write]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { groupFor } from "../src/poi.ts";
import { parseOpeningHours } from "../src/opening-hours.ts";

const DATA = "public/data/skymap-data.json";
const OVERLAY = "data/poi-overlay.json";
const write = process.argv.includes("--write");

const data = JSON.parse(readFileSync(DATA, "utf8"));
const overlay = JSON.parse(readFileSync(OVERLAY, "utf8"));
const buildingsById = new Map(data.buildings.map((b) => [b.id, b]));

// Names are compared the way a person would read them, not byte for byte:
// OSM writes "Spyhouse Coffee Roasters" where the operator writes "Spyhouse
// Coffee", and an accent or an ampersand shouldn't decide whether we ship a
// duplicate pin.
const norm = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

let applied = 0;
const problems = [];
const retirable = [];

for (const [id, entry] of Object.entries(overlay.added)) {
  const building = buildingsById.get(entry.buildingId);
  if (!building) {
    // A renamed or re-extracted building changes id, and silently dropping
    // the entry would lose a curated place with no signal. Loud instead.
    problems.push(`${id} (${entry.name}): host building ${entry.buildingId} is not in the dataset`);
    continue;
  }
  // An opening_hours string the app can't parse renders as no hours at all,
  // which looks identical to having curated nothing -- so it would sit here
  // looking done while doing nothing. Aurora caught this: three services a
  // day is unrepresentable in the one-interval shape the app renders.
  if (entry.openingHours && !parseOpeningHours(entry.openingHours)) {
    problems.push(`${id} (${entry.name}): openingHours ${JSON.stringify(entry.openingHours)} does not parse`);
    continue;
  }
  const mine = norm(entry.name);
  const already = data.pois.find(
    (p) => p.buildingId === entry.buildingId && (norm(p.name) === mine || norm(p.name).includes(mine)),
  );
  if (already) {
    retirable.push(`${id} (${entry.name}): OSM now carries this as ${already.id} — overlay entry is redundant`);
    continue;
  }
  data.pois.push({
    id,
    name: entry.name,
    category: entry.category,
    kind: entry.kind,
    // Asked rather than asserted, so the overlay can't file a cafe somewhere
    // the extractor wouldn't have. Same rule that stopped 13 hotels landing
    // under Landmarks.
    group: groupFor(entry.kind, entry.category),
    lat: building.lat,
    lon: building.lon,
    buildingId: entry.buildingId,
    ...(entry.openingHours ? { openingHours: entry.openingHours } : {}),
    ...(entry.website ? { website: entry.website } : {}),
  });
  applied++;
}

for (const p of problems) console.error(`PROBLEM ${p}`);
if (retirable.length) {
  console.log(`${retirable.length} overlay ${retirable.length === 1 ? "entry" : "entries"} OSM has caught up with:`);
  for (const r of retirable) console.log(`  - ${r}`);
}
console.log(`Curated POIs applied: ${applied} of ${Object.keys(overlay.added).length}.`);

if (problems.length) {
  console.error("Refusing to write with unresolved problems above.");
  process.exit(1);
}
if (write) {
  writeFileSync(DATA, JSON.stringify(data, null, 1) + "\n");
  console.log(`wrote ${DATA}`);
} else {
  console.log("(dry run — pass --write to apply)");
}
