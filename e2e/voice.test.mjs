import test from "node:test";
import assert from "node:assert/strict";

import { launch, startTrip, walkRoute } from "./harness.mjs";

const FROM = "517-marquette-garage-156912894";
const TO = "state-theatre-156912879";

const said = (page) => page.evaluate(() => window.__spoken.filter((s) => s !== "<stop>"));

test("the voice is off until the button turns it on, then it says each new banner line once", async (t) => {
  const { browser, page } = await launch();
  t.after(() => browser.close());
  assert.ok(await startTrip(page, FROM, TO));
  const button = page.locator("#voice-toggle");
  assert.equal(await button.getAttribute("aria-pressed"), "false", "off by default");
  assert.deepEqual(await said(page), [], "GO spoke with the voice off");

  // Turned on, it says where things stand at once, then keeps up.
  await button.click();
  assert.equal(await button.getAttribute("aria-pressed"), "true");
  const first = await page.evaluate(() => document.getElementById("nav-instruction").textContent);
  assert.equal((await said(page))[0]?.startsWith(first), true, `turning it on said ${JSON.stringify(await said(page))}`);

  const walk = await walkRoute(page);
  // One line per banner change: the banner as walked, with repeats collapsed.
  const banners = [first, ...walk.map((s) => s.banner)].filter((b, i, all) => b !== all[i - 1]);
  const spoken = await said(page);
  assert.equal(spoken.length, banners.length, `banners: ${banners.join(" → ")}\nspoken: ${spoken.join(" → ")}`);
  spoken.forEach((line, i) => assert.ok(line.startsWith(banners[i]), `${line} is not "${banners[i]}"`));
  t.diagnostic(spoken.join(" → "));
  assert.equal(spoken.at(-1), "You've arrived");
});

test("End cuts the voice off mid-line", async (t) => {
  const { browser, page } = await launch();
  t.after(() => browser.close());
  assert.ok(await startTrip(page, FROM, TO));
  await page.locator("#voice-toggle").click();
  await page.evaluate(() => (window.__spoken.length = 0));
  await page.locator(".end-btn").click();
  assert.deepEqual(await page.evaluate(() => window.__spoken), ["<stop>"]);
});

test("turned on, the voice stays on next time, and GO says the first instruction", async (t) => {
  const { browser, page } = await launch();
  t.after(() => browser.close());
  assert.ok(await startTrip(page, FROM, TO));
  const button = page.locator("#voice-toggle");
  await button.click();

  // Next launch: GO speaks without being asked again, and the button says so.
  assert.ok(await startTrip(page, FROM, TO));
  assert.equal(await button.getAttribute("aria-pressed"), "true");
  const first = await page.evaluate(() => document.getElementById("nav-instruction").textContent);
  assert.equal((await said(page))[0]?.startsWith(first), true, `GO said ${JSON.stringify(await said(page))}`);

  // And off again: a walk says nothing.
  await button.click();
  await page.evaluate(() => (window.__spoken.length = 0));
  await walkRoute(page);
  assert.deepEqual(await said(page), [], "off, but it spoke");
});
