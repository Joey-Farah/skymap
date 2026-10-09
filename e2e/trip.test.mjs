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
