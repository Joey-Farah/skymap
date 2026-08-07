/** Dump a rendered page's links, optionally filtered, so a store-detail
 * URL can be found when clicking lands on nav or footer chrome. */
import { chromium } from "playwright-core";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const [url, pattern = "."] = process.argv.slice(2);
const rx = new RegExp(pattern, "i");
const b = await chromium.launch({ channel: "chrome" });
const c = await b.newContext({ userAgent: UA });
const p = await c.newPage();
await p.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 });
await p.waitForTimeout(12000);
try { await p.getByRole("button", { name: /accept|agree|allow/i }).first().click({ timeout: 3000 }); await p.waitForTimeout(1500); } catch {}
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await p.waitForTimeout(2000);
const links = await p.evaluate(() => [...document.querySelectorAll("a")].map((a) => [a.innerText.replace(/\s+/g, " ").trim(), a.href]));
const seen = new Set();
for (const [t, h] of links) {
  if (!rx.test(t) && !rx.test(h)) continue;
  if (seen.has(h)) continue;
  seen.add(h);
  console.log(`${(t || "(no text)").slice(0, 45).padEnd(47)} ${h.slice(0, 95)}`);
}
await b.close();
