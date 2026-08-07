/**
 * Pull a full weekly schedule out of a Yext-powered store locator.
 *
 * Chains (Subway and many others) render only a live status — "Closed -
 * Opens at 9:00 AM" — while the whole week sits in an HTML attribute as
 * escaped JSON:
 *
 *   {"day":"THURSDAY","intervals":[{"start":900,"end":1600}]}
 *   {"day":"SATURDAY","intervals":[],"isClosed":true}
 *
 * Reading the rendered text alone concluded these stores published no
 * hours. They publish all of them; they just don't paint them.
 *
 *   node scripts/hours-yext.mjs <url> [<url>...]
 */
import { chromium } from "playwright-core";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const OSM = { MONDAY: "Mo", TUESDAY: "Tu", WEDNESDAY: "We", THURSDAY: "Th", FRIDAY: "Fr", SATURDAY: "Sa", SUNDAY: "Su" };
const ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

const hhmm = (n) => `${String(Math.floor(n / 100)).padStart(2, "0")}:${String(n % 100).padStart(2, "0")}`;

/** Collapse consecutive days sharing a span: Mo,Tu,We 9-16 -> "Mo-We 09:00-16:00". */
function toOsm(byDay) {
  const parts = [];
  let run = null;
  for (const d of ORDER) {
    const span = byDay[d];
    if (run && run.span === span) run.end = d;
    else {
      if (run?.span) parts.push(run);
      run = { start: d, end: d, span };
    }
  }
  if (run?.span) parts.push(run);
  return parts
    .filter((r) => r.span)
    .map((r) => (r.start === r.end ? `${OSM[r.start]} ${r.span}` : `${OSM[r.start]}-${OSM[r.end]} ${r.span}`))
    .join("; ");
}

const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ userAgent: UA });
for (const url of process.argv.slice(2)) {
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(3500);
    const html = (await page.content()).replace(/&quot;/g, '"');
    const days = {};
    for (const m of html.matchAll(/\{"day":"([A-Z]+)","intervals":\[(.*?)\](,"isClosed":(true|false))?\}/g)) {
      const [, day, intervals] = m;
      if (!(day in OSM) || day in days) continue;
      const iv = [...intervals.matchAll(/"end":(\d+),"start":(\d+)|"start":(\d+),"end":(\d+)/g)].map((x) =>
        x[1] !== undefined ? { s: +x[2], e: +x[1] } : { s: +x[3], e: +x[4] },
      );
      // One interval per day is all OSM syntax expresses here; a split day
      // is left blank rather than half-recorded.
      days[day] = iv.length === 1 ? `${hhmm(iv[0].s)}-${hhmm(iv[0].e)}` : null;
    }
    const got = ORDER.some((d) => days[d]);
    console.log(`\n### ${url}`);
    console.log(got ? "   " + toOsm(days) : "   (no Yext hours block found)");
    if (got) console.log("   raw: " + ORDER.map((d) => `${OSM[d]}=${days[d] ?? "closed"}`).join(" "));
  } catch (e) {
    console.log(`\n### ${url}\n   ERR ${e.name}`);
  } finally {
    await page.close();
  }
}
await browser.close();
