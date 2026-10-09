import test from "node:test";
import assert from "node:assert/strict";

import { launch, startTrip, walkRoute, activeLine } from "./harness.mjs";

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
