import test from "node:test";
import assert from "node:assert/strict";

import { launch, openApp, activeLine } from "./harness.mjs";

// A trip that stays the same at every hour, through buildings with doors.
const FROM = "517-marquette-garage-156912894";
const TO = "state-theatre-156912879";

const tracking = (page) =>
  page.evaluate(() => ({
    watchState: window.__skymap.view.geolocate._watchState,
    watches: window.__testGeo.watches,
  }));

async function tapLocate(page) {
  await page.click("button.maplibregl-ctrl-geolocate");
  await page.waitForTimeout(600);
}

/** A trip under way with GPS fixes landing on its line. */
async function tripWithFixes(page) {
  await openApp(page, `/?from=${FROM}&to=${TO}`);
  // Let the preview finish drawing the route before GO, as a walker reading
  // it would. (Pressing GO mid-draw is QA 005.)
  await page.waitForFunction(() => window.__skymap.view.routeAnim === 0);
  await page.evaluate(() => window.__skymap.modes.enterNav());
  const line = await activeLine(page);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(([lon, lat]) => window.__testGeo.fix(lat, lon, 10), line.coords[1]);
    await page.waitForTimeout(300);
  }
  return line;
}

test("the first tap after launch keeps tracking on (QA 037)", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual" });
  t.after(() => browser.close());
  await openApp(page);
  // Tracking starts on its own at load; the first fix locks onto you
  // without MapLibre announcing a "focus".
  await page.evaluate(() => window.__testGeo.fix(44.97687, -93.27006, 12));
  await page.waitForTimeout(800);
  assert.equal((await tracking(page)).watchState, "ACTIVE_LOCK");

  await tapLocate(page);
  const after = await tracking(page);
  assert.notEqual(after.watchState, "OFF", "one tap from a locked map is heading-up, not tracking off");
  assert.equal(after.watches, 1);
});

test("mid-trip, a tap on the locate button never stops tracking (QA 037)", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual" });
  t.after(() => browser.close());
  await tripWithFixes(page);
  await tapLocate(page);
  assert.notEqual((await tracking(page)).watchState, "OFF");
  await tapLocate(page);
  await tapLocate(page);
  assert.notEqual((await tracking(page)).watchState, "OFF", "the trip's cycle is lock <-> heading");
});

test("mid-trip, tapping locate after GPS drops keeps the trip tracking (QA 038)", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual" });
  t.after(() => browser.close());
  const line = await tripWithFixes(page);
  // Deep indoors: the native bridge reports a lost fix as code 2.
  await page.evaluate(() => window.__testGeo.error(2));
  await page.waitForTimeout(300);
  await tapLocate(page);
  const after = await tracking(page);
  assert.notEqual(after.watchState, "OFF", "the 'find me' tap must not turn location off");
  assert.equal(after.watches, 1);

  // GPS comes back further along: the trip has to pick it up.
  const before = await page.evaluate(() => window.__skymap.view.tracker?.along ?? null);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(([lon, lat]) => window.__testGeo.fix(lat, lon, 10), line.coords[3]);
    await page.waitForTimeout(300);
  }
  const later = await page.evaluate(() => window.__skymap.view.tracker?.along ?? null);
  assert.ok(later > before, `the dot should move on once fixes return (${before} -> ${later})`);
});

test("GO turns location back on if it was switched off (user report, 2026-10-08)", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual" });
  t.after(() => browser.close());
  await openApp(page, `/?from=${FROM}&to=${TO}`);
  await page.evaluate(() => window.__testGeo.fix(44.97687, -93.27006, 12));
  await page.waitForTimeout(500);
  // Outside a trip the cycle is lock -> heading -> off.
  for (let i = 0; i < 3 && (await tracking(page)).watchState !== "OFF"; i++) await tapLocate(page);
  assert.equal((await tracking(page)).watchState, "OFF");

  await page.evaluate(() => window.__skymap.modes.enterNav());
  await page.waitForTimeout(300);
  const after = await tracking(page);
  assert.notEqual(after.watchState, "OFF", "a trip that can't see you never moves");
  assert.equal(after.watches, 1);
});

test("mid-trip, a lost GPS fix shows the dot as stale until the next fix (QA 039)", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual" });
  t.after(() => browser.close());
  const line = await tripWithFixes(page);
  const walker = () =>
    page.evaluate(() => {
      const f = window.__skymap.view.map.getSource("skyway-walker")?._data?.geojson?.features ?? [];
      return { dots: f.length, stale: f[0]?.properties?.stale ?? null, sub: document.getElementById("nav-instruction-sub").textContent };
    });
  assert.deepEqual((await walker()).stale, false);

  await page.evaluate(() => window.__testGeo.error(2));
  await page.waitForTimeout(300);
  const lost = await walker();
  assert.equal(lost.dots, 1, "keep showing where we last saw you");
  assert.equal(lost.stale, true, "but not as if it were live");
  assert.match(lost.sub, /last known/i);

  await page.evaluate(([lon, lat]) => window.__testGeo.fix(lat, lon, 10), line.coords[2]);
  await page.waitForTimeout(300);
  const back = await walker();
  assert.equal(back.stale, false);
  assert.doesNotMatch(back.sub, /last known/i);
});

test("allowing location in Settings after a denial brings it back without a relaunch (QA 027)", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual" });
  t.after(() => browser.close());
  await openApp(page);
  const button = () =>
    page.evaluate(() => ({
      disabled: document.querySelector("button.maplibregl-ctrl-geolocate").disabled,
      watches: window.__testGeo.watches,
    }));
  const comeBack = () =>
    page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  // "Don't Allow".
  await page.evaluate(() => {
    window.__testGeo.permission = "denied";
    window.__testGeo.error(1);
  });
  await page.waitForTimeout(300);
  assert.deepEqual(await button(), { disabled: true, watches: 0 });

  // Back in the app with nothing changed: still off, and no new prompt.
  await comeBack();
  await page.waitForTimeout(300);
  assert.deepEqual(await button(), { disabled: true, watches: 0 });

  // Settings -> SkyMap -> Location -> While Using, then back to the app.
  await page.evaluate(() => (window.__testGeo.permission = "granted"));
  await comeBack();
  await page.waitForTimeout(300);
  assert.deepEqual(await button(), { disabled: false, watches: 1 });
});
