/**
 * Gather *candidate* opening hours for POIs that have none.
 *
 * Deliberately does NOT decide anything. Automated hours extraction was
 * tried and rejected once already, for a good reason: one sampled site had
 * hours contradicting themselves on the same page, another rendered them
 * only in JS, a third had none at all. Believing a scraper here means
 * confidently telling someone a closed restaurant is open.
 *
 * So this collects evidence and ranks how far it can be trusted:
 *   - schema.org JSON-LD `openingHours` / `openingHoursSpecification` is
 *     machine-authored — high confidence.
 *   - visible day/time text is a hint to be read before it goes anywhere
 *     near the app, and pages stating two different schedules are flagged
 *     rather than resolved.
 *
 * Output is JSONL for review, never a patch to the dataset. Curated
 * answers are written by hand into data/hours-overlay.json.
 *
 *   node scripts/fetch-hours-candidates.mjs [--groups food,coffee,hotel,other]
 *                                           [--limit N] [--out FILE] [--render]
 *
 * --render adds a headless-Chrome pass for pages whose hours are painted by
 * JavaScript (chain store locators, mostly). Much slower; worth it only for
 * the ones a plain fetch came back empty on.
 */
import { readFileSync, writeFileSync } from "node:fs";

const DATA = "public/data/skymap-data.json";
const args = process.argv.slice(2);
const val = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : dflt;
};
const GROUPS = val("--groups", "food,coffee,hotel,other").split(",");
const LIMIT = Number(val("--limit", "1000"));
const OUT = val("--out", "/tmp/skymap-hours-candidates.jsonl");
const RENDER = args.includes("--render");
const CONCURRENCY = RENDER ? 3 : 8;

// A default Node user-agent gets 403'd by several chain sites; this is a
// plain browser string, and requests stay at ordinary browsing rates.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const data = JSON.parse(readFileSync(DATA, "utf8"));
const targets = data.pois
  .filter((p) => GROUPS.includes(p.group) && !p.openingHours && p.website)
  .slice(0, LIMIT);

console.error(`${targets.length} POIs in [${GROUPS}] with a website and no hours${RENDER ? " (rendering)" : ""}`);

const DAYS = "(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*";
const TIME = "\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)";
const TEXT_HOURS = new RegExp(`(${DAYS}[^.<>\\n]{0,40}?${TIME}\\s*(?:-|–|—|to)\\s*${TIME})`, "gi");

function jsonLdHours(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue; // malformed JSON-LD is common; it's a hint source, not a contract
    }
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (node.openingHours) out.push(...[].concat(node.openingHours));
      if (node.openingHoursSpecification) {
        for (const s of [].concat(node.openingHoursSpecification)) {
          const days = [].concat(s.dayOfWeek ?? []).map((d) => String(d).split("/").pop());
          if (days.length && s.opens && s.closes) out.push(`${days.join(",")} ${s.opens}-${s.closes}`);
        }
      }
      Object.values(node).forEach(walk);
    };
    walk(parsed);
  }
  return [...new Set(out.filter((s) => String(s).trim()))];
}

function readable(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ");
}

function grade(row) {
  row.jsonLd = row.jsonLd ?? [];
  row.textHints = row.textHints ?? [];
  const distinct = new Set(row.textHints.map((h) => h.toLowerCase().replace(/\s+/g, " ")));
  // The failure that sank the previous attempt: one page, two schedules.
  row.conflicting = distinct.size > 1;
  row.confidence = row.jsonLd.length ? "high" : row.textHints.length ? "needs-reading" : "none";
  return row;
}

async function plainFetch(poi, row) {
  const res = await fetch(poi.website, {
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
  });
  row.status = res.status;
  if (!res.ok) return null;
  return await res.text();
}

let browser = null;
async function renderFetch(poi) {
  if (!browser) {
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ channel: "chrome" });
  }
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  try {
    await page.goto(poi.website, { waitUntil: "networkidle", timeout: 30000 });
    return await page.content();
  } finally {
    await ctx.close();
  }
}

async function inspect(poi) {
  const row = { id: poi.id, name: poi.name, group: poi.group, website: poi.website };
  try {
    let html = await plainFetch(poi, row);
    if (html) {
      row.jsonLd = jsonLdHours(html);
      row.textHints = [...new Set([...readable(html).matchAll(TEXT_HOURS)].map((m) => m[1].trim()))].slice(0, 8);
    }
    // Only pay for a browser when the cheap path found nothing.
    if (RENDER && !row.jsonLd?.length && !row.textHints?.length) {
      html = await renderFetch(poi);
      row.rendered = true;
      row.jsonLd = jsonLdHours(html);
      row.textHints = [...new Set([...readable(html).matchAll(TEXT_HOURS)].map((m) => m[1].trim()))].slice(0, 8);
    }
    return grade(row);
  } catch (e) {
    row.error = `${e.name}: ${e.message}`.slice(0, 90);
    row.confidence = "error";
    return row;
  }
}

const results = [];
let cursor = 0;
async function worker() {
  while (cursor < targets.length) {
    const poi = targets[cursor++];
    results.push(await inspect(poi));
    process.stderr.write(`\r${results.length}/${targets.length}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
process.stderr.write("\n");
if (browser) await browser.close();

writeFileSync(OUT, results.map((r) => JSON.stringify(r)).join("\n") + "\n");
const by = (c) => results.filter((r) => r.confidence === c).length;
console.error(
  `high=${by("high")} needs-reading=${by("needs-reading")} none=${by("none")} ` +
    `error=${by("error")} conflicting=${results.filter((r) => r.conflicting).length}`,
);
console.error(`wrote ${OUT}`);
