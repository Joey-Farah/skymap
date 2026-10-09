import test from "node:test";
import assert from "node:assert/strict";

import { launch, openApp, startTrip, walkRoute, activeLine } from "./harness.mjs";

test("after a long GPS gap, the banner goes straight to where you are (QA 032)", async (t) => {
  // Screen locked in a pocket: fixes stop for minutes, and the first one
  // back is at the destination's door.
  const { browser, page } = await launch();
  t.after(() => browser.close());
  assert.ok(await startTrip(page, "517-marquette-garage-156912894", "state-theatre-156912879"));
  const line = await activeLine(page);
  await walkRoute(page, { toMeters: 60 });
  await page.evaluate(() => (window.__testNow += 7 * 60_000));
  const after = await walkRoute(page, { fromMeters: line.total - 1, toMeters: line.total, standStillS: 3 });
  const banners = after.map((s) => s.banner);
  assert.match(banners[0], /arrived/i, `replayed: ${[...new Set(banners)].join(" → ")}`);
});

test("GO in the middle of the route drawing doesn't wipe the walker (QA 005)", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual" });
  t.after(() => browser.close());
  await openApp(page, "/?from=517-marquette-garage-156912894&to=state-theatre-156912879");
  // GO straight away, while the preview is still drawing the line.
  const drawing = await page.evaluate(() => {
    const s = window.__skymap;
    const was = s.view.routeAnim !== 0;
    s.modes.enterNav();
    return was;
  });
  assert.ok(drawing, "setup: the route was still being drawn");
  const line = await activeLine(page);
  await page.evaluate(([lon, lat]) => window.__testGeo.fix(lat, lon, 10), line.coords[1]);
  await page.waitForTimeout(3500); // past where the drawing would have ended
  const walker = await page.evaluate(() => {
    const m = window.__skymap.view.map;
    const f = m.getSource("skyway-walker")?.serialize().data?.features ?? [];
    return { dots: f.length, drawing: f[0]?.properties?.drawing ?? null, snapped: m.getContainer().classList.contains("walker-snapped") };
  });
  assert.deepEqual(walker, { dots: 1, drawing: false, snapped: true });
});

const SHERATON = "sheraton-minneapolis-downtown-convention-center-1394814185";
const RAND_TOWER = "rand-tower-hotel-minneapolis-a-tribute-portfolio-hotel-29080581";

test("the route overview stays put when the next GPS fix arrives (QA 021)", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual" });
  t.after(() => browser.close());
  await openApp(page);
  await page.evaluate(() => window.__testGeo.fix(44.97687, -93.27006));
  await page.waitForFunction(() => window.__skymap.view.geolocate._watchState === "ACTIVE_LOCK");
  const id = SHERATON;
  await page.evaluate((id) => {
    const s = window.__skymap;
    s.modes.showPlace(s.router.building(id));
    s.modes.enterPreview();
  }, id);
  await page.waitForTimeout(2500); // the overview settles
  const camera = () => page.evaluate(() => {
    const m = window.__skymap.view.map;
    return { lng: m.getCenter().lng.toFixed(5), lat: m.getCenter().lat.toFixed(5), zoom: m.getZoom().toFixed(2) };
  });
  const framed = await camera();
  await page.evaluate(() => window.__testGeo.fix(44.97688, -93.27007));
  await page.waitForTimeout(1500);
  assert.deepEqual(await camera(), framed, "the fix flew the camera back to you");
  // GO hands the camera back to following you.
  await page.evaluate(() => window.__skymap.modes.enterNav());
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__skymap.view.geolocate._watchState), "ACTIVE_LOCK");
});

test("mid-trip, the camera keeps your dot in the map you can see (QA 044)", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual" });
  t.after(() => browser.close());
  // A long step list: nav opens with the sheet expanded over half the map.
  await openApp(page, `/?from=${RAND_TOWER}&to=${SHERATON}`);
  await page.evaluate(() => window.__skymap.modes.enterNav());
  const line = await activeLine(page);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(([lon, lat]) => window.__testGeo.fix(lat, lon, 10), line.coords[2]);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500); // the follow animation settles
  const r = await page.evaluate(() => {
    const v = window.__skymap.view;
    const dot = v.map.project(v.walkerAt);
    const top = document.getElementById("nav-banner").getBoundingClientRect().bottom;
    const bottom = document.getElementById("sheet").getBoundingClientRect().top;
    return { y: Math.round(dot.y), top: Math.round(top), bottom: Math.round(bottom) };
  });
  assert.ok(r.y > r.top && r.y < r.bottom, `dot at y=${r.y}, clear map is ${r.top}..${r.bottom}`);
});

test("on a small phone the whole route preview clears the From/To panel (QA 022)", async (t) => {
  const { browser, page } = await launch({ viewport: { width: 375, height: 667 } });
  t.after(() => browser.close());
  await openApp(page);
  const id = SHERATON;
  await page.evaluate((id) => {
    const s = window.__skymap;
    s.modes.showPlace(s.router.building(id));
    s.modes.enterPreview();
  }, id);
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    const v = window.__skymap.view;
    const editor = document.getElementById("route-editor").getBoundingClientRect().bottom;
    const ys = v.activeRouteCoords.map((c) => v.map.project(c).y);
    return { editor: Math.round(editor), hidden: ys.filter((y) => y < editor).length, of: ys.length };
  });
  assert.equal(r.hidden, 0, `${r.hidden} of ${r.of} route points under the panel (bottom ${r.editor})`);
});
