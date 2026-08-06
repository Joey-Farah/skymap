/**
 * Recompute every POI's `group` from its `kind` + `category`.
 *
 * The group is baked into the committed dataset, so a classifier fix does
 * nothing until the data is rewritten. Re-running the full OSM extraction
 * would also churn hundreds of unrelated records against a live upstream;
 * this touches exactly the field that was wrong, and is idempotent.
 *
 *   node scripts/regroup-pois.mjs [--write]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { groupFor } from "../src/poi.ts";

const FILE = "public/data/skymap-data.json";
const write = process.argv.includes("--write");
const data = JSON.parse(readFileSync(FILE, "utf8"));

const moves = new Map();
for (const p of data.pois ?? []) {
  const want = groupFor(p.kind ?? "", p.category ?? "");
  if (want === p.group) continue;
  const key = `${p.group} -> ${want}`;
  if (!moves.has(key)) moves.set(key, []);
  moves.get(key).push(p.name);
  p.group = want;
}

if (moves.size === 0) {
  console.log("no changes — groups already match the classifier");
} else {
  for (const [key, names] of moves) {
    console.log(`${key}  (${names.length})`);
    for (const n of names.slice(0, 15)) console.log(`    ${n}`);
    if (names.length > 15) console.log(`    ...and ${names.length - 15} more`);
  }
}

if (write) {
  // Same indentation fetch-osm.mjs writes with. Minifying instead collapsed
  // the dataset to a single 38,000-line-shorter line, which is functionally
  // identical and makes every future data diff unreadable.
  writeFileSync(FILE, JSON.stringify(data, null, 1) + "\n");
  console.log(`\nwrote ${FILE}`);
} else {
  console.log("\n(dry run — pass --write to apply)");
}
