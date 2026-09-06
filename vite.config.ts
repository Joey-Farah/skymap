import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import { readMarketingVersion } from "./scripts/app-version.mjs";

// Baked into the bundle so feedback emails can say which build they're
// about — the web (SW-updated) and native (archive-frozen) versions of the
// app can otherwise drift with no way to tell them apart from a report.
function gitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

export default defineConfig({
  base: "./",
  define: {
    __BUILD_HASH__: JSON.stringify(gitHash()),
    // "dev" when it can't be read, which the update gate treats as exempt:
    // a local build should never gate itself.
    __APP_VERSION__: JSON.stringify(readMarketingVersion() ?? "dev"),
  },
  build: {
    target: "es2020",
    sourcemap: true,
  },
  server: {
    host: true,
    port: 5173,
  },
});
