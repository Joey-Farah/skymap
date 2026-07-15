#!/usr/bin/env node
/** Render public/icons/icon.svg to PNG app icons using headless Chromium. */
import { chromium } from "playwright-core";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(ROOT, "public/icons/icon.svg"), "utf8");

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (existsSync("/opt/pw-browsers/chromium")) return "/opt/pw-browsers/chromium";
  // Playwright browser cache on macOS.
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(cache)) {
    const dir = readdirSync(cache)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .pop();
    if (dir) {
      const mac = join(
        cache,
        dir,
        "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      );
      if (existsSync(mac)) return mac;
    }
  }
  return undefined; // let playwright try its default resolution
}

const browser = await chromium.launch({ executablePath: findChromium() });

async function render(name, size, { svgSource = svg, transparent = true } = {}) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>*{margin:0}</style><div style="width:${size}px;height:${size}px">${svgSource.replace(
      "<svg ",
      `<svg width="${size}" height="${size}" `,
    )}</div>`,
  );
  await page.screenshot({
    path: join(ROOT, `public/icons/${name}`),
    omitBackground: transparent,
  });
  await page.close();
  console.log(name);
}

for (const size of [192, 512]) await render(`icon-${size}.png`, size);

// iOS home-screen icon: full-bleed square, opaque — iOS masks its own
// corners, and transparent pixels render as black there.
await render("apple-touch-icon.png", 180, {
  svgSource: svg.replace('rx="112"', 'rx="0"'),
  transparent: false,
});

await browser.close();
