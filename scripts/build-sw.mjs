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

// Core: the app shell HTML, manifest, the built JS/CSS bundle, and the
// data file — everything the app cannot function without. The SW install
// fails outright (see public/sw.js) if any of these can't be fetched.
// Everything else (icons, splash images, business logos) is best-effort.
const CORE = /^index\.html$|^manifest\.webmanifest$|^data\/skymap-data\.json$|^assets\/.*\.(js|css)$/;
const core = ["./", ...files.filter((f) => CORE.test(f)).map((f) => `./${f}`)];
const extra = files.filter((f) => !CORE.test(f)).map((f) => `./${f}`);
const precache = { core, extra };

const version = createHash("sha256")
  .update(JSON.stringify(precache))
  .digest("hex")
  .slice(0, 12);

const template = readFileSync(join(DIST, "sw.js"), "utf8");

// Replace the quoted placeholder literals (not bare identifiers — see
// public/sw.js's own fallback parsing) with function replacers, which
// side-steps String.replace's special handling of "$" sequences in a
// literal replacement string. Each replace() is asserted to have actually
// matched: a silent no-op here (e.g. after the two files drift apart)
// would ship dist/sw.js still containing the literal placeholder string,
// which is a working, no-op service worker rather than a loud build
// failure — much easier to miss.
function replaceOrThrow(text, needle, replacement) {
  if (!text.includes(needle)) throw new Error(`build-sw: placeholder ${needle} not found in sw.js template`);
  return text.replace(needle, replacement);
}

// public/sw.js's own fallback logic requires both placeholders to remain
// STRING literals after substitution (it calls .startsWith()/JSON.parse()
// on them) — so the JSON payload is double-stringified: once to serialize
// the value, again so that serialized text becomes a valid, escaped JS
// string literal replacing the quoted placeholder (quotes included).
let rewritten = replaceOrThrow(template, '"__CACHE_VERSION__"', () => JSON.stringify(version));
rewritten = replaceOrThrow(rewritten, '"__PRECACHE_MANIFEST__"', () => JSON.stringify(JSON.stringify(precache)));

writeFileSync(join(DIST, "sw.js"), rewritten);
console.log(
  `sw.js: precaching ${core.length} core + ${extra.length} extra files, cache version ${version}.`,
);
