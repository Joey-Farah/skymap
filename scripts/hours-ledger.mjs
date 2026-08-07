/**
 * The work list for the hours curation pass, and its progress.
 *
 * State lives on disk, not in anyone's head or context window: an
 * unattended run gets interrupted, restarted and resumed, and each pass
 * has to be able to answer "what's left?" from the files alone.
 *
 * Statuses:
 *   pending   — not looked at yet
 *   done      — hours recorded in data/hours-overlay.json
 *   none      — researched, no hours published anywhere findable
 *   ambiguous — sources disagree; deliberately NOT guessed
 *   blocked   — can't research (dead site, unidentifiable location)
 *
 * `none` and `ambiguous` are successful outcomes. The point of the pass is
 * an accurate dataset, and "we looked and there is nothing" is accurate.
 * Guessing to make a percentage look better is the one forbidden move.
 *
 *   node scripts/hours-ledger.mjs init     # build from the dataset
 *   node scripts/hours-ledger.mjs status   # progress summary
 *   node scripts/hours-ledger.mjs next 12  # next N pending items
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const DATA = "public/data/skymap-data.json";
const OVERLAY = "data/hours-overlay.json";
const LEDGER = "data/hours-ledger.json";
const BROWSABLE = ["food", "coffee", "hotel", "other"];

const cmd = process.argv[2] ?? "status";
const data = JSON.parse(readFileSync(DATA, "utf8"));

function load() {
  return existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { items: {} };
}
function save(l) {
  writeFileSync(LEDGER, JSON.stringify(l, null, 1) + "\n");
}

if (cmd === "init") {
  const ledger = load();
  let added = 0;
  for (const p of data.pois) {
    if (!BROWSABLE.includes(p.group) || p.openingHours) continue;
    if (ledger.items[p.id]) continue;
    ledger.items[p.id] = {
      kind: "poi",
      name: p.name,
      group: p.group,
      website: p.website ?? null,
      status: "pending",
    };
    added++;
  }
  // Buildings still on the city-ordinance default. These have no website
  // field at all, so each needs a search before it can be read.
  for (const b of data.buildings) {
    if (!(b.hoursNote ?? "").startsWith("Default")) continue;
    if (ledger.items[b.id]) continue;
    ledger.items[b.id] = {
      kind: "building",
      name: b.name,
      category: b.category,
      address: b.address ?? null,
      website: null,
      status: "pending",
    };
    added++;
  }
  save(ledger);
  console.log(`ledger: +${added} new, ${Object.keys(ledger.items).length} total`);
}

if (cmd === "status") {
  const ledger = load();
  const items = Object.values(ledger.items);
  const by = (k, v) => items.filter((i) => i.kind === k && i.status === v).length;
  const statuses = ["pending", "done", "none", "ambiguous", "blocked"];
  console.log(`${"".padEnd(10)} ${statuses.map((s) => s.padStart(10)).join("")}`);
  for (const k of ["poi", "building"]) {
    console.log(`${k.padEnd(10)} ${statuses.map((s) => String(by(k, s)).padStart(10)).join("")}`);
  }
  const pending = items.filter((i) => i.status === "pending").length;
  const researched = items.length - pending;
  console.log(`\nresearched ${researched}/${items.length} (${Math.round((100 * researched) / items.length)}%)`);

  const eat = data.pois.filter((p) => ["food", "coffee"].includes(p.group));
  const have = eat.filter((p) => p.openingHours).length;
  console.log(`food+coffee coverage: ${have}/${eat.length} (${Math.round((100 * have) / eat.length)}%)`);
  const overlay = existsSync(OVERLAY) ? JSON.parse(readFileSync(OVERLAY, "utf8")) : { hours: {}, skipped: {} };
  console.log(`overlay entries: ${Object.keys(overlay.hours).length} applied, ${Object.keys(overlay.skipped).length} skipped`);
}

if (cmd === "next") {
  const n = Number(process.argv[3] ?? 10);
  const ledger = load();
  const pending = Object.entries(ledger.items).filter(([, i]) => i.status === "pending");
  // Websites first — cheapest to research and highest hit rate. POIs before
  // buildings, since a POI card is where hours are actually read.
  pending.sort(([, a], [, b]) => {
    const score = (i) => (i.website ? 0 : 2) + (i.kind === "building" ? 1 : 0);
    return score(a) - score(b);
  });
  for (const [id, i] of pending.slice(0, n)) {
    console.log(JSON.stringify({ id, ...i }));
  }
  if (!pending.length) console.log("(ledger complete)");
}
