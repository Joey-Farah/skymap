import test from "node:test";
import assert from "node:assert/strict";

import { launch, openApp, BASE } from "./harness.mjs";

// One bar of signal: requests off the phone neither answer nor fail. The
// app's own data is local; the map's font used to come from the internet.
async function stalled(t) {
  const r = await launch();
  t.after(() => r.browser.close());
  await r.context.route((url) => !url.href.startsWith(BASE), () => {}); // never answered
  return r;
}

const names = (page, layers) =>
  page.evaluate((layers) => window.__skymap.view.map.queryRenderedFeatures({ layers }).map((f) => f.properties?.name), layers);

test("on a stalled connection, pins and building names still draw (QA 024)", async (t) => {
  const { page } = await stalled(t);
  await openApp(page);
  await page.evaluate(() => window.__skymap.view.map.jumpTo({ center: [-93.2715, 44.9765], zoom: 17.2 }));
  await page.getByRole("button", { name: /Coffee/ }).first().click();
  await page.waitForTimeout(4000);
  const shown = await names(page, ["skyway-pois", "skyway-buildings-label"]);
  assert.ok(shown.length >= 5, `only ${shown.length} labels: ${shown.join(", ")}`);
});

test("a curly apostrophe in one name doesn't hide the pins around it (QA 025)", async (t) => {
  // Signal comes and goes: first the map's requests fail outright, then,
  // walking into a skyway, they hang. The names seen so far are plain
  // Latin; "Tom’s Watch Bar" is the first to need the font's
  // punctuation range, and a hanging request for it hid every pin around.
  const { browser, context, page } = await launch();
  t.after(() => browser.close());
  let phase = "fail";
  await context.route(
    (url) => !url.href.startsWith(BASE),
    (route) => (phase === "fail" ? route.abort("internetdisconnected") : undefined),
  );
  await openApp(page);
  await page.evaluate(() => window.__skymap.view.map.jumpTo({ center: [-93.2715, 44.9765], zoom: 17.2 }));
  await page.getByRole("button", { name: /Coffee/ }).first().click();
  await page.waitForTimeout(3000);
  phase = "stall";
  await page.getByRole("button", { name: /Coffee/ }).first().click();
  await page.getByRole("button", { name: /Food/ }).first().click();
  await page.evaluate(() => window.__skymap.view.map.jumpTo({ center: [-93.2736, 44.9785], zoom: 17.6 }));
  await page.waitForTimeout(4000);
  const shown = await names(page, ["skyway-pois"]);
  assert.ok(shown.length >= 10, `only ${shown.length} pins: ${shown.join(", ")}`);
  assert.ok(shown.some((n) => n?.includes("’")), "the name with the curly apostrophe draws too");
});
