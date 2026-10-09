import test from "node:test";
import assert from "node:assert/strict";

import { launch, openApp } from "./harness.mjs";

test("a landmark off the skyway is reached through its building, not drawn into (QA 030)", async (t) => {
  const { browser, page } = await launch({ geolocation: null, clockAt: "2026-10-07T12:00:00-05:00" });
  t.after(() => browser.close());
  await openApp(page);
  const r = await page.evaluate(async () => {
    const s = window.__skymap;
    const stadium = s.data.pois.find((p) => p.id === "landmark-us-bank-stadium-743461508");
    const ramp = s.router.building(stadium.buildingId);
    s.modes.showPlace(ramp, stadium);
    const card = document.getElementById("sheet").innerText;
    await new Promise((r) => setTimeout(r, 50));
    return { card, rampName: ramp.name, nearby: !!stadium.nearby };
  });
  assert.ok(r.nearby, "the stadium marker is flagged as outside its ramp");
  assert.match(r.card, new RegExp(`Skyway access via ${r.rampName}`));
  // The route ends at the ramp: no point of the drawn line far from its walls.
  await openApp(page, "/?from=ids-center-1385236413&to=stadium-parking-ramp-40774167");
  const far = await page.evaluate(() => {
    const s = window.__skymap;
    const stadium = s.data.pois.find((p) => p.id === "landmark-us-bank-stadium-743461508");
    s.modes.showPlace(s.router.building(stadium.buildingId), stadium);
    s.modes.enterPreview();
    const coords = s.view.activeRouteCoords;
    const end = coords[coords.length - 1];
    const R = 6371000, rad = (d) => (d * Math.PI) / 180;
    return Math.round(Math.hypot(rad(end[0] - stadium.lon) * Math.cos(rad(end[1])), rad(end[1] - stadium.lat)) * R);
  });
  assert.ok(far > 100, `the line runs ${far} m from the stadium's middle, i.e. it stops at the ramp`);
});
