import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SkywayRouter, haversineMeters, polylineMeters, sliceAlong } from "../src/router.ts";
import { closingSoonWarnings, isOpenAt, nextOccurrence, statusAt } from "../src/hours.ts";
import { encodeRouteState, googleMapsUrl, parseRouteState } from "../src/share.ts";

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

test("route steps carry cumulative arrival minutes", () => {
  const r = router.route("ids-center", "us-bank-stadium", TUE_10AM);
  assert.equal(r.steps[0].arrivalMinutes, 0);
  const arrivals = r.steps.map((s) => s.arrivalMinutes);
  for (let i = 1; i < arrivals.length; i++) {
    assert.ok(arrivals[i] > arrivals[i - 1], "arrival times increase along the route");
  }
  assert.ok(
    Math.abs(arrivals[arrivals.length - 1] - r.totalMinutes) < 0.01,
    "last arrival matches total",
  );
});

test("closingSoonWarnings flags buildings closing near arrival", () => {
  // Mon–Fri 6:30am–10pm everywhere in the fixture: at 9:45pm Tuesday,
  // everything on the route closes within 30 minutes.
  const TUE_945PM = new Date(2026, 6, 14, 21, 45);
  const r = router.route("ids-center", "us-bank-stadium", TUE_945PM);
  const warnings = closingSoonWarnings(r, TUE_945PM, 30);
  assert.ok(warnings.length > 0, "late-night route should warn");
  for (const w of warnings) {
    assert.ok(w.minutesLeft > 0 && w.minutesLeft <= 30);
    assert.match(w.label, /closes/i);
  }
  // Mid-morning: nothing is anywhere near closing.
  assert.equal(closingSoonWarnings(router.route("ids-center", "us-bank-stadium", TUE_10AM), TUE_10AM, 30).length, 0);
});

test("nextOccurrence finds the coming weekday at a minute-of-day", () => {
  const ref = new Date(2026, 6, 14, 10, 0); // Tuesday 10:00
  const laterToday = nextOccurrence(2, 21 * 60, ref); // Tue 9pm
  assert.equal(laterToday.getDay(), 2);
  assert.equal(laterToday.getHours(), 21);
  assert.equal(laterToday.getDate(), 14, "later the same day stays today");

  const earlierSlot = nextOccurrence(2, 9 * 60, ref); // Tue 9am — already past
  assert.equal(earlierSlot.getDate(), 21, "a past slot rolls to next week");

  const sunday = nextOccurrence(0, 12 * 60, ref);
  assert.equal(sunday.getDay(), 0);
  assert.equal(sunday.getDate(), 19, "next Sunday");
});

test("reachable() maps buildings to walking minutes within a budget", () => {
  const reach = router.reachable("ids-center", TUE_10AM, 10);
  assert.equal(reach.get("ids-center"), 0);
  assert.ok(reach.has("gaviidae-common"), "adjacent building is inside 10 min");
  assert.ok(reach.get("gaviidae-common") > 0 && reach.get("gaviidae-common") < 5);
  for (const minutes of reach.values()) assert.ok(minutes <= 10);

  const tiny = router.reachable("ids-center", TUE_10AM, 3);
  assert.ok(!tiny.has("us-bank-stadium"), "stadium is beyond 3 minutes");
  assert.ok(tiny.size < reach.size, "smaller budget reaches fewer buildings");

  // Hours-blind with a huge budget covers the whole (connected) fixture.
  const all = router.reachable("ids-center", null, 10_000);
  assert.equal(all.size, data.buildings.length);

  // Sunday 5am: nothing beyond the origin is open.
  const SUN_5AM = new Date(2026, 6, 12, 5, 0);
  assert.equal(router.reachable("ids-center", SUN_5AM, 60).size, 1);
});

test("route state round-trips through the URL", () => {
  const when = new Date(2026, 6, 14, 10, 0);
  const qs = encodeRouteState({ fromId: "ids-center", toId: "hilton", when });
  const parsed = parseRouteState(qs);
  assert.equal(parsed.fromId, "ids-center");
  assert.equal(parsed.toId, "hilton");
  assert.equal(parsed.when.getTime(), when.getTime());

  const nowMode = parseRouteState(encodeRouteState({ fromId: "a", toId: "b", when: null }));
  assert.equal(nowMode.when, null);
  assert.deepEqual(parseRouteState(""), { fromId: null, toId: null, when: null });
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
    if (b.image) {
      assert.ok(b.image.url && b.image.attribution && b.image.sourceUrl, `${b.id} has an incomplete image record`);
      assert.match(b.image.attribution, /·/, `${b.id} image is missing a license in its attribution`);
    }
  }
});

test("googleMapsUrl builds a search deep link", () => {
  const url = googleMapsUrl({ name: "Cardigan Donuts", lat: 44.9762, lon: -93.2714 });
  assert.ok(url.startsWith("https://www.google.com/maps/search/?api=1&query="));
  assert.match(url, /Cardigan\+Donuts/);
  assert.match(url, /Minneapolis/);
});

test("combo entries include businesses, searchable by name", async () => {
  const { buildComboEntries, searchEntries } = await import("../src/combo.ts");
  const buildings = [
    { id: "forum", name: "Forum Building", address: "100 Main St" },
    { id: "six-quebec", name: "Six Quebec", address: "200 Main St" },
  ];
  const pois = [
    {
      id: "poi-1",
      name: "Vitality Roasting",
      buildingId: "six-quebec",
      group: "food",
      category: "cafe",
    },
    { id: "poi-2", name: "Downtown Bus Stop", buildingId: "forum", group: "transit", exterior: true },
  ];
  const entries = buildComboEntries(buildings, pois);

  const hit = searchEntries(entries, "vitality");
  assert.equal(hit.length, 1);
  assert.equal(hit[0].label, "Vitality Roasting");
  assert.equal(hit[0].buildingId, "six-quebec", "selecting the business routes to its building");
  assert.equal(hit[0].sublabel, "Six Quebec");

  assert.equal(searchEntries(entries, "forum").length, 1, "still finds plain buildings");
  assert.equal(
    searchEntries(entries, "bus stop").length,
    0,
    "exterior transit stops aren't route destinations",
  );
});

test("poi grouping and building categories", async () => {
  const { groupFor, buildingCategory } = await import("../src/poi.ts");
  assert.equal(groupFor("amenity", "cafe"), "food");
  assert.equal(groupFor("shop", "clothes"), "shop");
  assert.equal(groupFor("amenity", "bank"), "service");
  assert.equal(groupFor("amenity", "toilets"), "restroom");
  assert.equal(groupFor("tourism", "museum"), "landmark");
  assert.equal(groupFor("transit", "bus_stop"), "transit");
  assert.equal(buildingCategory({ building: "parking" }), "parking");
  assert.equal(buildingCategory({ building: "yes", amenity: "parking" }), "parking");
  assert.equal(buildingCategory({ building: "hotel" }), "hotel");
  assert.equal(buildingCategory({ building: "yes" }), "office");
});

test("live POIs reference real buildings", () => {
  assert.ok(live.pois.length > 50, `expected a real business set, got ${live.pois.length}`);
  const ids = new Set(live.buildings.map((b) => b.id));
  for (const p of live.pois) {
    assert.ok(ids.has(p.buildingId), `POI ${p.name} points at missing building ${p.buildingId}`);
    assert.ok(p.name && p.category);
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
