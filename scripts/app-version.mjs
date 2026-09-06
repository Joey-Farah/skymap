/**
 * The app's marketing version, read from the Xcode project.
 *
 * That file is the authority: it is what Apple shows on the listing and
 * what an installed copy reports about itself, so a second copy of the
 * number anywhere else is a second thing to forget on release day. The
 * bundle needs it at build time to decide whether it is past the update
 * floor (see src/app-version.ts).
 */
import { readFileSync } from "node:fs";

const PBXPROJ = "ios/App/App.xcodeproj/project.pbxproj";

export function readMarketingVersion(path = PBXPROJ) {
  const found = [...readFileSync(path, "utf8").matchAll(/MARKETING_VERSION = ([\d.]+);/g)].map((m) => m[1]);
  const unique = [...new Set(found)];
  // Debug and Release each carry one. Disagreeing is a real mistake — the
  // shipped build would gate itself on a version it never had.
  if (unique.length !== 1) return null;
  return unique[0];
}
