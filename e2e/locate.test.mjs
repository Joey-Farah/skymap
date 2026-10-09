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
      const f = window.__skymap.view.map.getSource("skyway-walker")?.serialize().data?.features ?? [];
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
  // And at full strength. MapLibre's denial path never releases its watch
  // count, so it treats the restart as a second watch and asks for 3 km
  // accuracy with a zero timeout — which on iOS times out at once, forever.
  const options = await page.evaluate(() => window.__testGeo.lastOptions);
  assert.equal(options?.enableHighAccuracy, true);
  assert.ok(options?.timeout > 0, `timeout ${options?.timeout}`);

  // Coming back twice in quick succession changes nothing further.
  await comeBack();
  await comeBack();
  await page.waitForTimeout(300);
  assert.deepEqual(await button(), { disabled: false, watches: 1 });

  // The obvious next move — tapping "find me" before the first fix lands —
  // must not cancel the search that just restarted.
  await tapLocate(page);
  assert.deepEqual(await button(), { disabled: false, watches: 1 });
  await page.evaluate(() => window.__testGeo.fix(44.97687, -93.27006));
  await page.waitForTimeout(300);
  assert.equal((await tracking(page)).watchState, "ACTIVE_LOCK");
});

test("a location toast never covers the locate button or swallows its taps (QA 045)", async (t) => {
  // The longest toast is the one that says to tap that very button again.
  const { browser, context, page } = await launch({ geolocation: "manual", viewport: { width: 375, height: 667 } });
  t.after(() => browser.close());
  await context.addInitScript(() => {
    if (window.DeviceOrientationEvent) window.DeviceOrientationEvent.requestPermission = async () => "denied";
  });
  await openApp(page);
  await page.evaluate(() => window.__testGeo.fix(44.97687, -93.27006));
  await page.waitForFunction(() => window.__skymap.view.geolocate._watchState === "ACTIVE_LOCK");
  await tapLocate(page); // asks for heading-up; motion access is refused
  await page.waitForFunction(() => !document.getElementById("toast").hidden);
  const m = await page.evaluate(() => {
    const t = document.getElementById("toast").getBoundingClientRect();
    const b = document.querySelector("button.maplibregl-ctrl-geolocate");
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const overlap = t.left < r.right && r.left < t.right && t.top < r.bottom && r.top < t.bottom;
    return { text: document.getElementById("toast").textContent, overlap, hitsButton: b.contains(hit) };
  });
  assert.match(m.text, /tap again/);
  assert.equal(m.overlap, false, "the toast sits on top of the button it tells you to tap");
  assert.equal(m.hitsButton, true);
});

test("outside a trip, location that can't find you can still be turned off", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual" });
  t.after(() => browser.close());
  await openApp(page);
  // Deep indoors from the start: the search fails.
  await page.evaluate(() => window.__testGeo.error(2));
  await page.waitForTimeout(300);
  assert.equal((await tracking(page)).watchState, "ACTIVE_ERROR");
  await tapLocate(page);
  assert.equal((await tracking(page)).watchState, "OFF");
});

test("mid-trip, 'find me' after panning away and losing the fix goes back to you (review)", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual" });
  t.after(() => browser.close());
  const line = await tripWithFixes(page);
  await page.evaluate(() => window.__skymap.view.map.panBy([200, 0], { duration: 0 }));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__testGeo.error(2));
  await page.waitForTimeout(200);
  assert.equal((await tracking(page)).watchState, "BACKGROUND_ERROR");
  await tapLocate(page);
  await page.waitForTimeout(600);
  const centreToWalker = await page.evaluate(() => {
    const v = window.__skymap.view;
    const c = v.map.getCenter();
    const [lon, lat] = v.walkerAt;
    return Math.hypot((c.lng - lon) * 78000, (c.lat - lat) * 111000);
  });
  assert.ok(centreToWalker < 20, `the map should be back on you (${Math.round(centreToWalker)} m off)`);
  // And the next fix keeps it there.
  await page.evaluate(([lon, lat]) => window.__testGeo.fix(lat, lon, 10), line.coords[2]);
  await page.waitForTimeout(300);
  assert.equal((await tracking(page)).watchState, "ACTIVE_LOCK");
});

