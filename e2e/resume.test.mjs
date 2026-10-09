import test from "node:test";
import assert from "node:assert/strict";

import { launch, openApp, activeLine, walkRoute } from "./harness.mjs";

const SIX_QUEBEC = [44.97687, -93.27006];
const CARIBOU = "poi-2600380079"; // Caribou Coffee, reached through Target Plaza

const state = (page) =>
  page.evaluate(() => ({
    mode: window.__skymap.modes.current,
    from: document.getElementById("input-from").value,
    to: document.getElementById("input-to").value,
    url: location.search,
    line: window.__skymap.view.activeRouteCoords,
  }));

/** Standing in Six Quebec, GO to Caribou Coffee, then half the walk. Returns
 * where along the line that left you. */
async function halfwayToCaribou(page) {
  await openApp(page);
  await page.evaluate(([lat, lon]) => window.__testGeo.fix(lat, lon, 12), SIX_QUEBEC);
  await page.waitForTimeout(800);
  await page.evaluate((id) => {
    const s = window.__skymap;
    const poi = s.data.pois.find((p) => p.id === id);
    s.modes.showPlace(s.router.building(poi.buildingId), poi);
    s.modes.enterPreview();
  }, CARIBOU);
  await page.waitForFunction(() => window.__skymap.view.routeAnim === 0);
  await page.evaluate(() => window.__skymap.modes.enterNav());
  const line = await activeLine(page);
  const mid = line.coords[Math.floor(line.coords.length / 2)];
  await page.evaluate(([lon, lat]) => window.__testGeo.fix(lat, lon, 10), mid);
  await page.waitForTimeout(500);
  assert.equal((await state(page)).mode, "nav");
  return mid;
}

test("reloaded mid-trip, the trip picks up from where you are, to the same place (QA 051)", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual" });
  t.after(() => browser.close());
  const mid = await halfwayToCaribou(page);
  await page.reload({ waitUntil: "domcontentloaded" }); // iOS reclaimed the web view
  await page.waitForFunction(() => window.__skymap?.view?.map?.isStyleLoaded?.(), null, { timeout: 45_000 });
  await page.waitForTimeout(800);
  await page.evaluate(([lon, lat]) => window.__testGeo.fix(lat, lon, 10), mid);
  await page.waitForFunction(() => window.__skymap.modes.current === "nav", null, { timeout: 5000 }).catch(() => {});
  const r = await state(page);
  assert.equal(r.mode, "nav", `came back in ${r.mode}`);
  assert.equal(r.to, "Caribou Coffee", "still the coffee shop, not its building");
  assert.match(r.from, /Current Location/);
  // From here, not from Six Quebec: the line starts within a building of you.
  const [lon, lat] = r.line[0];
  const meters = Math.hypot((lon - mid[0]) * 78_600, (lat - mid[1]) * 111_000);
  assert.ok(meters < 150, `the route starts ${Math.round(meters)} m from you`);
});

test("reloaded after a trip was left for half an hour, the map opens clean", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual" });
  t.after(() => browser.close());
  await halfwayToCaribou(page);
  await page.clock.fastForward("31:00");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__skymap?.view?.map?.isStyleLoaded?.(), null, { timeout: 45_000 });
  await page.waitForTimeout(800);
  await page.evaluate(([lat, lon]) => window.__testGeo.fix(lat, lon, 10), SIX_QUEBEC);
  await page.waitForTimeout(800);
  const r = await state(page);
  assert.equal(r.mode, "idle");
  assert.equal(r.url, "", "and no old route in the address to reopen");
});

test("a shared link opened mid-trip opens that link, not the old trip", async (t) => {
  // A reload by iOS never carries a link: GO clears the address. So a link
  // in the address is someone opening one, and it wins.
  const { browser, page } = await launch({ geolocation: "manual" });
  t.after(() => browser.close());
  await halfwayToCaribou(page);
  await openApp(page, "/?from=target-center-23125943&to=ids-center-1385236413");
  const r = await state(page);
  assert.equal(r.mode, "preview");
  assert.equal(r.from, "Target Center");
  assert.equal(r.to, "IDS Center");
});

test("reloaded just after arriving, the finished trip doesn't start again", async (t) => {
  // Arrive, lock the phone before "You've arrived" clears itself, and iOS
  // reloads the app while you're back at your desk.
  const { browser, page } = await launch({ geolocation: "manual" });
  t.after(() => browser.close());
  await halfwayToCaribou(page);
  const walk = await walkRoute(page, { drift: 0 });
  assert.ok(walk.some((w) => w.banner === "You've arrived"), "arrived");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__skymap?.view?.map?.isStyleLoaded?.(), null, { timeout: 45_000 });
  await page.waitForTimeout(800);
  await page.evaluate(([lat, lon]) => window.__testGeo.fix(lat, lon, 10), SIX_QUEBEC);
  await page.waitForTimeout(1000);
  assert.notEqual((await state(page)).mode, "nav");
});

test("a resumed trip that's left without starting isn't offered again", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual" });
  t.after(() => browser.close());
  await halfwayToCaribou(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__skymap?.view?.map?.isStyleLoaded?.(), null, { timeout: 45_000 });
  await page.waitForTimeout(800);
  assert.equal((await state(page)).mode, "preview", "offered, waiting for a fix");
  await page.click("#editor-close"); // not now
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__skymap?.view?.map?.isStyleLoaded?.(), null, { timeout: 45_000 });
  await page.waitForTimeout(800);
  await page.evaluate(([lat, lon]) => window.__testGeo.fix(lat, lon, 10), SIX_QUEBEC);
  await page.waitForTimeout(1000);
  assert.equal((await state(page)).mode, "idle");
});
