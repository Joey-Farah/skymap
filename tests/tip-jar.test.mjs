import test from "node:test";
import assert from "node:assert/strict";
import { tipJarMode, PATREON_URL } from "../src/tip-jar.ts";

// The iOS app may only take tips through Apple (an external payment link is
// rejectable outside the US storefront, and SkyMap sells worldwide). The web
// has no such rule and links Patreon instead.

test("the web offers Patreon", () => {
  assert.equal(tipJarMode({ native: false, products: [] }), "patreon");
});

test("the iOS app offers Apple tips once products have loaded", () => {
  const products = [{ id: "app.skymap.ios.tip.small", displayPrice: "$1.99" }];
  assert.equal(tipJarMode({ native: true, products }), "iap");
});

test("the iOS app never falls back to Patreon, it hides the tip jar", () => {
  // No products means the agreement isn't active, StoreKit is offline, or the
  // plugin is missing. A Patreon link here would be the rejectable one.
  assert.equal(tipJarMode({ native: true, products: [] }), "hidden");
});

test("the Patreon link is Joey's page", () => {
  assert.equal(PATREON_URL, "https://www.patreon.com/joeydonuts");
});
