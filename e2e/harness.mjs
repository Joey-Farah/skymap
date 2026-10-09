/**
 * End-to-end harness: drives the real app headless, through the same
 * `window.__skymap` handle the screenshot script uses (src/main.ts, bottom).
 * `npm run e2e` starts the dev server and sets E2E_BASE; see e2e/run.mjs.
 *
 * Grown out of the 2026-10-08 overnight QA run, where every repro needed the
 * same stubs and nobody should have to remember them again.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASE = process.env.E2E_BASE ?? "http://localhost:5180";

/** Six Quebec: central and well connected — the default "you are here". */
export const SIX_QUEBEC = { latitude: 44.97687, longitude: -93.27006, accuracy: 12 };

/**
 * A browser on the app, with the stubs every test needs.
 *
 * - POST /api/feedback is answered locally. In dev there is no API, and a
 *   failed send falls back to a mailto: navigation, which system Chrome hands
 *   to macOS even headless — it has opened a real Mail window on the
 *   developer's machine. Never make this POST fail in a test.
 * - Clicks on mailto:/tel:/sms: links and window.open() to them are swallowed
 *   and recorded in window.__blockedExternal instead.
 * - The clock is America/Chicago, the only place the app is used.
 *
 * @param {object} o
 * @param {{latitude:number, longitude:number, accuracy?:number}|null|"manual"} [o.geolocation]
 *   a fix with permission granted (default: Six Quebec); null = permission
 *   denied; "manual" = granted, with fixes and errors fed by the test through
 *   window.__testGeo.fix(lat, lon, accuracy) / .error(code) / .watches, and
 *   .permission ("granted" | "denied" | "prompt") for what a re-check reports
 * @param {string} [o.clockAt] ISO time to start the page clock at (time then flows)
 * @param {{width:number,height:number}} [o.viewport] default 390x844
 * @param {"light"|"dark"} [o.colorScheme]
 * @param {boolean} [o.offline]
 */
