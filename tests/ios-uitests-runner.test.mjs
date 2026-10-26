import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

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

test("the UI test build stops if the release settings came out empty", () => {
  // If ci_post_clone.sh ever sets them some other way, the grep finds
  // nothing and eval succeeds on an empty string: the Mail-handoff app
  // again, silently.
  const guard = runner.search(/\[ -n "\$VITE_FEEDBACK_ENDPOINT" \] \|\|/);
  assert.ok(guard !== -1 && guard < buildAt, "run.sh builds without checking it got a feedback endpoint");
});

test("the UI test build refuses a node_modules that doesn't match the lock file", () => {
  const check = runner.search(/node scripts\/check-node-modules\.mjs/);
  assert.ok(check !== -1 && check < buildAt, "run.sh doesn't check node_modules before building");
});

// scripts/check-node-modules.mjs, against a project made up per test.

function project(lock, installed) {
  const root = mkdtempSync(path.join(tmpdir(), "nm-check-"));
  writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...lock } }));
  for (const [where, version] of Object.entries(installed)) {
    mkdirSync(path.join(root, where), { recursive: true });
    writeFileSync(path.join(root, where, "package.json"), JSON.stringify({ version }));
  }
  return root;
}

function check(root) {
  const r = spawnSync(process.execPath, ["scripts/check-node-modules.mjs", root], { encoding: "utf8" });
  return { ok: r.status === 0, out: r.stdout + r.stderr };
}

const GEO = "node_modules/@capacitor/geolocation";

test("node_modules matching the lock passes", () => {
  assert.equal(check(project({ [GEO]: { version: "8.2.3" } }, { [GEO]: "8.2.3" })).ok, true);
});

test("a package older than the lock pins fails, naming it", () => {
  // The 2026-10-26 case. package.json's range doesn't decide this: a lock
  // bump inside the range leaves an old install satisfying it.
  const r = check(project({ [GEO]: { version: "8.2.3" } }, { [GEO]: "8.2.0" }));
  assert.equal(r.ok, false);
  assert.match(r.out, /@capacitor\/geolocation: 8\.2\.0 installed, lock says 8\.2\.3/);
});

test("a nested package counts too, and a missing one fails", () => {
  const nested = "node_modules/a/node_modules/b";
  assert.equal(check(project({ [nested]: { version: "2.0.0" } }, { [nested]: "1.0.0" })).ok, false);
  assert.equal(check(project({ [GEO]: { version: "8.2.3" } }, {})).ok, false);
});

test("an optional package for another platform may be absent", () => {
  // Native bindings for every OS are in the lock; npm installs only ours.
  const linux = "node_modules/@rolldown/binding-linux-x64-gnu";
  assert.equal(check(project({ [linux]: { version: "1.0.0", optional: true } }, {})).ok, true);
});
