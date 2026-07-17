import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native-wrapper config for a future App Store submission. Not wired up
 * yet — `npx cap add ios` needs a full Xcode install (only the Command
 * Line Tools are present in this environment) plus CocoaPods, neither of
 * which could be verified here. This file exists so that once Xcode is
 * available, adding the iOS platform is one command instead of a
 * from-scratch setup: `npx cap add ios && npx cap sync`.
 *
 * appId reverse-DNS is a placeholder — Joey should confirm before first
 * `cap add ios`, since it becomes the permanent bundle identifier once
 * registered with Apple and is painful to change later.
 */
const config: CapacitorConfig = {
  appId: "app.skymap.ios",
  appName: "Skymap",
  webDir: "dist",
  ios: {
    contentInset: "always",
  },
};

export default config;
