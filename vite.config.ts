import { execSync } from "node:child_process";
import { defineConfig } from "vite";

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
