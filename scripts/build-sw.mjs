#!/usr/bin/env node
/**
 * Post-build step: rewrites dist/sw.js to precache every real asset from
 * this build (hashed JS/CSS, icons, logos, data) instead of the static
 * placeholder list that ships in public/sw.js for source control. Must
 * run after `vite build` — see package.json's build script.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const DIST = join(ROOT, "dist");

// Skip source maps (large, devtools-only, not needed to run offline) and
// the raw .osm.json debug dump (a pipeline artifact that ends up in
// public/ but was never meant to ship).
const SKIP = /\.map$|\.osm\.json$|^sw\.js$/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(DIST)
  .map((f) => relative(DIST, f).split(sep).join("/"))
  .filter((f) => !SKIP.test(f));

const precache = ["./", ...files.map((f) => `./${f}`)];

const version = createHash("sha256").update(precache.join("\n")).digest("hex").slice(0, 12);

const template = readFileSync(join(DIST, "sw.js"), "utf8");
const rewritten = template
  .replace("__CACHE_VERSION__", version)
  .replace("__PRECACHE_MANIFEST__", JSON.stringify(precache));

writeFileSync(join(DIST, "sw.js"), rewritten);
console.log(`sw.js: precaching ${precache.length} files, cache version ${version}.`);
