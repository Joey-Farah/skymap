#!/usr/bin/env node
/**
 * Generates iOS "apple-touch-startup-image" splash screens: Safari has no
 * way to synthesize one from the manifest alone, so without these the app
 * launches to a blank white flash before paint. One PNG per common iPhone
 * viewport (device-pixel size), rendered via a headless browser screenshot
 * of a tiny branded HTML page so the splash matches the real icon exactly.
 *
 * Run manually when the icon/brand colors change — not part of the build,
 * since output is static and committed to public/icons/splash/.
 */
import pw from "/Users/joeyfarah/Documents/GitHub/skymap/node_modules/playwright-core/index.mjs";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = pw;
const EXE =
  "/Users/joeyfarah/Library/Caches/ms-playwright/chromium-1228/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const ROOT = join(new URL(".", import.meta.url).pathname, "..");
const OUT = join(ROOT, "public", "icons", "splash");
mkdirSync(OUT, { recursive: true });

// CSS width x height x devicePixelRatio, covering iPhone X (2017) onward —
// current and recent-enough that a specific match is very likely.
const SIZES = [
  { w: 440, h: 956, dpr: 3, label: "440x956-3x" }, // 16 Pro Max
  { w: 430, h: 932, dpr: 3, label: "430x932-3x" }, // 16 Plus, 15 Pro Max, 15/14 Plus
  { w: 428, h: 926, dpr: 3, label: "428x926-3x" }, // 13/12 Pro Max
  { w: 402, h: 874, dpr: 3, label: "402x874-3x" }, // 16 Pro
  { w: 393, h: 852, dpr: 3, label: "393x852-3x" }, // 16, 15/15 Pro, 14 Pro
  { w: 390, h: 844, dpr: 3, label: "390x844-3x" }, // 14, 13, 13 Pro, 12, 12 Pro
  { w: 375, h: 812, dpr: 3, label: "375x812-3x" }, // X, XS, 11 Pro, 13/12 mini
  { w: 414, h: 896, dpr: 3, label: "414x896-3x" }, // XS Max, 11 Pro Max
  { w: 414, h: 896, dpr: 2, label: "414x896-2x" }, // XR, 11
  { w: 375, h: 667, dpr: 2, label: "375x667-2x" }, // SE 2nd/3rd gen
];

const iconSvg = readFileSync(join(ROOT, "public", "icons", "icon.svg"), "utf8");
const BG = "#eff6ff"; // manifest.webmanifest background_color

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:100%;height:100%;background:${BG};
    display:flex;align-items:center;justify-content:center;}
  svg{width:32vmin;height:32vmin;}
</style></head><body>${iconSvg}</body></html>`;

const browser = await chromium.launch({ executablePath: EXE });
for (const { w, h, dpr, label } of SIZES) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  await page.setContent(html);
  const path = join(OUT, `${label}.png`);
  await page.screenshot({ path });
  await page.close();
  console.log(`wrote ${label}.png (${w * dpr}x${h * dpr})`);
}
await browser.close();
