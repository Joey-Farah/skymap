import test from "node:test";
import assert from "node:assert/strict";

import { launch, startTrip, walkRoute } from "./harness.mjs";

// The same walk the simulator UI test makes (ios/UITests): one path at every
// hour of the week, so this test doesn't depend on the clock.
const FROM = "target-plaza-45452119";
const TO = "lasalle-plaza-461227727";

test("a perfect walk names each building in turn", async (t) => {
  const { browser, page, pageErrors } = await launch();
  t.after(() => browser.close());

  assert.ok(await startTrip(page, FROM, TO), "the route preview should reach navigation");
  const samples = await walkRoute(page, { standStillS: 5 });

  const banners = samples.map((s) => s.banner).filter((b, i, all) => b && b !== all[i - 1]);
  assert.ok(banners.length >= 3, `the banner should move through the route: ${banners.join(" → ")}`);
  assert.deepEqual(pageErrors, []);
});
