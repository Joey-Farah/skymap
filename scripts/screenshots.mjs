/**
 * App Store screenshot capture.
 *
 * Apple wants 1284x2778 for the 6.5"/6.7" iPhone class. A macOS screenshot
 * of a browser window gives you physical screen pixels instead, which is
 * how the last manual attempt came out at 646x1396 — right shape, half the
 * resolution. Rendering headless at a 428x926 viewport with
 * deviceScaleFactor 3 lands exactly on spec with no resizing pass.
 *
 * Two things the previous ad-hoc capture learned the hard way and this
 * bakes in: grant a geolocation fix (without one, a "Location is off"
 * banner sits across the map), and drive the UI through window.__skymap
 * rather than clicking, so a state is reached deterministically.
 *
 * Usage:  npm run dev            (server on :5180)
 *         node scripts/screenshots.mjs [--light] [--out DIR] [--url URL]
 */
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const URL_BASE = value("--url", "http://localhost:5180");
const OUT = value("--out", "appstore-assets/screenshots");
const COLOR = flag("--light") ? "light" : "dark";

// Six Quebec — central, well connected, and the origin used for the route
// and navigation shots so all five read as one continuous story.
const ORIGIN = { id: "six-quebec-156912888", lat: 44.97687, lon: -93.27006 };
const DEST = { id: "forum-28525210" };
// Skyway level, open early, and it has a logo — so the card renders full
// rather than demonstrating the empty state.
const CARD = { building: "sps-tower-45447294", poi: "poi-12768888510" };

const shots = [
  {
    name: "1-idle-map",
    async run(page) {
      await page.evaluate(() => window.__skymap.modes.enterIdle());
      await page.evaluate(([lat, lon]) => {
        window.__skymap.view.map.easeTo({ center: [lon, lat], zoom: 15.4, duration: 0 });
      }, [ORIGIN.lat, ORIGIN.lon]);
    },
  },
  {
    name: "2-search",
    async run(page) {
      await page.evaluate(() => window.__skymap.modes.enterIdle());
      await page.click("#input-search");
      await page.fill("#input-search", "coffee");
      await page.waitForTimeout(400);
    },
  },
  {
    name: "3-place-card",
    async run(page) {
      await page.evaluate(({ building, poi }) => {
        const s = window.__skymap;
        const b = s.router.building(building);
        const p = s.data.pois.find((x) => x.id === poi);
        s.modes.showPlace(b, p);
      }, CARD);
    },
  },
  {
    name: "4-route-preview",
    async run(page) {
      await page.evaluate(({ origin, dest }) => {
        const s = window.__skymap;
        s.modes.showPlace(s.router.building(dest));
        s.modes.enterPreview();
      }, { origin: ORIGIN.id, dest: DEST.id });
      await page.waitForTimeout(900);
    },
  },
  {
    name: "5-navigation",
    async run(page) {
      await page.evaluate(({ dest }) => {
        const s = window.__skymap;
        s.modes.showPlace(s.router.building(dest));
        s.modes.enterPreview();
      }, { dest: DEST.id });
      await page.waitForTimeout(700);
      await page.evaluate(() => window.__skymap.modes.enterNav());
      await page.waitForTimeout(900);
    },
  },
];

// Drive the system Chrome rather than a Playwright-managed build: this repo
// pins playwright-core only, so the cached browser revision drifts out of
// step with it and launching fails with "Executable doesn't exist". Chrome
// is already on the machine and renders identically for this purpose.
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 428, height: 926 },
  deviceScaleFactor: 3, // 428*3 x 926*3 = 1284 x 2778, exactly Apple's spec
  isMobile: true,
  hasTouch: true,
  colorScheme: COLOR,
  permissions: ["geolocation"],
  geolocation: { latitude: ORIGIN.lat, longitude: ORIGIN.lon, accuracy: 12 },
  locale: "en-US",
});

const page = await context.newPage();
page.on("pageerror", (e) => console.error("  page error:", e.message));

await page.goto(URL_BASE, { waitUntil: "networkidle" });
// The debug handle only exists once boot() finishes, so it doubles as the
// signal that data is loaded and the map exists.
await page.waitForFunction(() => window.__skymap?.view?.map, null, { timeout: 30_000 });
await page.waitForFunction(() => window.__skymap.view.map.isStyleLoaded(), null, { timeout: 30_000 });
await page.waitForTimeout(1200); // tiles and icons

/** Each shot has to start from a clean slate. Without this the search
 * dropdown opened for shot 2 was still hanging over the map in shot 3 —
 * the sheet changes with the mode, but the top search bar doesn't. */
async function reset(page) {
  await page.evaluate(() => {
    const input = document.getElementById("input-search");
    if (input) {
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.blur();
    }
    window.__skymap.modes.enterIdle();
  });
  await page.mouse.click(214, 500); // dismiss any list still holding focus
  await page.waitForTimeout(350);
}

await mkdir(OUT, { recursive: true });
for (const shot of shots) {
  await reset(page);
  await shot.run(page);
  // Let the map settle: tiles for a moved camera, and the sheet's own
  // entrance animation, which is mid-flight right after a mode change.
  await page.waitForTimeout(1400);
  const file = path.join(OUT, `${shot.name}.png`);
  await page.screenshot({ path: file });
  console.log(`  ${shot.name}.png`);
}

await browser.close();
console.log(`\n${shots.length} screenshots → ${OUT} (1284x2778, ${COLOR})`);
