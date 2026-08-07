// Read Instagram profile bios. A bio is the operator's own words, so it counts
// as first-party — but it must still carry an address we can match, and the
// address check is not optional.
import { chromium } from "playwright-core";
const handles = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome" });
for (const h of handles) {
  const c = await b.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" });
  const p = await c.newPage();
  try {
    const r = await p.goto(`https://www.instagram.com/${h}/`, { waitUntil: "domcontentloaded", timeout: 25000 });
    await p.waitForTimeout(3500);
    const t = (await p.innerText("body")).replace(/\s+/g, " ");
    const cut = t.indexOf("Show more posts");
    const bio = (cut > 0 ? t.slice(0, cut) : t.slice(0, 700)).replace(/^Log In Sign Up /, "");
    console.log(`\n=== @${h} [${r.status()}] ${/Sorry, this page|isn't available/i.test(t) ? "NOT FOUND" : ""}`);
    console.log("   " + bio.slice(0, 420));
  } catch (e) { console.log(`\n=== @${h} ERR ${e.name}`); }
  await c.close();
}
await b.close();
