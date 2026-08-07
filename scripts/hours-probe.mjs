/**
 * Fetch the page a business actually publishes its hours on, and return the
 * text around it for a human (or agent) to READ.
 *
 * Three earlier mistakes, each of which put a false "no hours published"
 * into the ledger:
 *
 *   1. Only the homepage was loaded. Hours normally live one click away on
 *      Contact / Location & Hours / Visit. Manny's Steakhouse publishes
 *      "Sunday - Thursday 7am - 9pm" at /contact, and was recorded as
 *      having none.
 *   2. A regex decided the verdict. When it missed, the miss was written
 *      down as a researched fact rather than as "my pattern found nothing".
 *   3. The page was never scrolled, so lazily-loaded sections never
 *      rendered at all.
 *
 * So this scrolls, follows the likeliest hours link, and returns raw text.
 * It deliberately does not conclude anything: `none` is only ever a
 * judgement made after reading, never a tool's silence.
 *
 *   node scripts/hours-probe.mjs batch.json
 */
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const items = JSON.parse(readFileSync(process.argv[2], "utf8"));
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const HOURS_LINK = /hour|location|contact|visit|find\s*us|our\s*place/i;

const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 430, height: 900 } });

async function readPage(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 110));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1000);
  return (await page.innerText("body")).replace(/\s+/g, " ");
}

/** Text around every mention of hours — what to read, not what to conclude. */
function excerpts(text) {
  const out = [];
  const re = /hours?\b/gi;
  let m;
  while ((m = re.exec(text)) && out.length < 3) {
    out.push(text.slice(Math.max(0, m.index - 40), m.index + 240));
    re.lastIndex = m.index + 240;
  }
  return out;
}

const jobs = items.map(async ({ id, name, website }) => {
  const page = await ctx.newPage();
  const row = { id, name, website, pages: [] };
  try {
    const home = await readPage(page, website);
    row.pages.push({ url: website, excerpts: excerpts(home) });

    // Follow the most promising hours/contact link, same origin only.
    const links = await page.$$eval("a", (as) =>
      as.map((a) => ({ text: (a.textContent || "").trim().slice(0, 40), href: a.href })),
    );
    const origin = new URL(website).origin;
    const seen = new Set([website.replace(/\/$/, "")]);
    const candidates = links
      .filter((l) => l.href.startsWith(origin) && HOURS_LINK.test(l.text + " " + l.href))
      .filter((l) => !seen.has(l.href.replace(/\/$/, "")))
      .slice(0, 2);
    for (const c of candidates) {
      try {
        const t = await readPage(page, c.href);
        row.pages.push({ url: c.href, excerpts: excerpts(t) });
      } catch {
        /* a dead nav link is not a finding */
      }
    }
  } catch (e) {
    row.error = `${e.name}: ${String(e.message).slice(0, 60)}`;
  } finally {
    await page.close();
  }
  return row;
});

for (const r of await Promise.all(jobs)) {
  console.log(`\n### ${r.id} | ${r.name}`);
  if (r.error) console.log(`   ERROR ${r.error}`);
  for (const pg of r.pages) {
    if (!pg.excerpts.length) continue;
    console.log(`   [${pg.url}]`);
    for (const e of pg.excerpts) console.log(`     ${e.slice(0, 300)}`);
  }
  if (!r.pages.some((p) => p.excerpts.length) && !r.error) console.log("   (no 'hours' text on homepage or its hours/contact link)");
}
await browser.close();
