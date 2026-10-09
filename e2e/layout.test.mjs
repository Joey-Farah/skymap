import test from "node:test";
import assert from "node:assert/strict";

import { launch, openApp } from "./harness.mjs";

test("switching to dark mode restyles the map, keeping what's on it (QA 049)", async (t) => {
  const { browser, page } = await launch({ colorScheme: "light" });
  t.after(() => browser.close());
  await openApp(page, "/?from=target-center-23125943&to=ids-center-1385236413");
  await page.waitForFunction(() => window.__skymap.view.routeAnim === 0);
  assert.equal(await page.evaluate(() => window.__skymap.view.styleDark), false);
  await page.emulateMedia({ colorScheme: "dark" }); // sunset, Appearance: Automatic
  await page.waitForFunction(() => window.__skymap.view.styleDark === true, null, { timeout: 15_000 });
  await page.waitForFunction(() => window.__skymap.view.map.getLayer("skyway-buildings-fill"), null, { timeout: 15_000 });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const m = window.__skymap.view.map;
    return {
      layers: ["skyway-buildings-fill", "skyway-pois", "skyway-route-line"].map((id) => !!m.getLayer(id)),
      route: m.getSource("skyway-route")?.serialize().data?.features?.[0]?.geometry?.coordinates?.length ?? 0,
      mode: window.__skymap.modes.current,
    };
  });
  assert.deepEqual(r.layers, [true, true, true]);
  assert.ok(r.route > 1, "the route preview is still drawn");
  assert.equal(r.mode, "preview");
});
