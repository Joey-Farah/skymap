import { chromium } from "playwright-core";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const targets = JSON.parse(process.argv[2]);
const b = await chromium.launch({ channel: "chrome" });
for (const [n, u] of targets) {
  const c = await b.newContext({ userAgent: UA });
  const p = await c.newPage();
  try {
    await p.goto(u, { waitUntil: "domcontentloaded", timeout: 35000 });
    await p.waitForTimeout(12000);
    try { await p.getByRole("button", { name: /accept|agree|allow/i }).first().click({ timeout: 3000 }); await p.waitForTimeout(1500); } catch {}
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(2000);
    const t = (await p.innerText("body")).replace(/\s+/g, " ");
    const i = t.search(/monday|hours|mon\b[^a-z]/i);
    console.log(`\n=== ${n} [${t.length}] ${p.url().slice(0, 60)}`);
    console.log(i >= 0 ? t.slice(Math.max(0, i - 180), i + 450) : "(NO hours token) " + t.slice(0, 220));
  } catch (e) { console.log(`\n=== ${n} ERR ${e.name}: ${String(e.message).slice(0, 70)}`); }
  await c.close();
}
await b.close();
