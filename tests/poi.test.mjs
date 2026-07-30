import test from "node:test";
import assert from "node:assert/strict";
import { safeWebsiteUrl } from "../src/poi.ts";

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
