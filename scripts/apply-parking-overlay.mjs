/**
 * Merge the curated parking overlay into the extracted dataset.
 *
 * `npm run data:osm` rewrites public/data/skymap-data.json from OpenStreetMap,
 * so a ramp OSM doesn't name has to live outside it and be re-applied. That is
 * what data/parking-overlay.json is. Run this after every extraction, alongside
 * apply-poi-overlay.mjs and apply-hours-overlay.mjs.
 *
 * An entry whose ramp OSM has since named is reported as retirable rather than
 * added twice — two ramps on one corner is worse than none, because both look
 * equally real in search.
 *
 *   node scripts/apply-parking-overlay.mjs [--write]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { nameKey } from "../src/poi.ts";

const DATA = "public/data/skymap-data.json";
const OVERLAY = "data/parking-overlay.json";
const write = process.argv.includes("--write");

/** Close enough that two records are the same ramp rather than neighbours.
 * A downtown block is roughly 100m, so this stays inside one. */
const SAME_RAMP_METERS = 45;

/** How far a same-named ramp may sit and still be the same ramp. A curated
 * entry is positioned from its street address and OSM from a traced outline,
 * so the two disagree by a building's width, not by a neighbourhood. */
const SAME_NAME_MAX_METERS = 200;

const data = JSON.parse(readFileSync(DATA, "utf8"));
const overlay = JSON.parse(readFileSync(OVERLAY, "utf8"));

