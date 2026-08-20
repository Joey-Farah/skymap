/**
 * Give every pin-worthy building a POI of its own, in the committed dataset.
 *
 * Pins are drawn only from the POI layer, so a building with no POI inside
 * it is invisible to anyone tapping a category chip. fetch-osm.mjs emits
 * these markers now, but `npm run data:osm` hits Overpass live and there is
 * no cached raw response in the repo — a full re-extraction would drag two
 * weeks of unrelated upstream OSM drift in alongside this fix. So this adds
 * exactly the missing records, the same way regroup-pois.mjs rewrites
 * exactly the field that was wrong.
 *
 * The marker itself comes from src/poi.ts, so this and the extraction
 * cannot drift apart. Idempotent: a second run finds nothing to do.
 *
 *   node scripts/mark-buildings.mjs [--write]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildingMarker, MARKED_BUILDING_CATEGORIES } from "../src/poi.ts";

const FILES = ["public/data/skymap-data.json", "public/data/skymap-data.osm.json"];
const write = process.argv.includes("--write");

for (const file of FILES) {
  const data = JSON.parse(readFileSync(file, "utf8"));

  // On-network means "has a skyway edge". That is the same question
  // fetch-osm.mjs asks of its main component, answered against the finished
  // dataset instead of the half-built graph.
  const onNetwork = new Set();
  for (const e of data.edges ?? []) {
    onNetwork.add(e.from);
    onNetwork.add(e.to);
  }

  // A building whose name is already on the map needs nothing — the Sheraton
  // is carried by a POI of its own name. Names, not ids, because that is how
  // dedupePois decides identity.
  const takenNames = new Set((data.pois ?? []).map((p) => p.name));

  const added = [];
  for (const b of data.buildings ?? []) {
    if (!MARKED_BUILDING_CATEGORIES.has(b.category)) continue;
    if (takenNames.has(b.name)) continue;
    // Only the on-network case belongs here. An unreachable building needs a
    // nearest-host search against the skyway graph, which is fetch-osm.mjs's
    // job — and every such building already has its landmark- record.
    if (!onNetwork.has(b.id)) continue;
    data.pois.push(buildingMarker(b, b.id, true));
    takenNames.add(b.name);
    added.push(`${b.category.padEnd(10)} ${b.name}`);
  }

  console.log(`${file}: ${added.length} marker(s)`);
  for (const line of added) console.log(`    ${line}`);

  if (added.length && write) {
    // Same indentation fetch-osm.mjs writes with — minifying makes every
    // future data diff unreadable.
    writeFileSync(file, JSON.stringify(data, null, 1) + "\n");
    console.log(`  wrote ${file}`);
  }
}

if (!write) console.log("\n(dry run — pass --write to apply)");
