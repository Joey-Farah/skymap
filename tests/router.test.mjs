import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SkywayRouter,
  haversineMeters,
  nearestBuilding,
  polylineMeters,
  routeStepIndex,
  sliceAlong,
} from "../src/router.ts";
import { closingSoonWarnings, isClosingSoon, isOpenAt, nextOccurrence, statusAt } from "../src/hours.ts";
import { encodeRouteState, feedbackUrl, parseRouteState, reportIssueUrl } from "../src/share.ts";

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

test("isClosingSoon flags open buildings nearing their close time", () => {
  const ids = data.buildings.find((b) => b.id === "ids-center");
  // IDS closes at 10pm weekdays: 9:45pm is closing soon, 10am is not,
  // and already-closed buildings aren't "closing soon" (they're closed).
  assert.equal(isClosingSoon(ids, new Date(2026, 6, 14, 21, 45), 20), true);
  assert.equal(isClosingSoon(ids, TUE_10AM, 20), false);
  assert.equal(isClosingSoon(ids, new Date(2026, 6, 14, 23, 0), 20), false);
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

test("nearestBuilding snaps a GPS fix to the closest building within range", () => {
  const ids = data.buildings.find((b) => b.id === "ids-center");
  const near = nearestBuilding(ids.lat + 0.00002, ids.lon, data.buildings, 60);
  assert.equal(near?.id, "ids-center");

  // Far from everything: no snap within a tight budget.
  assert.equal(nearestBuilding(0, 0, data.buildings, 60), null);
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

test("accessible routing avoids stairs edges even when they're the shortest path", () => {
  // a -[stairs, short]- b, a -[flat, long]- c -[flat]- b: accessible mode
  // must take the longer flat detour, not the direct stairs edge.
  const mini = {
    meta: data.meta,
    buildings: [
      { ...data.buildings[0], id: "a", lat: 44.977, lon: -93.271 },
      { ...data.buildings[0], id: "b", lat: 44.9772, lon: -93.271 }, // ~22m from a
      { ...data.buildings[0], id: "c", lat: 44.98, lon: -93.268 }, // far detour point
    ],
    edges: [
      { from: "a", to: "b", crossing: "stairs link", hasSteps: true },
      { from: "a", to: "c", crossing: "flat link 1" },
      { from: "c", to: "b", crossing: "flat link 2" },
    ],
  };
  const r = new SkywayRouter(mini);
  const direct = r.route("a", "b", null);
  assert.equal(direct.steps.length, 2, "hours-blind default takes the direct stairs edge");

  const accessible = r.route("a", "b", null, { accessible: true });
  assert.ok(accessible, "an accessible route must still be found via the detour");
  assert.equal(accessible.steps.length, 3, "accessible mode detours around the stairs");
  assert.ok(accessible.steps.every((s) => !s.hasSteps), "no step in an accessible route has stairs");
});

test("route steps surface stairs when the bridge crossing has them", () => {
  const mini = {
    meta: data.meta,
    buildings: [
      { ...data.buildings[0], id: "a" },
      { ...data.buildings[0], id: "b" },
    ],
    edges: [{ from: "a", to: "b", crossing: "skyway", hasSteps: true }],
  };
  const r = new SkywayRouter(mini);
  const route = r.route("a", "b", null);
  assert.equal(route.steps[1].hasSteps, true);

  const flat = new SkywayRouter({ ...mini, edges: [{ from: "a", to: "b", crossing: "skyway" }] });
  assert.equal(flat.route("a", "b", null).steps[1].hasSteps, undefined);
});

test("route steps surface openAir when a crossing isn't confirmed enclosed", () => {
  const mini = {
    meta: data.meta,
    buildings: [
      { ...data.buildings[0], id: "a" },
      { ...data.buildings[0], id: "b" },
    ],
    edges: [{ from: "a", to: "b", crossing: "skyway", openAir: true }],
  };
  const r = new SkywayRouter(mini);
  assert.equal(r.route("a", "b", null).steps[1].openAir, true);

  const enclosed = new SkywayRouter({ ...mini, edges: [{ from: "a", to: "b", crossing: "skyway" }] });
  assert.equal(enclosed.route("a", "b", null).steps[1].openAir, undefined);
});

test("routeStepIndex finds the nearest step to a live position", () => {
  const r = router.route("ids-center", "us-bank-stadium", TUE_10AM);
  // Right on top of the origin: step 0.
  assert.equal(routeStepIndex(r, r.steps[0].building.lat, r.steps[0].building.lon), 0);
  // Right on top of an interior step: that step's index.
  const midIdx = Math.floor(r.steps.length / 2);
  assert.equal(
    routeStepIndex(r, r.steps[midIdx].building.lat, r.steps[midIdx].building.lon),
    midIdx,
  );
  // Right on top of the destination: last step.
  assert.equal(routeStepIndex(r, r.steps.at(-1).building.lat, r.steps.at(-1).building.lon), r.steps.length - 1);
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

test("reachable() honors accessible and closedEdges like route() does", () => {
  // a -[stairs]- b: with accessible on, b is out of reach.
  const mini = {
    meta: data.meta,
    buildings: [
      { ...data.buildings[0], id: "a", lat: 44.977, lon: -93.271 },
      { ...data.buildings[0], id: "b", lat: 44.9772, lon: -93.271 },
    ],
    edges: [{ from: "a", to: "b", crossing: "stairs link", hasSteps: true }],
  };
  const r = new SkywayRouter(mini);
  assert.ok(r.reachable("a", null, 60).has("b"), "reachable by default");
  assert.ok(!r.reachable("a", null, 60, { accessible: true }).has("b"), "stairs excluded in accessible mode");
  assert.ok(
    !r.reachable("a", null, 60, { closedEdges: new Set(["a|b"]) }).has("b"),
    "reported-closed crossing excluded",
  );
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

test("headingFromOrientation prefers iOS compass heading, else derives from alpha", async () => {
  const { headingFromOrientation } = await import("../src/compass.ts");
  assert.equal(headingFromOrientation({ webkitCompassHeading: 90 }), 90);
  assert.equal(headingFromOrientation({ alpha: 90 }), 270, "alpha is flipped to approximate heading");
  assert.equal(headingFromOrientation({ alpha: 0 }), 0);
  assert.equal(headingFromOrientation({}), null);
  assert.equal(headingFromOrientation({ alpha: null }), null);
});

test("reported-closed crossings expire and are excluded from routing", async () => {
  const { reportClosedCrossing, activeClosedEdges, isCrossingReportedClosed } = await import(
    "../src/incidents.ts"
  );
  const mem = new Map();
  const store = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
    removeItem: (k) => mem.delete(k),
  };

  const now = 1_000_000;
  reportClosedCrossing(store, "a", "b", now);
  assert.equal(isCrossingReportedClosed(store, "a", "b", now), true);
  assert.equal(isCrossingReportedClosed(store, "b", "a", now), true, "direction-independent");
  assert.equal(activeClosedEdges(store, now).size, 1);

  // Past the 4h expiry: no longer active.
  const later = now + 5 * 60 * 60 * 1000;
  assert.equal(isCrossingReportedClosed(store, "a", "b", later), false);
});

test("route() excludes a reported-closed crossing even if it's the only path", () => {
  const mini = {
    meta: data.meta,
    buildings: [{ ...data.buildings[0], id: "a" }, { ...data.buildings[0], id: "b" }],
    edges: [{ from: "a", to: "b", crossing: "locked door" }],
  };
  const r = new SkywayRouter(mini);
  assert.ok(r.route("a", "b", null), "open by default");
  const closed = r.route("a", "b", null, { closedEdges: new Set(["a|b"]) });
  assert.equal(closed, null, "the only path is reported closed, so no route exists");
});

test("saved ramp round-trips through a key-value store", async () => {
  const { saveRamp, getSavedRamp, clearSavedRamp } = await import("../src/ramp.ts");
  const mem = new Map();
  const fakeStore = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
    removeItem: (k) => mem.delete(k),
  };

  assert.equal(getSavedRamp(fakeStore), null, "nothing saved yet");
  const saved = saveRamp(fakeStore, { id: "midtown-ramp-1", name: "Midtown Parking Ramp" });
  assert.equal(saved.id, "midtown-ramp-1");
  assert.ok(saved.savedAt);

  const loaded = getSavedRamp(fakeStore);
  assert.equal(loaded.id, "midtown-ramp-1");
  assert.equal(loaded.name, "Midtown Parking Ramp");

  clearSavedRamp(fakeStore);
  assert.equal(getSavedRamp(fakeStore), null);

  // Corrupt data doesn't throw, just reads as unsaved.
  mem.set("skymap.savedRamp", "{not json");
  assert.equal(getSavedRamp(fakeStore), null);
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
  assert.equal(hit[0].icon, "food", "business results carry their POI group for the result icon");

  const buildingHit = searchEntries(entries, "forum")[0];
  assert.equal(buildingHit.icon, "building", "plain buildings get a generic building icon");

  assert.equal(searchEntries(entries, "forum").length, 1, "still finds plain buildings");
  assert.equal(
    searchEntries(entries, "bus stop").length,
    0,
    "exterior transit stops aren't route destinations",
  );
});

test("landmarkNear picks a recognizable business for a building, deterministically", async () => {
  const { landmarkNear } = await import("../src/poi.ts");
  const pois = [
    { id: "1", name: "Zephyr Dry Cleaning", buildingId: "b1", group: "service" },
    { id: "2", name: "Caribou Coffee", buildingId: "b1", group: "food" },
    { id: "3", name: "Aardvark Bakery", buildingId: "b1", group: "food" },
    { id: "4", name: "Some Bank", buildingId: "b2", group: "service" },
  ];
  const landmark = landmarkNear(pois, "b1");
  assert.equal(landmark.name, "Aardvark Bakery", "alphabetically-first food POI, deterministic");
  assert.equal(landmarkNear(pois, "b2"), null, "no food/landmark POI in that building");
  assert.equal(landmarkNear(pois, "nowhere"), null);

  const withCoffee = [{ id: "5", name: "Zinnia Cafe", buildingId: "b3", group: "coffee" }];
  assert.equal(landmarkNear(withCoffee, "b3").name, "Zinnia Cafe", "coffee counts as a wayfinding landmark too");
});

test("poi grouping and building categories", async () => {
  const { groupFor, buildingCategory } = await import("../src/poi.ts");
  assert.equal(groupFor("amenity", "cafe"), "coffee");
  assert.equal(groupFor("amenity", "restaurant"), "food");
  assert.equal(groupFor("shop", "clothes"), "shop");
  assert.equal(groupFor("amenity", "bank"), "service");
  assert.equal(groupFor("amenity", "toilets"), "restroom");
  assert.equal(groupFor("elevator", "elevator"), "elevator");
  assert.equal(groupFor("tourism", "museum"), "landmark");
  assert.equal(groupFor("transit", "bus_stop"), "transit");
  assert.equal(buildingCategory({ building: "parking" }), "parking");
  assert.equal(buildingCategory({ building: "yes", amenity: "parking" }), "parking");
  assert.equal(buildingCategory({ building: "hotel" }), "hotel");
  assert.equal(buildingCategory({ building: "yes" }), "office");
});

test("reportIssueUrl builds a pre-filled mailto", () => {
  const url = reportIssueUrl({ name: "Vitality Roasting", id: "poi-123" });
  assert.ok(url.startsWith("mailto:"));
  assert.match(url, /subject=SkyMap%20issue%3A%20Vitality%20Roasting/);
  assert.match(url, /body=.*poi-123/);
});

test("feedbackUrl builds a general (not per-target) mailto", () => {
  const url = feedbackUrl();
  assert.ok(url.startsWith("mailto:"));
  assert.match(url, /subject=SkyMap%20feedback/);
  assert.doesNotMatch(url, /Ref%3A/, "feedback isn't tied to a building/POI id");
});

test("live POIs reference real buildings", () => {
  assert.ok(live.pois.length > 50, `expected a real business set, got ${live.pois.length}`);
  const ids = new Set(live.buildings.map((b) => b.id));
  for (const p of live.pois) {
    assert.ok(ids.has(p.buildingId), `POI ${p.name} points at missing building ${p.buildingId}`);
    assert.ok(p.name && p.category);
  }
});

test("live dataset's core network is fully connected; smaller real spurs may stand alone", () => {
  // Extraction now keeps every component with >=3 buildings, not just the
  // single largest — real skyway spurs (e.g. Target Center's cluster) that
  // OSM hasn't mapped a connecting bridge for yet are still findable and
  // routable *within themselves*, even though a route *between* two
  // separate clusters correctly returns no-route (the bridge genuinely
  // isn't in the data). So: assert the big downtown core is one connected
  // network, and that nothing is a true isolated singleton.
  const liveRouter = new SkywayRouter(live);
  const reachableCounts = live.buildings.map(
    (b) => [...liveRouter.reachable(b.id, null, Infinity).keys()].length,
  );
  const coreSize = Math.max(...reachableCounts);
  assert.ok(coreSize >= 100, `core downtown network only covers ${coreSize} buildings — expected the dominant cluster to stay large`);
  assert.ok(reachableCounts.every((n) => n >= 2), "every building must be reachable from at least one other");
});
