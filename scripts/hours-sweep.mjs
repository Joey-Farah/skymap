/**
 * Probe every POI that still needs hours, in parallel, and write what each
 * site says to a file for reading in bulk.
 *
 * Doing this four at a time through the chat is the slow part; the fetching
 * is cheap and parallel. This does the gathering in one pass and leaves a
 * digest that can be adjudicated dozens at a time.
 *
 * It concludes nothing — see hours-probe.mjs for why that matters.
 *
 *   node scripts/hours-sweep.mjs out.jsonl [limit]
 */
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";

const OUT = process.argv[2] ?? "/tmp/hours-sweep.jsonl";
const LIMIT = Number(process.argv[3] ?? 400);
const CONC = 6;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const HOURS_LINK = /hour|location|contact|visit|find\s*us/i;
const OSM = { MONDAY: "Mo", TUESDAY: "Tu", WEDNESDAY: "We", THURSDAY: "Th", FRIDAY: "Fr", SATURDAY: "Sa", SUNDAY: "Su" };
const ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const hhmm = (n) => `${String(Math.floor(n / 100)).padStart(2, "0")}:${String(n % 100).padStart(2, "0")}`;

/** The Yext block chains hide a full week in while painting one status line. */
function yext(html) {
  const days = {};
  for (const m of html.matchAll(/\{"day":"([A-Z]+)","intervals":\[(.*?)\](,"isClosed":(true|false))?\}/g)) {
    const [, day, intervals] = m;
    if (!(day in OSM) || day in days) continue;
    const iv = [...intervals.matchAll(/"end":(\d+),"start":(\d+)|"start":(\d+),"end":(\d+)/g)].map((x) =>
      x[1] !== undefined ? { s: +x[2], e: +x[1] } : { s: +x[3], e: +x[4] },
    );
    days[day] = iv.length === 1 ? `${hhmm(iv[0].s)}-${hhmm(iv[0].e)}` : null;
  }
  if (!ORDER.some((d) => days[d])) return null;
  const parts = [];
  let run = null;
  for (const d of ORDER) {
    if (run && run.span === days[d]) run.end = d;
    else { if (run?.span) parts.push(run); run = { start: d, end: d, span: days[d] }; }
  }
  if (run?.span) parts.push(run);
  return parts.map((r) => (r.start === r.end ? `${OSM[r.start]} ${r.span}` : `${OSM[r.start]}-${OSM[r.end]} ${r.span}`)).join("; ");
}

function excerpts(text) {
  const out = [];
  const re = /hours?\b/gi;
  let m;
  while ((m = re.exec(text)) && out.length < 3) {
    out.push(text.slice(Math.max(0, m.index - 50), m.index + 230).replace(/\s+/g, " "));
    re.lastIndex = m.index + 230;
  }
  return out;
}

const ledger = JSON.parse(readFileSync("data/hours-ledger.json", "utf8"));
const overlay = JSON.parse(readFileSync("data/hours-overlay.json", "utf8"));
const targets = Object.entries(ledger.items)
  .filter(([id, v]) => v.kind === "poi" && v.website && !(id in overlay.hours))
  .map(([id, v]) => ({ id, name: v.name, group: v.group, website: v.website }))
  .slice(0, LIMIT);

console.error(`sweeping ${targets.length} sites`);
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 430, height: 900 } });

async function readPage(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 22000 });
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 90)); }
  });
  await page.waitForTimeout(900);
  return { text: (await page.innerText("body")).replace(/\s+/g, " "), html: (await page.content()).replace(/&quot;/g, '"') };
}

const results = [];
let i = 0;
async function worker() {
  while (i < targets.length) {
    const t = targets[i++];
    const page = await ctx.newPage();
    const row = { ...t, yext: null, excerpts: [], from: null, err: null };
    try {
      const home = await readPage(page, t.website);
      row.yext = yext(home.html);
      row.excerpts = excerpts(home.text);
      row.from = t.website;
      if (!row.yext && !row.excerpts.length) {
        const links = await page.$$eval("a", (as) => as.map((a) => ({ t: (a.textContent || "").trim().slice(0, 40), h: a.href })));
        const origin = new URL(t.website).origin;
        const cand = links.find((l) => l.h.startsWith(origin) && HOURS_LINK.test(l.t + " " + l.h) && l.h.replace(/\/$/, "") !== t.website.replace(/\/$/, ""));
        if (cand) {
          const sub = await readPage(page, cand.h);
          row.yext = yext(sub.html);
          row.excerpts = excerpts(sub.text);
          row.from = cand.h;
        }
      }
    } catch (e) { row.err = `${e.name}`; }
    finally { await page.close(); }
    results.push(row);
    process.stderr.write(`\r${results.length}/${targets.length}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
process.stderr.write("\n");
await browser.close();
writeFileSync(OUT, results.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.error(`yext=${results.filter((r) => r.yext).length} excerpts=${results.filter((r) => !r.yext && r.excerpts.length).length} empty=${results.filter((r) => !r.yext && !r.excerpts.length && !r.err).length} err=${results.filter((r) => r.err).length}`);
console.error(`wrote ${OUT}`);
