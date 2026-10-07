// Builds card-print.pdf: the same two sides as card.pdf, but each side is a
// ~770 dpi image, so the file carries no fonts. Chrome writes web fonts into
// its PDFs as Type 3 fonts, which print shops' preflight (Vistaprint:
// "Your file has un-embedded fonts") rejects.
//   node appstore-assets/marketing/counter-card/make-print.mjs
import { chromium } from "playwright-core";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCALE = 8; // CSS px are 96/in, so 8x is 768 dpi
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ deviceScaleFactor: SCALE });
await page.emulateMedia({ media: "print" }); // hides the trim/safe guides
await page.goto(pathToFileURL(join(HERE, "card.html")).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const sides = page.locator("section.side");
const files = [];
for (let i = 0; i < (await sides.count()); i++) {
  const file = join(HERE, i === 0 ? "print-front.png" : "print-back.png");
  await sides.nth(i).screenshot({ path: file });
  files.push(file);
}
const pages = files
  .map((f) => `<div class="p"><img src="${pathToFileURL(f).href}"></div>`)
  .join("");
await page.setContent(`<!doctype html><style>
  @page { size: 3.75in 2.25in; margin: 0 } * { margin: 0; padding: 0 }
  .p { width: 3.75in; height: 2.25in; page-break-after: always; overflow: hidden }
  .p img { width: 100%; height: 100%; display: block }</style>${pages}`, { waitUntil: "load" });
await page.pdf({ path: join(HERE, "card-print.pdf"), width: "3.75in", height: "2.25in", printBackground: true });
await browser.close();
console.log("card-print.pdf print-front.png print-back.png");
