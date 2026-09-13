import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The web copy of the map is retired: skymap-alpha.vercel.app now exists only
// for what installed apps and the App Store listing fetch from it. Redirecting
// any of these would break every install at once, with no release to fix it.
const MUST_SERVE = ["/update.json", "/api/feedback", "/support.html", "/privacy.html"];

const { redirects } = JSON.parse(readFileSync("vercel.json", "utf8"));
const redirected = (path) => redirects.some((r) => new RegExp(`^${r.source}$`).test(path));

test("everything the app and the listing fetch is still served", () => {
  for (const path of MUST_SERVE) assert.equal(redirected(path), false, `${path} is redirected`);
});

test("the map website itself sends people to the App Store", () => {
  for (const path of ["/", "/index.html", "/data/skymap-data.json"]) assert.ok(redirected(path), `${path} still served`);
});
