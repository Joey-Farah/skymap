import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeSupporters, checkSupporters, glowingSupporters } from "../src/supporters.ts";

// SkyMap Supporters (docs/business-listings-plan.md): a business pays for a
// fixed term, and its pin glows from the first day of the term to the last.
// The list ships in the app, so a term has to end on the phone's own date,
// with no release. Dates are the phone's local day, the same clock the
// opening hours use.

const entry = (over = {}) => ({
  id: "poi-1", name: "Somewhere", from: "2026-11-01", until: "2027-01-31", ...over,
});

test("a term is active from its first day to its last, inclusive", () => {
  const list = [entry()];
  assert.deepEqual(activeSupporters(list, new Date(2026, 9, 31, 23, 59)), [], "the evening before");
  assert.equal(activeSupporters(list, new Date(2026, 10, 1, 0, 1)).length, 1, "just after midnight on day one");
  assert.equal(activeSupporters(list, new Date(2027, 0, 31, 23, 59)).length, 1, "late on the last day");
  assert.deepEqual(activeSupporters(list, new Date(2027, 1, 1, 0, 1)), [], "the morning after");
});

test("only the entries whose term covers today come back", () => {
  const list = [
    entry({ id: "past", from: "2026-01-01", until: "2026-03-31" }),
    entry({ id: "now", from: "2026-10-01", until: "2026-12-31" }),
    entry({ id: "later", from: "2027-01-01", until: "2027-03-31" }),
  ];
  assert.deepEqual(activeSupporters(list, new Date(2026, 9, 14, 12)).map((s) => s.id), ["now"]);
});

test("an empty list has nobody to highlight", () => {
  assert.deepEqual(activeSupporters([], new Date(2026, 9, 14, 12)), []);
});

// The build fails on any of these (scripts/check-supporters.mjs), because
// Xcode Cloud builds every release with `npm run build`: a bad list must
// never reach the App Store.
const pois = [
  { id: "c1", name: "Cafe One", group: "coffee", buildingId: "b1" },
  { id: "c2", name: "Cafe Two", group: "coffee", buildingId: "b2" },
  { id: "c3", name: "Cafe Three", group: "coffee", buildingId: "b3" },
  { id: "c4", name: "Cafe Four", group: "coffee", buildingId: "b4" },
  { id: "c5", name: "Cafe Five", group: "coffee", buildingId: "b1" },
  { id: "f1", name: "Lunch Spot", group: "food", buildingId: "b1" },
  { id: "h1", name: "A Hotel", group: "hotel", buildingId: "b9" },
];
const term = (id, name, from = "2026-11-01", until = "2027-01-31") => ({ id, name, from, until });
const problems = (list) => checkSupporters(list, pois);

test("a sound list has no problems, and neither does an empty one", () => {
  assert.deepEqual(problems([]), []);
  assert.deepEqual(problems([term("c1", "Cafe One"), term("c2", "Cafe Two"), term("f1", "Lunch Spot")]), []);
});

test("an id that isn't on the map is refused", () => {
  assert.match(problems([term("gone", "Somewhere")]).join("\n"), /gone.*not on the map/);
});

test("only Coffee and Food places can be supporters", () => {
  assert.match(problems([term("h1", "A Hotel")]).join("\n"), /h1.*hotel/);
});

test("a name that no longer matches is refused, since the id may now be someone else", () => {
  // `npm run data:refresh` can hand an OSM id to a different place.
  assert.match(problems([term("c1", "Old Name Coffee")]).join("\n"), /c1.*Old Name Coffee.*Cafe One/);
});

test("dates must be real days, in order", () => {
  assert.match(problems([term("c1", "Cafe One", "2026-11-1", "2027-01-31")]).join("\n"), /c1.*from/);
  assert.match(problems([term("c1", "Cafe One", "2026-11-01", "2027-02-30")]).join("\n"), /c1.*until/);
  assert.match(problems([term("c1", "Cafe One", "2027-01-31", "2026-11-01")]).join("\n"), /c1.*ends before it starts/);
});

test("Coffee holds at most 3 at once, counting terms that overlap", () => {
  const four = [term("c1", "Cafe One"), term("c2", "Cafe Two"), term("c3", "Cafe Three"),
    term("c4", "Cafe Four", "2027-01-15", "2027-04-14")];
  assert.match(problems(four).join("\n"), /coffee.*4.*2027-01-15.*limit is 3/i);
  // The fourth starts the day after the others end: never more than 3 at once.
  four[3] = term("c4", "Cafe Four", "2027-02-01", "2027-04-30");
  assert.deepEqual(problems(four), []);
});

