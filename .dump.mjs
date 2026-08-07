import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome" });
const p = await (await b.newContext({ userAgent:"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", viewport:{width:1200,height:1200} })).newPage();
await p.goto(process.argv[2], { waitUntil:"networkidle", timeout:35000 }).catch(()=>{});
await p.waitForTimeout(6000);
const txt = (await p.innerText("body")).replace(/\s+/g," ");
console.log("VISIBLE:", txt.slice(0,700));
await b.close();
