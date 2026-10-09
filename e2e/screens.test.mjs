import test from "node:test";
import assert from "node:assert/strict";

import { launch, openApp } from "./harness.mjs";

const NOON = "2026-10-07T12:00:00-05:00";
const TARGET_TO_IDS = "/?from=target-center-23125943&to=ids-center-1385236413";

const read = (page) =>
  page.evaluate(() => ({
    mode: window.__skymap.modes.current,
    from: document.getElementById("input-from").value,
    to: document.getElementById("input-to").value,
    search: document.getElementById("input-search").value,
    heading: document.querySelector("#sheet h2")?.textContent ?? null,
    sheet: document.getElementById("sheet").innerText,
    url: location.search,
    route: window.__skymap.view.activeRouteCoords.length,
  }));

async function noLocation(t) {
  const r = await launch({ geolocation: null, clockAt: NOON });
  t.after(() => r.browser.close());
  return r.page;
}

test("after Swap, closing directions returns to the new destination's card (QA 014)", async (t) => {
  const page = await noLocation(t);
  await openApp(page, TARGET_TO_IDS);
  await page.click("#btn-swap");
  await page.waitForTimeout(300);
  await page.click("#editor-close");
  await page.waitForTimeout(300);
  const card = await read(page);
  assert.equal(card.heading, "Target Center", "To is Target Center after the swap");
  await page.click("#sheet .actions button.primary");
  await page.waitForTimeout(400);
  const preview = await read(page);
  assert.equal(preview.from, "IDS Center");
  assert.equal(preview.to, "Target Center");
  assert.doesNotMatch(preview.sheet, /already here/i);
});

test("Swap with one side empty doesn't put one place in both fields (QA 018)", async (t) => {
  // No location: Directions leaves From empty, To set. Swapping makes To
  // the empty side — the case that left both fields reading one place.
  const page = await noLocation(t);
  await openApp(page);
  await page.evaluate(() => {
    const s = window.__skymap;
    s.modes.showPlace(s.router.building("ids-center-1385236413"));
    s.modes.enterPreview();
  });
  await page.waitForTimeout(300);
  assert.equal((await read(page)).from, "", "setup: From is empty");
  await page.click("#btn-swap");
  await page.waitForTimeout(400);
  const r = await read(page);
  assert.equal(r.from, "IDS Center");
  assert.equal(r.to, "");
  assert.doesNotMatch(r.sheet, /already here|starting point/i, "and the sheet asks for what's missing");
  assert.match(r.sheet, /destination/i);
});

test("an abandoned edit puts the route back along with the text (review of QA 017)", async (t) => {
  const page = await noLocation(t);
  await openApp(page, TARGET_TO_IDS);
  await page.click("#input-from");
  await page.fill("#input-from", "");
  await page.type("#input-from", "Wells");
  // A minute's refresh lands mid-edit and finds no start...
  await page.clock.fastForward("01:05");
  await page.waitForTimeout(300);
  // ...then the edit is abandoned.
  await page.evaluate(() => document.getElementById("input-from").blur());
  await page.waitForTimeout(300);
  const r = await read(page);
  assert.equal(r.from, "Target Center");
  assert.ok(r.route > 0, "the route is drawn again");
  assert.doesNotMatch(r.sheet, /Choose a starting point/);
});

test("retyping From and leaving without a pick keeps From and the route in step (QA 017)", async (t) => {
  const page = await noLocation(t);
  await openApp(page, TARGET_TO_IDS);
  await page.click("#input-from");
  await page.fill("#input-from", "");
  await page.type("#input-from", "Wells Fargo Center");
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById("input-from").blur());
  await page.waitForTimeout(200);
  const r = await read(page);
  // Whatever the field shows is what the route starts from.
  const first = await page.evaluate(() => document.querySelector("#sheet ul.steps li")?.innerText.split(" — ")[0].trim() ?? null);
  if (r.route > 0) assert.equal(r.from, first, `From says "${r.from}", the route starts at "${first}"`);
  else assert.doesNotMatch(r.sheet, /GO/);
});

test("in a route preview, tapping a building on the map keeps the preview (QA 041)", async (t) => {
  const page = await noLocation(t);
  await openApp(page, TARGET_TO_IDS);
  await page.waitForTimeout(1200);
  const pt = await page.evaluate(() => {
    const s = window.__skymap;
    const b = s.data.buildings.find((x) => x.name === "Minneapolis Marriott City Center");
    const p = s.view.map.project([b.lon, b.lat]);
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(600);
  const r = await read(page);
  assert.equal(r.mode, "preview");
  assert.ok(r.route > 0, "the route is still drawn");
});

test("tapping another building on the map doesn't leave the old search in the bar (QA 042)", async (t) => {
  const page = await noLocation(t);
  await openApp(page);
  await page.click("#input-search");
  await page.type("#input-search", "Target Center");
  await page.waitForTimeout(200);
  await page.click("#combo-search .combo-list li");
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const s = window.__skymap;
    s.modes.showPlace(s.router.building("ids-center-1385236413")); // as a map tap does
  });
  const r = await read(page);
  assert.equal(r.heading, "IDS Center");
  assert.equal(r.search, "", `the bar says "${r.search}" over IDS Center's card`);
});

test("leaving a route preview for a place card drops the old route from the address (QA 020)", async (t) => {
  const page = await noLocation(t);
  await openApp(page, TARGET_TO_IDS);
  await page.click("#editor-close");
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const s = window.__skymap;
    s.modes.showPlace(s.router.building("hennepin-county-government-center-27518018"));
  });
  assert.doesNotMatch((await read(page)).url, /from=|to=/);
});

test("a shared link with an unknown start still opens its destination (QA 019)", async (t) => {
  const page = await noLocation(t);
  await openApp(page, "/?from=ids-center-0000000&to=wells-fargo-center-41763762");
  const r = await read(page);
  assert.ok(r.heading === "Wells Fargo Center" || r.to === "Wells Fargo Center", `${r.mode}, "${r.heading}"`);
});

test("a link where neither place exists says so (QA 019)", async (t) => {
  // Location allowed, so the toast isn't taken by "Location is off".
  const { browser, page } = await launch({ clockAt: NOON });
  t.after(() => browser.close());
  await openApp(page, "/?from=nowhere-1&to=nowhere-2");
  const toast = await page.evaluate(() => (document.getElementById("toast").hidden ? null : document.getElementById("toast").textContent));
  assert.match(toast ?? "", /link/i);
});

test("a place just outside its access building isn't said to be in it (QA 043)", async (t) => {
  const page = await noLocation(t);
  await openApp(page);
  await page.click("#input-search");
  await page.type("#input-search", "Fogo de Chao");
  await page.waitForTimeout(200);
  const row = await page.textContent("#combo-search .combo-list li");
  assert.doesNotMatch(row, /\bin City Center\b/, `search row: "${row}"`);
  await page.click("#combo-search .combo-list li");
  await page.waitForTimeout(500);
  await page.click("#sheet .actions button.primary");
  await page.waitForTimeout(400);
  await page.click("#input-from");
  await page.type("#input-from", "City Center");
  await page.waitForTimeout(200);
  await page.dispatchEvent("#combo-from .combo-list li:not(.current-location-row)", "mousedown");
  await page.waitForTimeout(400);
  const r = await read(page);
  assert.doesNotMatch(r.sheet, /is in City Center/, r.sheet.split("\n").slice(0, 3).join(" | "));
});
