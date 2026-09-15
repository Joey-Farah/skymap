import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { routeEnd } from "../src/route-end.ts";
import { SkywayRouter } from "../src/router.ts";

// A curated ramp has no traced skyway link, so nothing is drawn between it
// and the building its operator says you reach it through. Routing to the
// ramp ends at that building's door: the pin marks the ramp, and the line
// stops where the known skyway stops -- the same as a place outside the
// network, rather than a straight line through the block.
const data = JSON.parse(readFileSync("public/data/skymap-data.json", "utf8"));
const byId = new Map(data.buildings.map((b) => [b.id, b]));
const RAMP = byId.get("lasalle-at-10th-x");

test("a ramp routes through its access building, pinned on the ramp itself", () => {
  assert.deepEqual(routeEnd(RAMP, null), {
    buildingId: "target-plaza-iii-44684855",
    coord: [RAMP.lon, RAMP.lat],
    nearby: true,
  });
});

test("an ordinary building is its own end, with no override", () => {
  const b = byId.get("target-plaza-iii-44684855");
  assert.deepEqual(routeEnd(b, null), { buildingId: b.id, coord: undefined, nearby: false });
});

test("a place keeps its own spot and its nearby flag", () => {
  const poi = data.pois.find((p) => p.nearby);
  assert.deepEqual(routeEnd(byId.get(poi.buildingId), poi), {
    buildingId: poi.buildingId,
    coord: [poi.lon, poi.lat],
    nearby: true,
  });
});

test("every curated ramp can be routed to from the downtown core", () => {
  const router = new SkywayRouter(data);
  for (const ramp of data.buildings.filter((b) => b.skywayAccess)) {
    const route = router.route("ids-center-1385236413", routeEnd(ramp, null).buildingId, null);
    assert.ok(route, `no route to ${ramp.name}`);
  }
});
