import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { launch, openApp } from "./harness.mjs";

// SkyMap Supporters (docs/business-listings-plan.md). The shipped list is
// empty, so these tests hand the map a list of their own through the test
// handle. The places are real map entries used as stand-ins; none of them
// is a supporter.

const pois = JSON.parse(readFileSync("public/data/skymap-data.json", "utf8")).pois;
const place = (id) => pois.find((p) => p.id === id);
const term = (id) => ({ id, name: place(id).name, from: "2020-01-01", until: "2099-12-31" });

const VITALITY = "poi-12862838545"; // coffee, Six Quebec, Mo-Fr 07:00-16:00
const KADAI = "poi-12862838544"; // food, Six Quebec
const NEAR_VITALITY = { center: [-93.2703, 44.9771], zoom: 16.7 };

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const map = window.__skymap.view.map;
    if (map.loaded() && !map.isMoving()) setTimeout(resolve, 400);
    else map.once("idle", () => setTimeout(resolve, 400));
  }));
}

async function setUp(page, list, view = NEAR_VITALITY) {
  await openApp(page);
  await page.evaluate((list) => window.__skymap.view.setSupporters(list), list);
  await page.evaluate((v) => window.__skymap.view.map.jumpTo(v), view);
  await settle(page);
}

const glowing = (page) =>
  page.evaluate(() =>
    window.__skymap.view.map
      .queryRenderedFeatures({ layers: ["skyway-supporters-glow"] })
      .map((f) => f.properties?.id)
      .sort(),
  );

const chip = (page, name) => page.getByRole("button", { name }).first().click();

test("a supporter glows only while a filter it's in is on", async (t) => {
  const { browser, page } = await launch();
  t.after(() => browser.close());
  await setUp(page, [term(VITALITY), term(KADAI)]);
  assert.deepEqual(await glowing(page), [], "nothing glows with no filter on");
  await chip(page, /Coffee/);
  await settle(page);
  assert.deepEqual(await glowing(page), [VITALITY], "Coffee lights the coffee supporter, not the food one");
  await chip(page, /Coffee/);
  await settle(page);
  assert.deepEqual(await glowing(page), [], "turning Coffee off turns the glow off");
});

test("with the list that ships, empty, nothing glows", async (t) => {
  const { browser, page } = await launch();
  t.after(() => browser.close());
  await setUp(page, []);
  await chip(page, /Coffee/);
  await settle(page);
  assert.deepEqual(await glowing(page), []);
});

test("the glow survives switching between light and dark", async (t) => {
  // Switching appearance swaps the whole basemap style, and every layer of
  // ours has to be put back on top of it.
  const { browser, page } = await launch({ colorScheme: "light" });
  t.after(() => browser.close());
  await setUp(page, [term(VITALITY)]);
  await chip(page, /Coffee/);
  await settle(page);
  assert.deepEqual(await glowing(page), [VITALITY]);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => window.__skymap.view.styleDark === true, null, { timeout: 10_000 });
  await page.waitForFunction(() => window.__skymap.view.map.getLayer("skyway-supporters-glow"), null, { timeout: 10_000 });
  await settle(page);
  assert.deepEqual(await glowing(page), [VITALITY]);
});

test("a supporter never moves or hides another pin or name", async (t) => {
  // The promise in the explainer: pins are placed exactly as they would be
  // with nobody paying. Checked in a crowded food court, where names
  // compete hardest for space.
  const { browser, page } = await launch();
  t.after(() => browser.close());
  const FOOD_COURT = { center: [-93.2688, 44.9768], zoom: 16.35 };
  await setUp(page, [], FOOD_COURT);
  await chip(page, /Food/);
  await settle(page);
  const placed = () =>
    page.evaluate(() => {
      const map = window.__skymap.view.map;
      const pins = map.queryRenderedFeatures({ layers: ["skyway-pois"] }).map((f) => f.properties.id).sort();
      // Every label MapLibre chose to draw, ours and the basemap's.
      const texts = Object.values(map.style.placement.placements).filter((p) => p.text).length;
      return { pins, texts };
    });
  const before = await placed();
  assert.ok(before.pins.length > 20 && before.texts > 20, `a crowded view to test in (${before.pins.length} pins, ${before.texts} labels)`);
  await page.evaluate((list) => window.__skymap.view.setSupporters(list), [term(KADAI), term("poi-14022958830")]);
  await settle(page);
  assert.equal((await glowing(page)).length, 2, "both supporters glow");
  assert.deepEqual(await placed(), before);
});

test("the glow is off while the place is closed, and back when it opens", async (t) => {
  // Vitality Roasting keeps Mo-Fr 07:00-16:00. At 2am on a Wednesday it's
  // shut; the minute tick (setTime) brings the glow back once it opens.
  const { browser, page } = await launch({ clockAt: "2026-10-14T02:00:00-05:00" });
  t.after(() => browser.close());
  await setUp(page, [term(VITALITY)]);
  await chip(page, /Coffee/);
  await settle(page);
  assert.deepEqual(await glowing(page), [], "closed at 2am");
  await page.evaluate(() => window.__skymap.view.setTime(new Date("2026-10-14T12:00:00-05:00")));
  await settle(page);
  assert.deepEqual(await glowing(page), [VITALITY], "open at noon");
});
