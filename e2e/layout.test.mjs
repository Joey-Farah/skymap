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

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

test("the update banner never covers a place card (QA 001)", async (t) => {
  const { browser, context, page } = await launch();
  t.after(() => browser.close());
  await context.route("**/update.json**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: '{"latestVersion":"99.0"}' }),
  );
  await openApp(page);
  await page.waitForSelector("#update-banner:not([hidden])");
  await page.evaluate(() => window.__skymap.modes.showPlace(window.__skymap.router.building("ids-center-1385236413")));
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const rect = (el) => el.getBoundingClientRect().toJSON();
    return {
      banner: rect(document.getElementById("update-banner")),
      sheet: rect(document.getElementById("sheet")),
      search: rect(document.getElementById("search-bar-top")),
    };
  });
  assert.ok(!overlaps(r.banner, r.sheet), "the banner sits on the card");
  assert.ok(!overlaps(r.banner, r.search), "the banner sits on the search bar");
});

test("the place card's ✕ has a full-size tap target (QA 023)", async (t) => {
  const { browser, page } = await launch();
  t.after(() => browser.close());
  await openApp(page);
  await page.evaluate(() => window.__skymap.modes.showPlace(window.__skymap.router.building("ids-center-1385236413")));
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const close = document.querySelector("#sheet .sheet-close");
    const b = close.getBoundingClientRect();
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    // A near miss: 9pt left of the circle, and 9pt below it.
    const hits = [[cx - b.width / 2 - 8, cy], [cx, cy + b.height / 2 + 8]].map(([x, y]) => close.contains(document.elementFromPoint(x, y)));
    return { size: Math.round(b.width), hits };
  });
  assert.deepEqual(r.hits, [true, true], `a ${r.size}pt circle with no margin for a fingertip`);
});
