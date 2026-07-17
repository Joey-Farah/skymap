/* Skymap service worker: precached app shell + data, network-first tiles.
 *
 * CACHE_VERSION and PRECACHE are placeholders — scripts/build-sw.mjs
 * rewrites this file after `vite build`, injecting the real hashed asset
 * list (index-XXXX.js/css, all logos, the data file, icons) and a cache
 * name derived from a hash of that list, so every deploy with different
 * content gets a fresh cache and cleanly evicts the old one. A raw copy
 * of this file (e.g. running straight off public/ in dev) still works —
 * it just precaches nothing and falls back to network-first everywhere.
 */
const CACHE = "skymap-__CACHE_VERSION__";
const PRECACHE = __PRECACHE_MANIFEST__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Individual puts, not cache.addAll: addAll is all-or-nothing, so one
      // flaky asset fetch would fail the entire SW install and leave the
      // app with no offline support at all. A partial precache still beats
      // none — anything missed here gets caught by the fetch handler's
      // stale-while-revalidate on first use.
      Promise.allSettled(
        PRECACHE.map((url) =>
          fetch(url, { cache: "reload" }).then((res) => (res.ok ? cache.put(url, res) : undefined)),
        ),
      ).then(() => self.skipWaiting()),
    ),
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
