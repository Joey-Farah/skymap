import test from "node:test";
import assert from "node:assert/strict";
import { tipJarMode, tipOptions, tipOutcome, PATREON_URL, TIP_IDS } from "../src/tip-jar.ts";

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

test("the three tips pair their names with StoreKit's own prices", () => {
  const products = [
    { id: "app.skymap.ios.tip.large", displayPrice: "9,99 €" },
    { id: "app.skymap.ios.tip.small", displayPrice: "1,99 €" },
    { id: "app.skymap.ios.tip.medium", displayPrice: "4,99 €" },
  ];
  assert.deepEqual(tipOptions(products), [
    { id: "app.skymap.ios.tip.small", label: "☕ Small tip", price: "1,99 €" },
    { id: "app.skymap.ios.tip.medium", label: "🥐 Medium tip", price: "4,99 €" },
    { id: "app.skymap.ios.tip.large", label: "🍽 Large tip", price: "9,99 €" },
  ]);
});

test("a product the app doesn't know about is left out rather than shown unnamed", () => {
  const products = [
    { id: "app.skymap.ios.tip.small", displayPrice: "$1.99" },
    { id: "app.skymap.ios.tip.huge", displayPrice: "$99.99" },
  ];
  assert.deepEqual(tipOptions(products).map((o) => o.id), ["app.skymap.ios.tip.small"]);
});

test("the app asks the store for exactly the three tips", () => {
  assert.deepEqual(TIP_IDS, ["app.skymap.ios.tip.small", "app.skymap.ios.tip.medium", "app.skymap.ios.tip.large"]);
});

test("a purchase thanks the tipper and closes the card", () => {
  assert.deepEqual(tipOutcome("purchased"), { close: true, toast: "Thank you ♥ That means a lot." });
});

test("cancelling says nothing and leaves the card open", () => {
  assert.deepEqual(tipOutcome("cancelled"), { close: false, toast: null });
});

test("Ask to Buy explains the wait", () => {
  assert.deepEqual(tipOutcome("pending"), { close: true, toast: "Waiting for approval. Thank you ♥" });
});

test("a failure says so and leaves the card open to try again", () => {
  assert.deepEqual(tipOutcome("failed"), { close: false, toast: "That didn't go through. You haven't been charged." });
});
