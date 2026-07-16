import test from "node:test";
import assert from "node:assert/strict";
import { logoKey } from "../src/logo.ts";

test("logoKey reduces a website URL to a stable domain slug", () => {
  assert.equal(logoKey("https://www.kierans.com/"), "kierans-com");
  assert.equal(logoKey("http://corner.coffee"), "corner-coffee");
  assert.equal(logoKey("https://locations.dunnbrothers.com/mn/minneapolis/x.html"), "locations-dunnbrothers-com");
});

test("logoKey handles scheme-less OSM website tags", () => {
  assert.equal(logoKey("kierans.com"), "kierans-com");
  assert.equal(logoKey("www.walgreens.com/store"), "walgreens-com");
});

test("logoKey returns null for garbage", () => {
  assert.equal(logoKey("not a url"), null);
  assert.equal(logoKey(""), null);
  assert.equal(logoKey(undefined), null);
});

test("same domain gives same key regardless of path or protocol", () => {
  assert.equal(logoKey("https://www.fogodechao.com/menu"), logoKey("http://www.fogodechao.com/"));
});
