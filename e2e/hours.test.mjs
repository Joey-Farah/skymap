import test from "node:test";
import assert from "node:assert/strict";

import { launch, openApp } from "./harness.mjs";

/** Open a place's card and read its status badge and hours table. */
async function card(page, name) {
  return page.evaluate((name) => {
    const s = window.__skymap;
    const p = s.data.pois.find((x) => x.name === name);
    s.modes.showPlace(s.router.building(p.buildingId), p);
    const sheet = document.getElementById("sheet");
    return {
      text: sheet.innerText,
      rows: [...sheet.querySelectorAll(".hours-row")].map((r) => r.innerText.replace(/\s+/g, " ").trim()),
    };
  }, name);
}

test("at 1am a bar open until 2am says so (QA 007)", async (t) => {
  const { browser, page } = await launch({ clockAt: "2026-10-10T01:00:00-05:00" }); // Sat 1am
  t.after(() => browser.close());
  await openApp(page);
  const c = await card(page, "On The Rox");
  assert.match(c.text, /Open until 2am/);
  assert.doesNotMatch(c.text, /Closed · opens/);
});

test("breakfast shows as open, and the table shows both sittings (QA 034)", async (t) => {
  const { browser, page } = await launch({ clockAt: "2026-10-14T07:30:00-05:00" }); // Wed 7:30am
  t.after(() => browser.close());
  await openApp(page);
  const c = await card(page, "OUIBar + KTCHN");
  assert.match(c.text, /Open until 9:30am/);
  assert.ok(c.rows.includes("Wednesday 6:30am–9:30am, 5pm–10pm"), c.rows.join(" | "));
});
