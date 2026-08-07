/**
 * Merge the curated hours overlay into the extracted dataset.
 *
 * The overlay is the durable artefact; `public/data/skymap-data.json` is
 * regenerated from OSM and would otherwise lose every curated hour on the
 * next `npm run data:osm`. Run this after any extraction.
 *
 * OSM always wins. If a POI has picked up real `opening_hours` upstream,
 * that is the better source — it is maintained by people who can see the
 * door — and the overlay entry has done its job and can be retired.
 *
 *   node scripts/apply-hours-overlay.mjs [--write]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseOpeningHours } from "../src/opening-hours.ts";

const DATA = "public/data/skymap-data.json";
const OVERLAY = "data/hours-overlay.json";
const write = process.argv.includes("--write");

const data = JSON.parse(readFileSync(DATA, "utf8"));
const overlay = JSON.parse(readFileSync(OVERLAY, "utf8"));
const byId = new Map(data.pois.map((p) => [p.id, p]));

let applied = 0;
const problems = [];
for (const [id, entry] of Object.entries(overlay.hours)) {
  const poi = byId.get(id);
  if (!poi) {
    problems.push(`${id} (${entry.name}): no such POI — id changed or the place was removed`);
    continue;
  }
  // Refuse to ship syntax the app can't read: a value that fails to parse
  // renders as nothing, which looks identical to having no hours at all.
  if (!parseOpeningHours(entry.openingHours)) {
    problems.push(`${id} (${entry.name}): unparseable opening_hours ${JSON.stringify(entry.openingHours)}`);
    continue;
  }
  if (poi.openingHours) {
    // Distinguish "already applied" from "OSM caught up" — they call for
    // opposite actions, and a run over an already-patched dataset would
    // otherwise report every entry as retirable.
    if (poi.hoursSource === entry.source) continue; // idempotent re-run
    problems.push(`${id} (${entry.name}): OSM now has hours — retire this overlay entry`);
    continue;
  }
  poi.openingHours = entry.openingHours;
  poi.hoursSource = entry.source;
  poi.hoursCheckedOn = entry.checkedOn;
  applied++;
}

console.log(`applied ${applied} of ${Object.keys(overlay.hours).length} overlay entries`);
console.log(`skipped (recorded, deliberately not applied): ${Object.keys(overlay.skipped ?? {}).length}`);
for (const p of problems) console.log(`  ! ${p}`);

const eat = data.pois.filter((p) => ["food", "coffee"].includes(p.group));
const have = eat.filter((p) => p.openingHours).length;
console.log(`food+coffee hours coverage: ${have}/${eat.length} (${Math.round((100 * have) / eat.length)}%)`);

if (write) {
  writeFileSync(DATA, JSON.stringify(data, null, 1) + "\n");
  console.log(`wrote ${DATA}`);
} else {
  console.log("(dry run — pass --write to apply)");
}
process.exit(problems.length ? 1 : 0);
