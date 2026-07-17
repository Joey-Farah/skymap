/* Skymap service worker: precached app shell + data, network-first tiles.
 *
 * CACHE_VERSION and PRECACHE are placeholders — scripts/build-sw.mjs
 * rewrites this file after `vite build`, injecting the real hashed asset
 * list (index-XXXX.js/css, all logos, the data file, icons) and a cache
 * name derived from a hash of that list, so every deploy with different
 * content gets a fresh cache and cleanly evicts the old one. A raw copy of
 * this file (e.g. running straight off public/ in dev) is still valid JS —
 * it just precaches nothing and behaves as network-first everywhere, since
 * SW registration itself is gated off in dev (see src/main.ts).
 */
const CACHE_VERSION_RAW = "__CACHE_VERSION__";
const PRECACHE_RAW = "__PRECACHE_MANIFEST__";
const CACHE = "skymap-" + (CACHE_VERSION_RAW.startsWith("__") ? "dev" : CACHE_VERSION_RAW);
const PRECACHE = PRECACHE_RAW.startsWith("__") ? { core: [], extra: [] } : JSON.parse(PRECACHE_RAW);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // Core files (app shell HTML, manifest, the JS/CSS bundle, the data
      // file) are required: if even one can't be fetched, throw so the
      // whole install fails. A failed install is discarded by the browser
      // and retried automatically on the next page load — silently
      // "succeeding" with an empty or partial cache would instead leave a
      // permanently broken offline mode with no visible error and no
      // built-in retry, since an unchanged sw.js byte-for-byte never
      // re-triggers the install event on its own.
      await Promise.all(
        PRECACHE.core.map((url) =>
          fetch(url, { cache: "reload" }).then((res) => {
            if (!res.ok) throw new Error(`core precache failed: ${url} (${res.status})`);
            return cache.put(url, res);
          }),
        ),
      );
      // Everything else (logos, splash images, alt icon sizes) is
      // best-effort: losing one shouldn't sink an otherwise-good install,
      // since the fetch handler's stale-while-revalidate catches misses on
      // first use anyway.
      await Promise.allSettled(
        PRECACHE.extra.map((url) =>
          fetch(url, { cache: "reload" }).then((res) => (res.ok ? cache.put(url, res) : undefined)),
        ),
      );
      self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;

  // Basemap tiles/styles: network first, no caching (respect tile provider).
  if (url.origin !== self.location.origin) return;

  // Same-origin: stale-while-revalidate.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fresh = fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
