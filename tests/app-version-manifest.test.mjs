import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