test("at the start of a trip, no fix yet doesn't claim a 'last known spot' (review)", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual" });
  t.after(() => browser.close());
  await openApp(page, `/?from=${FROM}&to=${TO}`);
  await page.waitForFunction(() => window.__skymap.view.routeAnim === 0);
  await page.evaluate(() => window.__skymap.modes.enterNav());
  await page.evaluate(() => window.__testGeo.error(2));
  await page.waitForTimeout(300);
  const sub = await page.evaluate(() => document.getElementById("nav-instruction-sub").textContent);
  assert.doesNotMatch(sub, /last known/i);
});

test("two quick returns to the app after allowing location turn it on once (review)", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual" });
  t.after(() => browser.close());
  await openApp(page);
  await page.evaluate(() => {
    window.__testGeo.permission = "denied";
    window.__testGeo.error(1);
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.__testGeo.permission = "granted";
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(400);
  assert.notEqual((await tracking(page)).watchState, "OFF");
});

test("a permission that catches up just after the return is still noticed (review)", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual" });
  t.after(() => browser.close());
  await openApp(page);
  await page.evaluate(() => {
    window.__testGeo.permission = "denied";
    window.__testGeo.error(1);
  });
  await page.waitForTimeout(300);
  // Back in the app before the new answer is visible...
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(200);
  // ...and it lands a moment later.
  await page.evaluate(() => (window.__testGeo.permission = "granted"));
  await page.waitForTimeout(2000);
  assert.notEqual((await tracking(page)).watchState, "OFF");
});

test("tracking starts at launch even when the permission check is slower than the map", async (t) => {
  // MapLibre's locate control can't start until it has asked the phone
  // about permission; started on the style alone, it refused and nothing
  // ever tracked you (review of QA 026).
  const { browser, page } = await launch({ geolocation: "manual", permissionQueryMs: 1500 });
  t.after(() => browser.close());
  await openApp(page);
  await page.waitForTimeout(2000);
  const now = await tracking(page);
  assert.equal(now.watches, 1, "a watch is running");
  await page.evaluate(() => window.__testGeo.fix(44.97687, -93.27006, 12));
  await page.waitForTimeout(800);
  assert.equal((await tracking(page)).watchState, "ACTIVE_LOCK");
});

test("a link's route keeps the camera when tracking starts after it", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual", permissionQueryMs: 1500 });
  t.after(() => browser.close());
  await openApp(page, `/?from=${FROM}&to=${TO}`);
  await page.waitForFunction(() => window.__skymap.view.routeAnim === 0);
  await page.waitForTimeout(2000);
  const before = await page.evaluate(() => window.__skymap.view.map.getCenter().toArray());
  // A fix well away from the route: following it would fly the camera off.
  await page.evaluate(() => window.__testGeo.fix(44.9705, -93.2795, 12));
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.__skymap.view.map.getCenter().toArray());
  assert.equal((await tracking(page)).watches, 1, "tracking is on");
  assert.deepEqual(after.map((n) => n.toFixed(5)), before.map((n) => n.toFixed(5)), "the preview's camera stayed put");
});

test("a card closed before tracking began doesn't keep the camera from following you", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual", permissionQueryMs: 4000 });
  t.after(() => browser.close());
  await openApp(page);
  await page.evaluate(() => {
    const s = window.__skymap;
    s.modes.showPlace(s.router.building("ids-center-1385236413"));
    s.modes.enterIdle();
  });
  await page.waitForTimeout(4500);
  await page.evaluate(() => window.__testGeo.fix(44.97687, -93.27006, 12));
  await page.waitForTimeout(800);
  assert.equal((await tracking(page)).watchState, "ACTIVE_LOCK");
});
