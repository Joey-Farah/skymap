import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome" });
const ctx = await b.newContext({ userAgent:"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" });
for (const url of process.argv.slice(2)) {
  const p = await ctx.newPage();
  const api = [];
  p.on("response", async r => {
    const ct = r.headers()["content-type"]||"";
    if (!/json/.test(ct)) return;
    try { const t = await r.text();
      if (/\b(hours|openTime|closeTime|dayOfWeek|schedule)\b/i.test(t)) api.push([r.url().slice(0,80), t.slice(0,1500)]);
    } catch {}
  });
  console.log(`\n### ${url}`);
  try {
    await p.goto(url, { waitUntil:"domcontentloaded", timeout:28000 });
    await p.waitForTimeout(6500);
    const html = (await p.content()).replace(/&quot;/g,'"');
    for (const key of ["openIntervals","hoursSet","\"hours\":","storeHours","businessHours","operatingHours"]) {
      const i = html.indexOf(key);
      if (i>=0) { console.log(`  HTML[${key}]: ` + html.slice(i-40, i+320).replace(/\s+/g," ")); break; }
    }
    for (const [u,t] of api.slice(0,2)) {
      const m = t.match(/[^{]{0,40}(?:hours|openTime|dayOfWeek)[\s\S]{0,300}/i);
      console.log(`  API <${u}>`); if (m) console.log("     " + m[0].replace(/\s+/g," ").slice(0,300));
    }
    if (!api.length) console.log("  (no JSON API carried hours)");
  } catch(e){ console.log("  ERR", e.name); }
  finally { await p.close(); }
}
await b.close();
