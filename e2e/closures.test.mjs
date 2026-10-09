import test from "node:test";
import assert from "node:assert/strict";

import { launch, openApp } from "./harness.mjs";

// Everything a route preview says about time, read off the screen.
const readPreview = (page) =>
  page.evaluate(() => ({
    mode: window.__skymap.modes.current,
    badges: [...document.querySelectorAll(".badge")].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim()),
    steps: [...document.querySelectorAll("ul.steps li")].map((li) => li.textContent),
    arrive: [...document.querySelectorAll(".route-summary span")].map((x) => x.textContent).find((t) => t.startsWith("Arrive")) ?? "",
  }));

/** Minutes past midnight from "Arrive 5:59pm". */
const clockMinutes = (text) => {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(text);
  assert.ok(m, `no time in "${text}"`);
  return ((Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0)) * 60 + Number(m[2] ?? 0);
};

// Outside on the street a few minutes from Butler Square, which opens at
// 6am and closes at 6pm on weekdays.
const NEAR_BUTLER = { latitude: 44.9785, longitude: -93.2829, accuracy: 10 };

async function streetPreviewToButler(clockAt) {
  const { browser, page } = await launch({ clockAt, geolocation: NEAR_BUTLER });
  await openApp(page);
  await page.evaluate(async ({ latitude, longitude }) => {
    const s = window.__skymap;
    s.onPosition(latitude, longitude);
    s.modes.showPlace(s.data.buildings.find((b) => b.id === "butler-square-29060521"));
    s.modes.enterPreview();
    await new Promise((r) => setTimeout(r, 300));
  }, NEAR_BUTLER);
  const r = await readPreview(page);
  await browser.close();
  assert.equal(r.mode, "preview");
  assert.ok(r.badges.some((b) => b.includes("walk outside")), "this setup starts from the street");
  return r;
}

test("from the street, the step list counts the walk to the skyway like the warnings do (QA 006)", async () => {
  // 5:56am: by the time you're inside it's past 6, so Butler Square is open.
  const morning = await streetPreviewToButler("2026-10-14T05:56:00-05:00");
  assert.doesNotMatch(morning.steps.at(-1), /\(closed\)/);
  // 5:55pm: it shuts at 6, before you'd get in — the list has to say so too.
  const evening = await streetPreviewToButler("2026-10-14T17:55:00-05:00");
  assert.ok(evening.badges.some((b) => /Butler Square closes at 6pm, before you'd arrive/.test(b)));
  assert.match(evening.steps.at(-1), /\(closed\)/);
});

test("the arrival time agrees with 'closes before you'd arrive' (QA 036)", async (t) => {
  const { browser, page } = await launch({ clockAt: "2026-10-14T17:57:00-05:00" });
  t.after(() => browser.close());
  await openApp(page, "/?from=rsm-plaza-357019983&to=young-quinlan-building-44684854");
  await page.clock.pauseAt(new Date("2026-10-14T17:57:50-05:00"));
  await page.evaluate(() => window.__skymap.modes.enterPreview());
  const r = await readPreview(page);
  const closedBefore = r.badges.find((b) => /closes at 6pm, before you'd arrive/.test(b));
  if (closedBefore) assert.ok(clockMinutes(r.arrive) >= 18 * 60, `"${r.arrive}" beside "${closedBefore}"`);
});

test("the closing warning that decides the trip is the one shown (QA 050)", async (t) => {
  // Wed 7:40pm: the destination shuts 2 min after you'd get there, and it
  // used to be hidden inside "8 more buildings closing soon".
  const { browser, page } = await launch({ clockAt: "2026-10-07T19:40:00-05:00" });
  t.after(() => browser.close());
  await openApp(page, "/?from=target-center-23125943&to=hennepin-county-government-center-27518018");
  const r = await readPreview(page);
  assert.equal(r.mode, "preview");
  const warnings = r.badges.filter((b) => /closes at|closing soon/.test(b));
  assert.ok(warnings.some((b) => b.includes("Hennepin County Government Center")), warnings.join(" | "));
  assert.ok(!warnings.some((b) => b.startsWith("⚠ Target Center")), "not the building you're leaving");
});

test("a preview left open past closing time is redone, and GO starts the route for now (QA 035)", async (t) => {
  const { browser, page } = await launch({ clockAt: "2026-10-14T17:50:00-05:00" });
  t.after(() => browser.close());
  await openApp(page, "/?from=medical-arts-building-92905817&to=essex-building-461224211");
  assert.equal((await readPreview(page)).mode, "preview");

  await page.clock.fastForward("15:00"); // 6:05pm: Young-Quinlan has shut
  await page.waitForTimeout(500);
  const later = await readPreview(page);
  const now = await page.evaluate(() => new Date().getHours() * 60 + new Date().getMinutes());
  assert.ok(clockMinutes(later.arrive) >= now, `the preview still says "${later.arrive}"`);

  await page.click(".go-btn");
  await page.waitForTimeout(500);
  const nav = await page.evaluate(() => ({
    mode: window.__skymap.modes.current,
    // The middle of the route: the origin is where you are, and the
    // destination is never refused for its hours.
    closedOnTheWay: [...document.querySelectorAll(".nav-bar ~ ul.steps li")]
      .map((l) => l.textContent)
      .slice(1, -1)
      .filter((x) => x.includes("(closed)")),
  }));
  assert.equal(nav.mode, "nav");
  assert.deepEqual(nav.closedOnTheWay, [], "GO walked into a building that had shut since the preview");
});

test("the minute refresh leaves an expanded preview as the reader had it", async (t) => {
  const { browser, page } = await launch({ clockAt: "2026-10-14T12:00:00-05:00" });
  t.after(() => browser.close());
  await openApp(page, "/?from=medical-arts-building-92905817&to=essex-building-461224211");
  const height = () => page.evaluate(() => document.getElementById("sheet").style.maxHeight);
  const peek = await height();
  await page.click("#sheet .sheet-handle"); // drag-up's tap equivalent
  await page.waitForTimeout(400);
  const open = await height();
  assert.notEqual(open, peek, "setup: the sheet should have expanded");
  await page.clock.fastForward("01:05");
  await page.waitForTimeout(400);
  assert.equal(await height(), open);
});

test("from the street after hours, the way into the skyway is an open building (QA 009)", async (t) => {
  // Outside near Butler Square (locks at 6pm) at 7:30pm on a Wednesday.
  const spot = { latitude: 44.98, longitude: -93.2738, accuracy: 10 };
  const { browser, page } = await launch({ clockAt: "2026-10-14T19:30:00-05:00", geolocation: spot });
  t.after(() => browser.close());
  await openApp(page);
  const r = await page.evaluate(async ({ latitude, longitude }) => {
    const s = window.__skymap;
    s.onPosition(latitude, longitude);
    s.modes.showPlace(s.data.buildings.find((b) => b.id === "5th-street-ramp-b-30062750"));
    s.modes.enterPreview();
    await new Promise((r) => setTimeout(r, 300));
    return { from: document.getElementById("input-from").value };
  }, spot);
  const preview = await readPreview(page);
  assert.equal(preview.mode, "preview");
  const way = preview.badges.find((b) => b.includes("walk outside to"));
  assert.ok(way, "this setup starts from the street");
  assert.doesNotMatch(way, /Butler Square/, `${r.from} — ${way}`);
});
