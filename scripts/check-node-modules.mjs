// Fails when node_modules isn't what package-lock.json pins: a package at
// another version, or missing. ios/UITests/run.sh runs it first, so the app
// the simulator tests drive is the one Xcode Cloud's `npm ci` would build.
//
// Not `npm ls`: that only checks package.json's ranges, so a lock bump that
// stays inside the range leaves an old install looking fine. A checkout with
// geolocation 8.2.0 built the test app with the GPS freeze that 8.2.3 fixed
// (2026-10-26), and only a range raised in the same change happened to catch it.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// A path argument checks another project instead (the tests use it).
const root = process.argv[2] ?? ".";
const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
const problems = [];
let checked = 0;
for (const [where, entry] of Object.entries(lock.packages ?? {})) {
  if (!where.startsWith("node_modules/") || entry.link || !entry.version) continue;
  const name = where.slice(where.lastIndexOf("node_modules/") + "node_modules/".length);
  const manifest = path.join(root, where, "package.json");
  if (!existsSync(manifest)) {
    // Native bindings for every platform are in the lock; npm installs ours.
    if (!entry.optional && !entry.devOptional) problems.push(`${name}: missing, lock says ${entry.version}`);
    continue;
  }
  checked++;
  const installed = JSON.parse(readFileSync(manifest, "utf8")).version;
  if (installed !== entry.version) problems.push(`${name}: ${installed} installed, lock says ${entry.version}`);
}
if (problems.length) {
  console.error(`node_modules doesn't match package-lock.json (run npm ci):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`node_modules: ${checked} packages, all as package-lock.json pins`);
