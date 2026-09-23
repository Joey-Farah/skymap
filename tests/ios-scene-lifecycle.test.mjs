import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Built with the iOS 27 SDK, an app with no scene manifest refuses to launch
// at all. 1.15 shipped that way after Xcode Cloud's "Latest Release" rolled
// to Xcode 27 underneath us. These are the three pieces that have to agree.

const plist = JSON.parse(
  execFileSync("plutil", ["-convert", "json", "-o", "-", "ios/App/App/Info.plist"], { encoding: "utf8" }),
);

test("Info.plist declares a scene manifest pointing at SceneDelegate", () => {
  const manifest = plist.UIApplicationSceneManifest;
  assert.ok(manifest, "no UIApplicationSceneManifest: the app will not launch on the iOS 27 SDK");
  const [config] = manifest.UISceneConfigurations?.UIWindowSceneSessionRoleApplication ?? [];
  assert.equal(config?.UISceneDelegateClassName, "$(PRODUCT_MODULE_NAME).SceneDelegate");
});

test("SceneDelegate is compiled into the app target", () => {
  const project = readFileSync("ios/App/App.xcodeproj/project.pbxproj", "utf8");
  assert.match(project, /SceneDelegate\.swift in Sources \*\/,/, "SceneDelegate.swift exists but is not in the Sources build phase");
});

test("AppDelegate hands new scenes to SceneDelegate", () => {
  const delegate = readFileSync("ios/App/App/AppDelegate.swift", "utf8");
  assert.match(delegate, /configurationForConnecting/);
  assert.match(delegate, /delegateClass = SceneDelegate\.self/);
});