test("one supporter per building in each category, at any one time", () => {
  assert.match(problems([term("c1", "Cafe One"), term("c5", "Cafe Five", "2027-01-01", "2027-03-31")]).join("\n"),
    /b1.*coffee/);
  // A coffee shop and a lunch spot in the same building don't compete.
  assert.deepEqual(problems([term("c1", "Cafe One"), term("f1", "Lunch Spot")]), []);
  // Back to back is fine: one ends, the next begins.
  assert.deepEqual(problems([term("c1", "Cafe One"), term("c5", "Cafe Five", "2027-02-01", "2027-04-30")]), []);
});

test("the list that ships passes against the shipped map data", () => {
  const data = JSON.parse(readFileSync("public/data/skymap-data.json", "utf8"));
  const list = JSON.parse(readFileSync("data/supporters.json", "utf8")).supporters;
  assert.deepEqual(checkSupporters(list, data.pois), []);
});

test("the build stops on a bad list, and says why", () => {
  const dir = mkdtempSync(join(tmpdir(), "supporters-"));
  const bad = join(dir, "supporters.json");
  writeFileSync(bad, JSON.stringify({ supporters: [{ id: "poi-nope", name: "Nowhere", from: "2026-11-01", until: "2027-01-31" }] }));
  let failed = null;
  try {
    execFileSync("node", ["scripts/check-supporters.mjs", bad], { encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    failed = e;
  }
  assert.ok(failed, "the check passed a list naming a place that isn't on the map");
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /poi-nope.*not on the map/);
});

// A glow says "go here", so it's off while the place is known to be closed
// (Joey, 2026-10-14). Known means the place's own published hours; with no
// hours we don't know, and the glow stays on.
test("the glow is off while the place is closed, and on while it's open", () => {
  const places = [{ id: "c1", name: "Cafe One", group: "coffee", buildingId: "b1", openingHours: "Mo-Fr 07:00-16:00" }];
  const list = [term("c1", "Cafe One", "2026-01-01", "2026-12-31")];
  const ids = (when) => glowingSupporters(list, places, when).map((s) => s.id);
  assert.deepEqual(ids(new Date(2026, 9, 14, 12, 0)), ["c1"], "Wednesday noon, open");
  assert.deepEqual(ids(new Date(2026, 9, 14, 2, 0)), [], "Wednesday 2am, closed");
  assert.deepEqual(ids(new Date(2026, 9, 17, 12, 0)), [], "Saturday, closed all day");
});

test("with no hours, or hours we can't read, the glow stays on", () => {
  const list = [term("c1", "Cafe One", "2026-01-01", "2026-12-31")];
  const at2am = new Date(2026, 9, 14, 2, 0);
  const none = [{ id: "c1", name: "Cafe One", group: "coffee", buildingId: "b1" }];
  const garbled = [{ ...none[0], openingHours: "ask at the counter" }];
  assert.deepEqual(glowingSupporters(list, none, at2am).map((s) => s.id), ["c1"]);
  assert.deepEqual(glowingSupporters(list, garbled, at2am).map((s) => s.id), ["c1"]);
});

test("a term that hasn't started, or has ended, doesn't glow even while open", () => {
  const places = [{ id: "c1", name: "Cafe One", group: "coffee", buildingId: "b1", openingHours: "Mo-Su 00:00-24:00" }];
  const list = [term("c1", "Cafe One", "2027-01-01", "2027-03-31")];
  assert.deepEqual(glowingSupporters(list, places, new Date(2026, 9, 14, 12)), []);
});

test("only the map drawing and the card read the supporter list", () => {
  // Search, routing, walk times and the "past X" cues must never know who
  // has paid. Any new reader of supporters.ts has to be added here on
  // purpose, with a reason.
  const readers = readdirSync("src")
    .filter((f) => f.endsWith(".ts") && f !== "supporters.ts")
    .filter((f) => /from "\.\/supporters\.ts"/.test(readFileSync(`src/${f}`, "utf8")))
    .sort();
  assert.deepEqual(readers, ["main.ts", "map.ts", "ui.ts"]);
});
