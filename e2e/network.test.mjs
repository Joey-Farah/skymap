import test from "node:test";
import assert from "node:assert/strict";

import { launch, BASE, openApp, setOffline } from "./harness.mjs";

/** Load the app without waiting for MapLibre's own "loaded" — the point of
 * these tests is what shows when the basemap never finishes loading. */
async function openWithoutWaiting(page) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__skymap?.view?.map, null, { timeout: 30_000 });
}

const skywayLayers = (page) =>
  page.evaluate(() => {
    const m = window.__skymap.view.map;
    return ["skyway-buildings-fill", "skyway-bridges-line", "skyway-route-line"].filter((id) => {
      try {
        return !!m.getLayer(id);
      } catch {
        return false;
      }
    }).length;
  });

test("on a stalled connection the skyways still draw (QA 026)", async (t) => {
  const { browser, context, page } = await launch();
  t.after(() => browser.close());
  // The style itself answers; the basemap's sprite and tile metadata hang.
  await context.route("**/tiles.openfreemap.org/planet**", () => {});
  await context.route("**/tiles.openfreemap.org/sprites/**", () => {});
  await openWithoutWaiting(page);
  await page.waitForTimeout(4000);
  assert.ok((await skywayLayers(page)) >= 2, "no skyway layers on screen");
});

test("the basemap style is downloaded once, so a drop just after can't blank the map (QA 046)", async (t) => {
  const { browser, context, page } = await launch();
  t.after(() => browser.close());
  let styleFetches = 0;
  await context.route("**/tiles.openfreemap.org/styles/**", (route) => {
    styleFetches++;
    return styleFetches === 1 ? route.fallback() : route.abort("internetdisconnected");
  });
  await openWithoutWaiting(page);
  await page.waitForTimeout(4000);
  assert.ok((await skywayLayers(page)) >= 2, `no skyway layers (style fetched ${styleFetches}×)`);
});

test("opened with no signal, the streets arrive once signal does", async (t) => {
  const { browser, context, page } = await launch({ offline: true });
  t.after(() => browser.close());
  await openApp(page);
  const streets = () =>
    page.evaluate(() => window.__skymap.view.map.getStyle().layers.filter((l) => !l.id.startsWith("skyway")).length);
  assert.ok((await streets()) <= 1, "the blank stand-in is up");
  await setOffline(context, false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForFunction(
    () => window.__skymap.view.map.getStyle()?.layers?.length > 20 && window.__skymap.view.map.getLayer("skyway-buildings-fill"),
    null,
    { timeout: 15_000 },
  );
});

test("opened on a stalled connection, the streets arrive once it clears, with no 'online' event", async (t) => {
  // One bar in a skyway: requests hang, but the phone never says it went
  // offline, so it never says it came back either.
  const { browser, context, page } = await launch({ clockAt: "2026-10-14T12:00:00-05:00" });
  t.after(() => browser.close());
  const hang = (url) => !url.href.startsWith(BASE);
  await context.route(hang, () => {});
  await openApp(page);
  assert.ok(
    await page.evaluate(() => window.__skymap.view.map.getStyle().layers.filter((l) => !l.id.startsWith("skyway")).length <= 1),
    "the blank stand-in is up",
  );
  await context.unroute(hang);
  await page.clock.fastForward("00:31");
  await page.waitForFunction(
    () => window.__skymap.view.map.getStyle()?.layers?.length > 20 && window.__skymap.view.map.getLayer("skyway-buildings-fill"),
    null,
    { timeout: 20_000 },
  );
});

test("with no signal at all, going dark darkens the blank map too", async (t) => {
  const { browser, page } = await launch({ offline: true, colorScheme: "light" });
  t.after(() => browser.close());
  await openApp(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => window.__skymap.view.styleDark === true, null, { timeout: 10_000 });
  await page.waitForFunction(() => window.__skymap.view.map.getLayer("skyway-buildings-fill"), null, { timeout: 10_000 });
  const bg = await page.evaluate(() => window.__skymap.view.map.getPaintProperty("background", "background-color"));
  assert.equal(bg, "#14161a");
});
