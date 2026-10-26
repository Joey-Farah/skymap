import test from "node:test";
import assert from "node:assert/strict";

import { launch, startTrip, walkRoute } from "./harness.mjs";

const FROM = "517-marquette-garage-156912894";
const TO = "state-theatre-156912879";

const said = (page) => page.evaluate(() => window.__spoken.filter((s) => s !== "<stop>"));

test("GO says the first instruction, and each new banner line is said once", async (t) => {
  const { browser, page } = await launch();
  t.after(() => browser.close());
  assert.ok(await startTrip(page, FROM, TO));
  const first = await page.evaluate(() => document.getElementById("nav-instruction").textContent);
  assert.equal((await said(page))[0]?.startsWith(first), true, `GO said ${JSON.stringify(await said(page))}`);

  const walk = await walkRoute(page);
  // One line per banner change: the banner as walked, with repeats collapsed.
  const banners = [first, ...walk.map((s) => s.banner)].filter((b, i, all) => b !== all[i - 1]);
  const spoken = await said(page);
  assert.equal(spoken.length, banners.length, `banners: ${banners.join(" → ")}\nspoken: ${spoken.join(" → ")}`);
  spoken.forEach((line, i) => assert.ok(line.startsWith(banners[i]), `${line} is not "${banners[i]}"`));
  t.diagnostic(spoken.join(" → "));
  assert.equal(spoken.at(-1), "You've arrived");
});
