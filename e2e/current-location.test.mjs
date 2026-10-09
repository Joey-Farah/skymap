import test from "node:test";
import assert from "node:assert/strict";

import { launch, openApp } from "./harness.mjs";

const NOON = "2026-10-14T12:00:00-05:00"; // a Wednesday: everything open
const SIX_QUEBEC = [44.97687, -93.27006];

const sheetText = (page) => page.evaluate(() => document.getElementById("sheet").innerText);
const directionsButton = (page) =>
  page.evaluate(() => [...document.querySelectorAll("#sheet button")].map((b) => b.textContent.trim()).find((t) => t.startsWith("Directions")) ?? null);
const minutesIn = (text) => Number(/(\d+) min/.exec(text ?? "")?.[1] ?? NaN);

async function pick(page, input, text) {
  await page.click(input);
  await page.fill(input, "");
  await page.type(input, text);
  await page.waitForTimeout(200);
  await page.dispatchEvent(`${input.replace("#input-", "#combo-")} .combo-list li:not(.current-location-row)`, "mousedown");
  await page.waitForTimeout(400);
}

test("Current Location's building and the walk to it stay one pair as the fix moves (QA 010)", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual", clockAt: NOON });
  t.after(() => browser.close());
  await openApp(page);
  await page.evaluate(([lat, lon]) => window.__testGeo.fix(lat, lon), SIX_QUEBEC);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const s = window.__skymap;
    s.modes.showPlace(s.router.building("target-center-23125943"));
    s.modes.enterPreview();
  });
  await page.evaluate(() => window.__testGeo.fix(44.9745, -93.265)); // a few blocks on
  await page.waitForTimeout(300);
  await pick(page, "#input-to", "Hennepin County Gov");
  const r = await page.evaluate(() => ({
    from: document.getElementById("input-from").value,
    walkTo: document.getElementById("sheet").innerText.match(/walk outside to (.+?) first/)?.[1] ?? null,
    firstStep: document.querySelector("#sheet ul.steps li")?.innerText.split(" — ")[0].replace(" (closed)", "").trim() ?? null,
  }));
  assert.ok(r.walkTo, "this setup is outside the network");
  assert.equal(r.walkTo, r.firstStep, "the walk leads to the building the route starts in");
  assert.equal(r.from, `Current Location · ${r.firstStep}`);
});

test("standing outside the building you're routing to, Directions gives the walk, not 'already here' (QA 013)", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual", clockAt: NOON });
  t.after(() => browser.close());
  await openApp(page);
  await page.evaluate(() => window.__testGeo.fix(44.965, -93.279)); // a few blocks south of the Convention Center
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const s = window.__skymap;
    s.modes.showPlace(s.router.building("minneapolis-convention-center-42837791"));
  });
  await page.waitForTimeout(200);
  const button = await directionsButton(page);
  assert.ok(minutesIn(button) > 0, `the card should say how far: "${button}"`);
  await page.evaluate(() => window.__skymap.modes.enterPreview());
  await page.waitForTimeout(300);
  const text = await sheetText(page);
  assert.doesNotMatch(text, /already here|already at/i);
  assert.equal(minutesIn(text), minutesIn(button), text.split("\n").slice(0, 3).join(" | "));
});

test("swapping From and To twice brings Current Location and its walk back (QA 040)", async (t) => {
  const { browser, page } = await launch({ geolocation: { latitude: 44.97, longitude: -93.268, accuracy: 10 }, clockAt: NOON });
  t.after(() => browser.close());
  await openApp(page);
  await page.waitForFunction(() => window.__skymap.view.geolocate._watchState === "ACTIVE_LOCK");
  const read = () =>
    page.evaluate(() => ({
      from: document.getElementById("input-from").value,
      to: document.getElementById("input-to").value,
      minutes: parseInt(document.querySelector("#sheet .route-summary .big")?.textContent ?? "", 10),
      walk: [...document.querySelectorAll("#sheet .badge")].map((b) => b.textContent).find((x) => x.includes("walk outside")) ?? null,
    }));
  await page.evaluate(() => window.__skymap.modes.showPlace(window.__skymap.router.building("ids-center-1385236413")));
  await page.waitForTimeout(300);
  await page.click("#sheet .actions button.primary");
  await page.waitForTimeout(500);
  const before = await read();
  assert.match(before.from, /^Current Location/);
  assert.ok(before.walk, "setup: the trip starts with a walk outside");
  await page.click("#btn-swap");
  await page.waitForTimeout(300);
  await page.click("#btn-swap");
  await page.waitForTimeout(400);
  assert.deepEqual(await read(), before);
});

test("a place card's walk time is from the start Directions will use (QA 016)", async (t) => {
  const { browser, page } = await launch({ clockAt: NOON });
  t.after(() => browser.close());
  await openApp(page);
  await page.evaluate(([lat, lon]) => window.__skymap.onPosition(lat, lon), SIX_QUEBEC);
  await page.evaluate(() => window.__skymap.modes.showPlace(window.__skymap.router.building("wells-fargo-center-41763762")));
  await page.click("#sheet .actions button.primary");
  await page.waitForTimeout(300);
  await pick(page, "#input-from", "Target Center");
  await page.click("#editor-close");
  await page.waitForTimeout(300);
  await pick(page, "#input-search", "Hennepin County Government Center");
  const button = await directionsButton(page);
  await page.click("#sheet .actions button.primary");
  await page.waitForTimeout(400);
  const summary = await page.evaluate(() => document.querySelector("#sheet .route-summary .big")?.textContent ?? "");
  assert.equal(minutesIn(button), minutesIn(summary), `card "${button}", preview "${summary}"`);
});

test("an open place card stops quoting a walk from you when location goes off (QA 011)", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual", clockAt: NOON });
  t.after(() => browser.close());
  await openApp(page);
  await page.evaluate(([lat, lon]) => window.__testGeo.fix(lat, lon), SIX_QUEBEC);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const s = window.__skymap;
    const p = s.data.pois.find((x) => x.buildingId === "target-center-23125943" && x.name === "Life Time");
    s.modes.showPlace(s.router.building(p.buildingId), p);
  });
  assert.ok(minutesIn(await directionsButton(page)) > 0, "setup: the card quotes a walk");
  await page.evaluate(() => window.__testGeo.error(1));
  await page.waitForTimeout(300);
  assert.equal(await directionsButton(page), "Directions");
  assert.doesNotMatch(await sheetText(page), /from you/i);
});

test("a fix that lands after Directions asked for a start offers Current Location (QA 012)", async (t) => {
  const { browser, page } = await launch({ geolocation: "manual", clockAt: NOON });
  t.after(() => browser.close());
  await openApp(page);
  await page.evaluate(() => {
    const s = window.__skymap;
    s.modes.showPlace(s.router.building("target-center-23125943"));
    s.modes.enterPreview();
  });
  await page.waitForTimeout(300);
  assert.match(await sheetText(page), /Choose a starting point/);
  await page.evaluate(([lat, lon]) => window.__testGeo.fix(lat, lon), SIX_QUEBEC);
  await page.waitForTimeout(400);
  const row = await page.evaluate(() => {
    const list = document.querySelector("#combo-from .combo-list");
    return list.hidden ? null : list.querySelector(".current-location-row")?.innerText ?? null;
  });
  assert.match(row ?? "", /Current Location/);
});
