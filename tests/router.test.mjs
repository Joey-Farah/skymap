import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SkywayRouter, haversineMeters } from "../src/router.ts";
import { isOpenAt, statusAt } from "../src/hours.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "public/data/skymap-data.json"), "utf8"));
const router = new SkywayRouter(data);

const TUE_10AM = new Date(2026, 6, 14, 10, 0); // Tuesday
const SUN_11AM = new Date(2026, 6, 12, 11, 0); // Sunday
const TUE_3AM = new Date(2026, 6, 14, 3, 0);

test("dataset is internally consistent", () => {
  const ids = new Set(data.buildings.map((b) => b.id));
  assert.equal(ids.size, data.buildings.length, "duplicate building ids");
  for (const e of data.edges) {
    assert.ok(ids.has(e.from) && ids.has(e.to), `dangling edge ${e.from}->${e.to}`);
    assert.notEqual(e.from, e.to, "self-loop edge");
  }
  for (const b of data.buildings) {
    assert.equal(b.hours.length, 7, `${b.id} must have 7 days of hours`);
  }
});

test("every building is reachable from IDS Center (hours-blind)", () => {
  for (const b of data.buildings) {
    if (b.id === "ids-center") continue;
    const r = router.route("ids-center", b.id, null);
    assert.ok(r, `no route ids-center -> ${b.id}`);
  }
});

test("weekday route IDS -> US Bank Stadium is open and sensible", () => {
  const r = router.route("ids-center", "us-bank-stadium", TUE_10AM);
  assert.ok(r);
  assert.equal(r.ignoredClosures, false);
  assert.ok(r.steps.length >= 4, "stadium should be several buildings away");
  assert.ok(r.totalMeters > 800 && r.totalMeters < 4000, `implausible distance ${r.totalMeters}`);
  assert.ok(r.totalMinutes > 5 && r.totalMinutes < 60, `implausible time ${r.totalMinutes}`);
});

test("routes avoid closed buildings when possible, flag when not", () => {
  // Sunday morning: offices closed. IDS (hub) and Hilton (hotel) are open,
  // but every path between them passes through closed office towers.
  const r = router.route("ids-center", "hilton", SUN_11AM);
  assert.ok(r);
  for (const step of r.steps.slice(1, -1)) {
    if (!r.ignoredClosures) {
      assert.ok(isOpenAt(step.building, SUN_11AM), `${step.building.id} closed on route`);
    }
  }
  // At 3am nothing is open except parking ramps: must fall back and flag it.
  const late = router.route("ids-center", "hilton", TUE_3AM);
  assert.ok(late);
  assert.equal(late.ignoredClosures, true);
});

test("shortest path is actually short (triangle sanity)", () => {
  const r = router.route("ids-center", "gaviidae-common", TUE_10AM);
  assert.ok(r);
  assert.equal(r.steps.length, 2, "adjacent buildings should be one hop");
});

test("hours: status labels", () => {
  const ids = data.buildings.find((b) => b.id === "ids-center");
  assert.equal(statusAt(ids, TUE_10AM).open, true);
  const office = data.buildings.find((b) => b.id === "capella-tower");
  assert.equal(statusAt(office, SUN_11AM).open, false);
  assert.match(statusAt(office, SUN_11AM).label, /opens/i);
});

test("haversine sanity: one downtown block ~100-200m", () => {
  const d = haversineMeters(44.9763, -93.2715, 44.9752, -93.2724);
  assert.ok(d > 80 && d < 250, `block distance ${d}`);
});
