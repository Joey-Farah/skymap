import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ios/UITests/run.sh builds the app the simulator tests drive. It has to be
// the app people get, and twice it quietly wasn't (2026-10-26):
// - built without the release build's VITE_ settings, Feedback hands off to
//   Mail instead of opening the form, the simulator has no Mail, and the
//   feedback test failed on an app that works fine in the App Store;
// - built from a node_modules older than the lock file, it carried the
//   geolocation plugin from before the 1.18 GPS-freeze fix, and the walk
//   test's walker never moved.

const runner = readFileSync("ios/UITests/run.sh", "utf8");
const release = readFileSync("ios/App/ci_scripts/ci_post_clone.sh", "utf8");
const buildAt = runner.indexOf("npm run build");

test("the release build sets the feedback endpoint the form needs", () => {
  assert.match(release, /^export VITE_FEEDBACK_ENDPOINT=/m);
});

test("the UI test build takes its VITE_ settings from the release build's script", () => {
  // Read from it rather than copied, so the two can't drift apart.
  const reads = runner.search(/grep -E '\^export VITE_' "\$ROOT\/ios\/App\/ci_scripts\/ci_post_clone\.sh"/);
  assert.ok(reads !== -1, "run.sh doesn't take the VITE_ exports from ci_post_clone.sh");
  assert.ok(reads < buildAt, "the settings are read after the web build has already run");
});

test("the UI test build refuses a node_modules that doesn't match the lock file", () => {
  const check = runner.search(/npm ls\b/);
  assert.ok(check !== -1, "run.sh doesn't check node_modules against the lock file");
  assert.ok(check < buildAt, "node_modules is checked after the web build has already run");
});
