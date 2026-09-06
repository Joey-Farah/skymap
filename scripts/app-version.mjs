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
  // Debug and Release each carry one. Disagreeing is a real mistake, and a
  // loud one on purpose: the old fallback here was "dev", which the update
  // gate treats as exempt, so a drifted project file would have shipped an
  // archive whose gate silently did nothing at all.
  if (unique.length > 1) {
    throw new Error(`MARKETING_VERSION disagrees between build configurations: ${unique.join(", ")}`);
  }
  return unique[0] ?? null;
}
