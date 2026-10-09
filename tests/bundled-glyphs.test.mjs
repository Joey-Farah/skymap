import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { bundledGlyphs } from "../src/bundled-glyphs.ts";

const BASE = "capacitor://localhost/";

test("our names' font ranges come from the app, not the internet (QA 024, 025)", () => {
  assert.equal(
    bundledGlyphs("https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf", BASE),
    "capacitor://localhost/fonts/Noto%20Sans%20Regular/0-255.pbf",
  );
  assert.equal(
    bundledGlyphs("https://tiles.openfreemap.org/fonts/Noto Sans Bold/8192-8447.pbf", BASE),
    "capacitor://localhost/fonts/Noto%20Sans%20Bold/8192-8447.pbf",
  );
});

test("anything not bundled still comes from the basemap host", () => {
  assert.equal(bundledGlyphs("https://tiles.openfreemap.org/fonts/Noto%20Sans%20Italic/0-255.pbf", BASE), null);
  assert.equal(bundledGlyphs("https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/1024-1279.pbf", BASE), null);
});

test("every bundled range is actually in the app", () => {
  for (const font of ["Noto Sans Regular", "Noto Sans Bold"]) {
    for (const range of ["0-255", "8192-8447"]) assert.ok(existsSync(`public/fonts/${font}/${range}.pbf`), `${font} ${range}`);
  }
  assert.ok(existsSync("public/fonts/OFL.txt"), "the font's licence travels with it");
});
