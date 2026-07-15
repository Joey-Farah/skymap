#!/usr/bin/env node
/** Render public/icons/icon.svg to PNG app icons using headless Chromium. */
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(ROOT, "public/icons/icon.svg"), "utf8");

const executablePath = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const browser = await chromium.launch({ executablePath }).catch(() => chromium.launch());

for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>*{margin:0}</style><div style="width:${size}px;height:${size}px">${svg.replace(
      "<svg ",
      `<svg width="${size}" height="${size}" `,
    )}</div>`,
  );
  await page.screenshot({
    path: join(ROOT, `public/icons/icon-${size}.png`),
    omitBackground: true,
  });
  await page.close();
  console.log(`icon-${size}.png`);
}
await browser.close();
