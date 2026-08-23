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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { groupFor, nameKey } from "../src/poi.ts";
import { logoKey } from "../src/logo.ts";
import { parseOpeningHours } from "../src/opening-hours.ts";

const DATA = "public/data/skymap-data.json";
const OVERLAY = "data/poi-overlay.json";
const write = process.argv.includes("--write");

const data = JSON.parse(readFileSync(DATA, "utf8"));
const overlay = JSON.parse(readFileSync(OVERLAY, "utf8"));
const buildingsById = new Map(data.buildings.map((b) => [b.id, b]));

function logoFor(website) {
  const key = logoKey(website);
  return key && existsSync(join("public", "logos", `${key}.png`)) ? key : null;
}

let applied = 0;
const problems = [];
const retirable = [];
const absent = [];

for (const [id, entry] of Object.entries(overlay.added)) {
  if (id.startsWith("_")) continue;
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
  // Already applied. Skipping the entry's own record is what keeps the
  // retirable check below honest, but it also means a second run would
  // insert a second copy under the same id -- so answer that case first.
  if (data.pois.some((p) => p.id === id)) {
    applied++;
    continue;
  }
  const mine = nameKey(entry.name);
  const already = data.pois.find(
        (p) =>
      p.id !== id &&
      p.buildingId === entry.buildingId &&
      // Prefix, not substring: OSM writes "Spyhouse Coffee Roasters" where
      // the operator writes "Spyhouse Coffee", but an unanchored match on a
      // short name like "Mara" would let any future Amara or Tamarack in the
      // same building suppress it.
      (nameKey(p.name) === mine || nameKey(p.name).startsWith(mine)),
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
    // Same provenance the hours overlay attaches, so a curated hour can be
    // traced back to what it was read from whichever overlay put it there.
    ...(entry.openingHours
      ? { openingHours: entry.openingHours, hoursSource: entry.sources[0], hoursCheckedOn: entry.checkedOn }
      : {}),
    ...(entry.website ? { website: entry.website } : {}),
    // attachLogos runs inside the extractor, before this file is ever read,
    // so a curated place would sit next to extracted ones with a monogram
    // where they have a mark. The download belongs there, not here -- this
    // only claims a logo already on disk, so applying the overlay stays an
    // offline operation.
    ...(logoFor(entry.website) ? { logo: logoFor(entry.website) } : {}),
  });
  applied++;
}

// Removals last: a place that is gone should go whether or not it was also
// curated, and doing it after the adds keeps the two passes independent.
let removed = 0;
for (const [id, entry] of Object.entries(overlay.removed ?? {})) {
  if (id.startsWith("_")) continue;
  const i = data.pois.findIndex((p) => p.id === id);
  if (i === -1) {
    // Absent either because OSM dropped it too -- the outcome we want -- or
    // because this script already ran against this file. Only the first is
    // grounds for retiring the entry, and the two are indistinguishable
    // here, so this reports without recommending anything.
    absent.push(`${id} (${entry.name}): not in the dataset (already removed, or OSM dropped it too)`);
    continue;
  }
  data.pois.splice(i, 1);
  removed++;
}

for (const p of problems) console.error(`PROBLEM ${p}`);
if (retirable.length) {
  console.log(`${retirable.length} overlay ${retirable.length === 1 ? "entry" : "entries"} OSM has caught up with:`);
  for (const r of retirable) console.log(`  - ${r}`);
}
console.log(`Curated POIs applied: ${applied} of ${Object.keys(overlay.added).filter((k) => !k.startsWith("_")).length}.`);
if (absent.length) {
  console.log(`${absent.length} removal ${absent.length === 1 ? "entry" : "entries"} had nothing to remove:`);
  for (const a of absent) console.log(`  - ${a}`);
}
console.log(`Closed POIs removed: ${removed}.`);

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