function metresBetween(a, b) {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLon = (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

const curatedIds = new Set(Object.keys(overlay.added).filter((k) => !k.startsWith("_")));

let applied = 0;
const problems = [];
const retirable = [];

/** Record the buildings this entry's skyway access is through. Separate from
 * the building so it runs on every pass, not only the one that inserts it.
 *
 * Not an edge: nobody has traced where the link runs, and an edge with no
 * geometry was drawn centroid to centroid -- a straight line across the map
 * where there is no skyway. A route to the ramp ends at the access building
 * instead, the same way a place outside the network does. */
function applyLinks(id, entry) {
  data.edges = data.edges.filter((e) => e.geometry || (e.from !== id && e.to !== id));
  const access = [];
  for (const to of entry.connectsTo ?? []) {
    if (!data.buildings.some((b) => b.id === to)) {
      problems.push(`${id} (${entry.name}): connectsTo ${to}, which is not in the dataset`);
      continue;
    }
    access.push(to);
  }
  const building = data.buildings.find((b) => b.id === id);
  if (building) building.skywayAccess = access;
}

// Ramps OSM carries under a name nobody parks by. Renamed in place so the id,
// and every skyway edge traced against it, stays OSM's.
let renamed = 0;
for (const [id, entry] of Object.entries(overlay.renamed ?? {})) {
  if (id.startsWith("_")) continue;
  if (!(entry.sources?.length >= 2) || !/^\d{4}-\d{2}-\d{2}$/.test(entry.checkedOn ?? "")) {
    problems.push(`${id} (${entry.name}): rename needs two sources and a check date`);
    continue;
  }
  const building = data.buildings.find((b) => b.id === id);
  if (!building) {
    // Re-extraction changes an id when OSM renames or re-traces the way. A
    // rename that silently stops applying puts the unsearchable name back.
    problems.push(`${id} (${entry.name}): rename target is not in the dataset`);
    continue;
  }
  building.name = entry.name;
  renamed++;
}

for (const [id, entry] of Object.entries(overlay.added)) {
  if (id.startsWith("_")) continue;
  // Provenance is the whole basis for trusting a hand-written building, so
  // an entry that can't be re-checked doesn't get in. The POI overlay leaves
  // this to a test; a building is load-bearing enough to refuse outright.
  if (!(entry.sources?.length >= 2)) {
    problems.push(`${id} (${entry.name}): fewer than two sources`);
    continue;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.checkedOn ?? "")) {
    problems.push(`${id} (${entry.name}): no check date`);
    continue;
  }
  if (!(entry.connectsTo?.length > 0)) {
    // Searchable but unroutable is the failure this file exists to avoid: a
    // ramp you can find and then cannot walk out of reads as a broken app,
    // not as missing data.
    problems.push(`${id} (${entry.name}): no connectsTo — a ramp with no skyway link is unreachable`);
    continue;
  }
  if (typeof entry.lat !== "number" || typeof entry.lon !== "number") {
    // Without a position the record can be searched and never reached, which
    // is a worse answer than the ramp being missing: it looks like a fix.
    problems.push(`${id} (${entry.name}): no lat/lon`);
    continue;
  }
  // Already applied. Answered before the retirable check below, which skips
  // the entry's own record and would otherwise call it a duplicate of itself.
  // Links are still re-checked: an entry that gained a connectsTo would
  // otherwise have it dropped in silence, under a success message, every
  // time the overlay was re-applied to a dataset that already had the
  // building -- which is the ordinary curation loop.
  if (data.buildings.some((b) => b.id === id)) {
    applyLinks(id, entry);
    applied++;
    continue;
  }
  const mine = nameKey(entry.name);
  const already = data.buildings.find(
    (b) =>
      b.id !== id &&
      // Only OSM's records can be the thing that "caught up". The loop
      // appends to data.buildings as it goes, so without this a second
      // curated ramp within SAME_RAMP_METERS of the first is dropped and
      // reported as redundant -- advice to delete real data. The margin is
      // thin on purpose: 11th Street Underground stands 68m from Leamington.
      !curatedIds.has(b.id) &&
      b.category === "parking" &&
      // Same ramp means same place. Either it is close enough that nothing
      // else could be there, or the names agree *and* it is on the same few
      // blocks -- a name prefix on its own would let a genuine "Marquette
      // Parking Ramp North" be swallowed by "Marquette Parking Ramp" and
      // refused, which is the very failure this file exists to undo.
      (metresBetween(b, entry) <= SAME_RAMP_METERS ||
        ((nameKey(b.name).startsWith(mine) || mine.startsWith(nameKey(b.name))) &&
          metresBetween(b, entry) <= SAME_NAME_MAX_METERS)),
  );
  if (already) {
    retirable.push(`${id} (${entry.name}): OSM now carries this as ${already.id} (${already.name}) — overlay entry is redundant`);
    continue;
  }
  data.buildings.push({
    id,
    name: entry.name,
    address: entry.address,
    category: entry.category,
    lat: entry.lat,
    lon: entry.lon,
    // Empty is the honest answer for a ramp nobody has traced; the router
    // measures to the centroid instead. See the overlay's README.
    footprint: entry.footprint ?? [],
    // Hours belong to the hours overlay, which runs after this one. A ramp
    // arriving with null says "nobody has told us", which is true here and
    // is the state the app is built to render.
    hours: null,
    // Both sources for the first entry say "open 24 hours", and that is about
    // parking a car, not about the skyway door being unlocked. Hours the
    // router acts on are not the place to launder a claim about something
    // else -- the city-ordinance DEFAULT_HOURS was deleted for exactly that.
    hoursNote: "No published hours found.",
  });
  // A curated ramp has no edge, so without its access building a route could
  // never reach it. It therefore has to say what it connects to -- which is a
  // claim about the world, so it is sourced like every other claim here
  // rather than inferred from proximity.
  applyLinks(id, entry);
  applied++;
}

for (const p of problems) console.error(`PROBLEM ${p}`);
if (retirable.length) {
  console.log(`${retirable.length} overlay ${retirable.length === 1 ? "entry" : "entries"} OSM has caught up with:`);
  for (const r of retirable) console.log(`  - ${r}`);
}
const total = Object.keys(overlay.added).filter((k) => !k.startsWith("_")).length;
console.log(`Curated ramps applied: ${applied} of ${total}.`);
console.log(`Ramps renamed: ${renamed}.`);

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
