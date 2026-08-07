/**
 * Gather *candidate* opening hours for POIs that have none.
 *
 * Deliberately does NOT decide anything. A previous attempt at automated
 * hours extraction was rejected for good reason: one sampled site had hours
 * contradicting themselves on the same page, another rendered them in JS,
 * a third had none at all. Believing a scraper here means confidently
 * telling someone a closed restaurant is open.
 *
 * So this collects evidence and ranks how much it can be trusted:
 *   - schema.org JSON-LD `openingHours` / `openingHoursSpecification`
 *     is machine-authored and high confidence.
 *   - visible day/time text is a hint, to be read by a human (or an agent
 *     that actually reads the page) before it goes anywhere near the app.
 *
 * Output is JSONL for review, never a patch to the dataset.
 *
 *   node scripts/fetch-hours-candidates.mjs [--limit N] [--out FILE]
 */
import { readFileSync, writeFileSync } from "node:fs";

const DATA = "public/data/skymap-data.json";
const args = process.argv.slice(2);
const val = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : dflt;
};
const LIMIT = Number(val("--limit", "500"));
const OUT = val("--out", "/tmp/skymap-hours-candidates.jsonl");
const CONCURRENCY = 6;

const data = JSON.parse(readFileSync(DATA, "utf8"));
const targets = data.pois
  .filter((p) => ["food", "coffee"].includes(p.group) && !p.openingHours && p.website)
  .slice(0, LIMIT);

console.error(`${targets.length} POIs with a website and no hours`);

const DAYS = "(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*";
const TIME = "\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)";
const TEXT_HOURS = new RegExp(`(${DAYS}[^.<>\\n]{0,40}?${TIME}\\s*(?:-|–|—|to)\\s*${TIME})`, "gi");

function jsonLdHours(html) {
  const out = [];
  const blocks = html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of blocks) {
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
  return [...new Set(out)];
}

async function inspect(poi) {
  const row = { id: poi.id, name: poi.name, website: poi.website };
  try {
    const res = await fetch(poi.website, {
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; SkyMapHoursCheck/1.0)" },
    });
    row.status = res.status;
    if (!res.ok) return row;
    const html = await res.text();
    row.jsonLd = jsonLdHours(html);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ");
    row.textHints = [...new Set([...text.matchAll(TEXT_HOURS)].map((m) => m[1].trim()))].slice(0, 8);
    // The failure mode that sank the last attempt: a page stating two
    // different schedules. Flag it rather than picking one.
    row.conflicting = row.textHints.length > 1 && new Set(row.textHints.map((h) => h.toLowerCase())).size > 1;
    row.confidence = row.jsonLd.length ? "high" : row.textHints.length ? "needs-reading" : "none";
  } catch (e) {
    row.error = `${e.name}: ${e.message}`.slice(0, 90);
    row.confidence = "error";
  }
  return row;
}

const results = [];
let cursor = 0;
async function worker() {
  while (cursor < targets.length) {
    const poi = targets[cursor++];
    const row = await inspect(poi);
    results.push(row);
    process.stderr.write(`\r${results.length}/${targets.length}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
process.stderr.write("\n");

writeFileSync(OUT, results.map((r) => JSON.stringify(r)).join("\n") + "\n");
const by = (c) => results.filter((r) => r.confidence === c).length;
console.error(
  `high=${by("high")}  needs-reading=${by("needs-reading")}  none=${by("none")}  error=${by("error")}` +
    `  conflicting=${results.filter((r) => r.conflicting).length}`,
);
console.error(`wrote ${OUT}`);