export async function launch(o = {}) {
  // System Chrome, not a Playwright-managed build: this repo pins
  // playwright-core only (see scripts/screenshots.mjs).
  const browser = await chromium.launch({ channel: "chrome" });
  const manualGeo = o.geolocation === "manual";
  const geo = manualGeo ? null : o.geolocation === undefined ? SIX_QUEBEC : o.geolocation;
  const context = await browser.newContext({
    viewport: o.viewport ?? { width: 390, height: 844 },
    deviceScaleFactor: o.deviceScaleFactor ?? 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: o.colorScheme ?? "light",
    timezoneId: "America/Chicago",
    locale: "en-US",
    permissions: geo ? ["geolocation"] : [],
    geolocation: geo ?? undefined,
    offline: !!o.offline,
  });
  const feedbackPosts = [];
  await context.route("**/api/feedback**", async (route) => {
    feedbackPosts.push(route.request().postData());
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  await context.addInitScript(() => {
    const external = /^(mailto|tel|sms):/i;
    window.__blockedExternal = [];
    document.addEventListener(
      "click",
      (e) => {
        const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
        if (a && external.test(a.getAttribute("href") ?? "")) {
          e.preventDefault();
          window.__blockedExternal.push(a.getAttribute("href"));
        }
      },
      true,
    );
    const open = window.open;
    window.open = (url, ...rest) => {
      if (external.test(String(url ?? ""))) {
        window.__blockedExternal.push(String(url));
        return null;
      }
      return open.call(window, url, ...rest);
    };
  });
  if (manualGeo) {
    // navigator.geolocation replaced by a fake the test drives. Nothing
    // arrives until the test says so, which is how "granted but no fix yet",
    // a late fix, a lost fix or a mid-trip denial reach MapLibre's own
    // success and error paths.
    await context.addInitScript(() => {
      const watches = new Map();
      let nextId = 1;
      const mkErr = (code) => ({ code, message: `test error ${code}`, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      const fake = {
        getCurrentPosition() {},
        watchPosition(ok, err) {
          const id = nextId++;
          watches.set(id, { ok, err });
          return id;
        },
        clearWatch(id) {
          watches.delete(id);
        },
      };
      Object.defineProperty(navigator, "geolocation", { value: fake, configurable: true });
      // MapLibre checks permissions before enabling its button; the test can
      // change the answer (window.__testGeo.permission) to model Settings.
      const q = navigator.permissions?.query?.bind(navigator.permissions);
      if (q) navigator.permissions.query = (d) => (d?.name === "geolocation" ? Promise.resolve({ state: window.__testGeo.permission, onchange: null }) : q(d));
      window.__testGeo = {
        permission: "granted",
        get watches() {
          return watches.size;
        },
        fix(lat, lon, accuracy = 12) {
          const pos = { timestamp: Date.now(), coords: { latitude: lat, longitude: lon, accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null } };
          for (const w of [...watches.values()]) w.ok(pos);
        },
        error(code) {
          for (const w of [...watches.values()]) w.err?.(mkErr(code));
        },
      };
    });
  }
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  if (o.clockAt) {
    await page.clock.install({ time: new Date(o.clockAt) });
    await page.clock.resume();
  }
  return { browser, context, page, feedbackPosts, pageErrors };
}

/** Load the app (optionally at a path like "/?from=a&to=b") and wait until
 * the map, data and debug handle are all ready. */
export async function openApp(page, urlPath = "/") {
  await page.goto(BASE + urlPath, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__skymap?.view?.map?.isStyleLoaded?.(), null, { timeout: 45_000 });
  await page.waitForTimeout(500);
}

/** Open a route preview with From picked by name, then press GO. Returns
 * false if the app didn't reach navigation (no route, same building, ...). */
export async function startTrip(page, fromId, toId) {
  await openApp(page, `/?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`);
  return page.evaluate(() => {
    const s = window.__skymap;
    if (s.modes.current !== "preview") return false;
    s.modes.enterNav();
    return s.modes.current === "nav";
  });
}

/** The drawn line of the active route: coords, where each step starts (m),
 * and total length (m). These are TS-private on the view but readable. */
export async function activeLine(page) {
  return page.evaluate(() => {
    const v = window.__skymap.view;
    return { coords: v.activeRouteCoords, stepStarts: v.activeStepStarts, total: v.activeLineMeters };
  });
}

/**
 * Walk the active route by feeding GPS fixes straight into the app's
 * position handler, with Date.now faked so a 15-minute walk replays in
 * seconds. Requires navigation mode (startTrip first).
 *
 * Drift is a slowly wandering bias (Ornstein-Uhlenbeck, sigma per axis in
 * metres, 30 s correlation) plus 5 m jitter — a guess at indoor GPS, not a
 * calibrated model. drift 0 = a perfect walk.
 *
 * Returns one sample per fix: metres truly walked, where the app put the
 * dot (alongMeters), offRoute, and the banner text at that moment. With
 * `detail`, also the sheet's marked step row, done count, clock and
 * remaining text.
 */
export async function walkRoute(page, { drift = 0, speed = 1.3, dtMs = 1000, seed = 1, fromMeters = 0, toMeters = null, standStillS = 0, detail = false } = {}) {
  return page.evaluate(
    async ({ drift, speed, dtMs, seed, fromMeters, toMeters, standStillS, detail }) => {
      const s = window.__skymap;
      const v = s.view;
      if (!v.__testTrackPatched) {
        const tp = v.trackPosition.bind(v);
        v.trackPosition = (a, b, c) => (v.__testLastPlaced = tp(a, b, c));
        v.__testTrackPatched = true;
      }
      const coords = v.activeRouteCoords;
      const total = v.activeLineMeters;
      const end = toMeters ?? total;
      const rad = (d) => (d * Math.PI) / 180;
      const R = 6371000;
      const d = (a, b) => Math.hypot(rad(b[0] - a[0]) * Math.cos(rad(a[1])), rad(b[1] - a[1])) * R;
      const cum = [0];
      for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + d(coords[i - 1], coords[i]));
      const at = (m) => {
        for (let i = 1; i < coords.length; i++)
          if (cum[i] >= m) {
            const f = (m - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
            return [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * f, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * f];
          }
        return coords[coords.length - 1];
      };
      let sd = seed >>> 0 || 1;
      const rnd = () => ((sd = (sd * 1103515245 + 12345) % 2147483648) / 2147483648);
      const g = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
      let now = window.__testNow ?? Date.now();
      Date.now = () => now;
      // `new Date()` too, so the app's arrival clock reads walk time rather
      // than the page clock (which only moves in real seconds).
      if (detail && !window.__testDatePatched) {
        const RealDate = Date;
        window.Date = class extends RealDate {
          constructor(...args) {
            super(...(args.length ? args : [Date.now()]));
          }
        };
        window.__testDatePatched = true;
      }
      const a = Math.exp(-dtMs / 1000 / 30);
      const sdev = drift * Math.sqrt(1 - a * a);
      let bx = 0, by = 0;
      const out = [];
      const navDetail = () => {
        const lis = [...document.querySelectorAll(".nav-bar ~ ul.steps li")];
        const bar = document.querySelector(".nav-bar");
        return {
          current: lis.findIndex((li) => li.classList.contains("current")),
          done: lis.filter((li) => li.classList.contains("done")).length,
          clock: bar?.querySelector("strong")?.textContent ?? null,
          remaining: bar?.querySelector(".sub")?.textContent ?? null,
        };
      };
      const t0 = now;
      const fix = (walked) => {
        const truth = at(walked);
        bx = a * bx + sdev * g();
        by = a * by + sdev * g();
        const jitter = drift ? 5 : 0;
        now += dtMs;
        s.onPosition(truth[1] + (by + jitter * g()) / 111320, truth[0] + (bx + jitter * g()) / (111320 * Math.cos(rad(truth[1]))));
        const placed = v.__testLastPlaced;
        out.push({
          t: Math.round((now - t0) / 1000),
          walked: Math.round(walked),
          along: placed ? Math.round(placed.alongMeters) : null,
          offRoute: !!placed?.offRoute,
          banner: document.getElementById("nav-instruction")?.textContent ?? "",
          sub: document.getElementById("nav-instruction-sub")?.textContent ?? "",
          mode: s.modes.current,
          ...(detail ? navDetail() : {}),
        });
      };
      const step = (speed * dtMs) / 1000;
      for (let m = fromMeters; m <= end; m += step) {
        fix(m);
        if (s.modes.current !== "nav") break;
      }
      for (let i = 0; i < (standStillS * 1000) / dtMs && s.modes.current === "nav"; i++) fix(end);
      window.__testNow = now;
      return out;
    },
    { drift, speed, dtMs, seed, fromMeters, toMeters, standStillS, detail },
  );
}

/** Save a screenshot to e2e/.shots/<name>.png (gitignored) for debugging. */
export async function shot(page, name) {
  const dir = path.join(HERE, ".shots");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}
