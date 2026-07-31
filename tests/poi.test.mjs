import test from "node:test";
import assert from "node:assert/strict";
import { resolvePoiHost, safeWebsiteUrl } from "../src/poi.ts";

test("ordinary http and https links pass through unchanged", () => {
  assert.equal(safeWebsiteUrl("https://example.com/menu"), "https://example.com/menu");
  assert.equal(safeWebsiteUrl("http://example.com"), "http://example.com");
});

test("surrounding whitespace is trimmed", () => {
  assert.equal(safeWebsiteUrl("  https://example.com  "), "https://example.com");
});

test("javascript: URIs are rejected", () => {
  // The reason this guard exists: OSM is publicly editable and the tag
  // value lands straight in an anchor href, so this would execute in the
  // app's own context the moment someone taps "Website".
  assert.equal(safeWebsiteUrl("javascript:alert(1)"), undefined);
  assert.equal(safeWebsiteUrl("JavaScript:alert(1)"), undefined);
  // The URL parser strips tabs/newlines, so an obfuscated scheme still
  // has to be caught after normalization rather than by naive prefix match.
  assert.equal(safeWebsiteUrl("java\nscript:alert(1)"), undefined);
});

test("data: and other non-web schemes are rejected", () => {
  assert.equal(safeWebsiteUrl("data:text/html,<script>alert(1)</script>"), undefined);
  assert.equal(safeWebsiteUrl("file:///etc/passwd"), undefined);
});

test("missing or unparseable values yield undefined so the link is omitted", () => {
  assert.equal(safeWebsiteUrl(undefined), undefined);
  assert.equal(safeWebsiteUrl(""), undefined);
  assert.equal(safeWebsiteUrl("not a url at all"), undefined);
});

// --- resolvePoiHost: which building a place belongs to --------------------
// Two network buildings, ~150 m apart, each a small square footprint.
const near = {
  id: "near-tower",
  lat: 44.975,
  lon: -93.27,
  footprint: [
    [-93.2705, 44.9747],
    [-93.2695, 44.9747],
    [-93.2695, 44.9753],
    [-93.2705, 44.9753],
  ],
};
const far = {
  id: "far-tower",
  lat: 44.9765,
  lon: -93.2725,
  footprint: [
    [-93.273, 44.9762],
    [-93.272, 44.9762],
    [-93.272, 44.9768],
    [-93.273, 44.9768],
  ],
};
const buildings = [near, far];

test("a place inside a building's footprint belongs to that building", () => {
  const host = resolvePoiHost(44.975, -93.27, buildings, 120);
  assert.equal(host?.building.id, "near-tower");
  assert.equal(host?.nearby, false, "it is genuinely inside, not merely close");
});

test("a place just outside every footprint attaches to the nearest building", () => {
  // The Target at 900 Nicollet is exactly this: inside a building the skyway
  // graph never captured, ~78 m from the nearest one it did. Before this it
  // was discarded and JEB couldn't find it.
  const host = resolvePoiHost(44.9756, -93.27, buildings, 120);
  assert.equal(host?.building.id, "near-tower");
  assert.equal(host?.nearby, true, "must be flagged so the card doesn't claim containment");
});

test("a place beyond the radius is still not invented into the network", () => {
  assert.equal(resolvePoiHost(44.99, -93.3, buildings, 120), null);
});

test("nearest wins when two buildings are both in range", () => {
  const host = resolvePoiHost(44.9762, -93.2724, buildings, 200);
  assert.equal(host?.building.id, "far-tower");
});
