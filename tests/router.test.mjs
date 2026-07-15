import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SkywayRouter, haversineMeters, polylineMeters, sliceAlong } from "../src/router.ts";
import { isOpenAt, statusAt } from "../src/hours.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Router behavior is tested against the committed seed fixture: stable ids,
// curated hours. The live dataset (public/data) may be an OSM extraction
// with different ids — it gets its own consistency tests below.
const data = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/seed-data.json"), "utf8"));
const router = new SkywayRouter(data);

const TUE_10AM = new Date(2026, 6, 14, 10, 0); // Tuesday
const SUN_11AM = new Date(2026, 6, 12, 11, 0); // Sunday
const TUE_3AM = new Date(2026, 6, 14, 3, 0);

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

test("route steps carry leg geometry oriented in travel direction", () => {
  const mini = {
    meta: data.meta,
    buildings: [
      { ...data.buildings[0], id: "a", lat: 44.97, lon: -93.27 },
      { ...data.buildings[0], id: "b", lat: 44.971, lon: -93.269 },
    ],
    edges: [
      {
        from: "a",
        to: "b",
        crossing: "Test St",
        geometry: [
          [-93.27, 44.97],
          [-93.2695, 44.9704],
          [-93.269, 44.971],
        ],
      },
    ],
  };
  const r = new SkywayRouter(mini);
  const fwd = r.route("a", "b", null);
  assert.deepEqual(fwd.steps[1].legGeometry, mini.edges[0].geometry);
  const back = r.route("b", "a", null);
  assert.deepEqual(back.steps[1].legGeometry, [...mini.edges[0].geometry].reverse());
});

test("sliceAlong cuts a polyline at a distance", () => {
  // ~222m of eastward line at the equator, two equal legs.
  const line = [
    [0, 0],
    [0.001, 0],
    [0.002, 0],
  ];
  const total = polylineMeters(line);

  const half = sliceAlong(line, total / 2);
  assert.equal(half.length, 2, "half-way cut falls exactly on the middle vertex");
  assert.ok(Math.abs(half[1][0] - 0.001) < 1e-9);

  const quarter = sliceAlong(line, total / 4);
  assert.ok(Math.abs(quarter[quarter.length - 1][0] - 0.0005) < 1e-6, "interpolates within a leg");

  assert.deepEqual(sliceAlong(line, 0)[0], [0, 0]);
  assert.deepEqual(sliceAlong(line, total * 2), line, "clamps past the end");
});

// --- Live dataset (whatever the app currently ships) ----------------------

const live = JSON.parse(readFileSync(join(ROOT, "public/data/skymap-data.json"), "utf8"));

test("live dataset is internally consistent", () => {
  const ids = new Set(live.buildings.map((b) => b.id));
  assert.equal(ids.size, live.buildings.length, "duplicate building ids");
  for (const e of live.edges) {
    assert.ok(ids.has(e.from) && ids.has(e.to), `dangling edge ${e.from}->${e.to}`);
    assert.notEqual(e.from, e.to, "self-loop edge");
  }
  for (const b of live.buildings) {
    assert.equal(b.hours.length, 7, `${b.id} must have 7 days of hours`);
  }
});

test("live dataset is one connected network (hours-blind)", () => {
  const liveRouter = new SkywayRouter(live);
  const origin = live.buildings[0];
  for (const b of live.buildings.slice(1)) {
    const r = liveRouter.route(origin.id, b.id, null);
    assert.ok(r, `no route ${origin.id} -> ${b.id}`);
  }
});
