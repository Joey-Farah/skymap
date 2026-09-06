import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMarketingVersion } from "../scripts/app-version.mjs";
import { updateGate } from "../src/app-version.ts";

const manifest = JSON.parse(readFileSync("public/update.json", "utf8"));

test("the shipped manifest never blocks the version being shipped", () => {
  // The way to brick every install is to raise minVersion past the build
  // in flight. This is the guard that would have caught it.
  const version = readMarketingVersion();
  assert.ok(version, "MARKETING_VERSION disagrees between Debug and Release");
  assert.notEqual(updateGate(version, manifest).kind, "block", `${version} would be blocked by its own manifest`);
});

test("the manifest is the shape the gate understands", () => {
  for (const key of ["minVersion", "latestVersion"]) {
    if (manifest[key] !== undefined) {
      assert.match(manifest[key], /^\d+(\.\d+)*$/, `${key} is not a version`);
    }
  }
});

test("a drifted project file fails the build instead of silently exempting it", () => {
  // The old fallback was "dev", which the gate treats as exempt: a Debug
  // and Release disagreement would have shipped an archive whose update
  // gate did nothing, with nothing anywhere saying so.
  const drifted = `MARKETING_VERSION = 1.12;\nMARKETING_VERSION = 1.11;\n`;
  const path = join(mkdtempSync(join(tmpdir(), "skymap-pbx-")), "project.pbxproj");
  writeFileSync(path, drifted);
  assert.throws(() => readMarketingVersion(path), /disagrees/);
});

test("the service worker never answers for the update manifest", () => {
  // Excluding it from the precache list is a different cache: the fetch
  // handler is stale-while-revalidate and would cache it at runtime on
  // first fetch, then answer every later launch from that copy.
  const sw = readFileSync("public/sw.js", "utf8");
  const bypass = sw.indexOf('endsWith("/update.json")');
  const caches = sw.indexOf("caches.match(event.request)");
  assert.ok(bypass !== -1, "the worker has no bypass for update.json");
  assert.ok(caches !== -1, "the caching handler this guards against is gone — re-check the guard");
  assert.ok(bypass < caches, "the bypass comes after the caching handler, so it never runs");
});
