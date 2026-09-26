import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The tip jar's StoreKit plugin lives in the app target rather than in an npm
// package, so nothing but these checks keeps it wired in. A plugin that isn't
// compiled or isn't registered fails quietly: the JS sees no products, and the
// tip jar just never appears.

const project = readFileSync("ios/App/App.xcodeproj/project.pbxproj", "utf8");

for (const file of ["TipJarPlugin.swift", "SkyMapBridgeViewController.swift"]) {
  test(`${file} is compiled into the app target`, () => {
    assert.match(project, new RegExp(`${file.replace(".", "\\.")} in Sources \\*/,`), `${file} is not in the Sources build phase`);
  });
}

test("the bridge registers the tip jar plugin", () => {
  const bridge = readFileSync("ios/App/App/SkyMapBridgeViewController.swift", "utf8");
  assert.match(bridge, /class SkyMapBridgeViewController: CAPBridgeViewController/);
  assert.match(bridge, /registerPluginInstance\(TipJarPlugin\(\)\)/);
});

test("both ways the app builds its root view use the registering bridge", () => {
  // Info.plist names the Main storyboard for the scene and SceneDelegate also
  // builds a root view controller; whichever wins has to carry the plugin.
  assert.match(readFileSync("ios/App/App/SceneDelegate.swift", "utf8"), /rootViewController = SkyMapBridgeViewController\(\)/);
  const storyboard = readFileSync("ios/App/App/Base.lproj/Main.storyboard", "utf8");
  assert.match(storyboard, /customClass="SkyMapBridgeViewController" customModule="App"/);
  assert.doesNotMatch(storyboard, /customClass="CAPBridgeViewController"/);
});

test("the plugin finishes transactions that arrive outside a purchase call", () => {
  // Ask to Buy approvals and interrupted purchases land here. Unfinished,
  // StoreKit redelivers them on every launch.
  const plugin = readFileSync("ios/App/App/TipJarPlugin.swift", "utf8");
  assert.match(plugin, /Transaction\.updates/);
  assert.match(plugin, /\.finish\(\)/);
});

test("unverified transactions are finished too, not redelivered forever", () => {
  // A tip unlocks nothing, so there is nothing to withhold from a transaction
  // StoreKit couldn't verify — but it was charged, and left unfinished it
  // comes back on every launch.
  const plugin = readFileSync("ios/App/App/TipJarPlugin.swift", "utf8");
  assert.match(plugin, /case \.unverified\(let transaction, _\):\s*\n\s*await transaction\.finish\(\)/);
  assert.match(plugin, /case \.success\(\.unverified\(let transaction, _\)\):\s*\n\s*await transaction\.finish\(\)/);
});

test("the product lookup happens on the main actor, where the list is written", () => {
  const plugin = readFileSync("ios/App/App/TipJarPlugin.swift", "utf8");
  const purchase = plugin.slice(plugin.indexOf("func purchase("));
  assert.ok(purchase.indexOf("Task { @MainActor in") < purchase.indexOf("self.products[id]"), "products is read off the main actor");
});
