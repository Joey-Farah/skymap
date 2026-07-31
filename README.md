# SkyMap

Navigate the Minneapolis Skyway — the largest contiguous system of enclosed
second-floor bridges in the world — without ever stepping outside.

**Live:** https://skymap-alpha.vercel.app (installable as a PWA via Safari's
Add to Home Screen; a native iOS wrapper for App Store distribution lives in
`ios/`).

## What it does

- **Search-first navigation, Apple Maps style** — search a building or a
  business inside one, get a place card, tap Directions. Origin defaults to
  your live location when available.
- **Time-aware routing** — buildings keep real opening hours; the router
  won't send you through a building that's closed when you'd reach it, warns
  when one closes soon, and flags routes with stairs or brief outdoor
  stretches.
- **Live position on the route** — turn-by-turn progress follows your GPS
  fix; tap the route line to correct GPS drift indoors (holds for 45s).
- **What's nearby** — "Show on map" categories (coffee, food, hotels,
  landmarks, shops, restrooms, elevators) in the search sheet; same-name
  chains rank closest-first.
- **Save My Ramp** — noticed near a parking ramp, one tap to save it and one
  tap to route back later.
- **Offline-first PWA** — the service worker precaches the app, the full
  dataset, and business logos; routing works with the network fully dead.

## Stack

Vite + TypeScript + [MapLibre GL](https://maplibre.org/), zero backend.
All data ships as static JSON. Basemap tiles from
[OpenFreeMap](https://openfreemap.org/) (no API key).

## Data

Everything comes from OpenStreetMap, extracted by `scripts/fetch-osm.mjs`:
179 buildings, 186 skyway connections, 678 businesses/POIs. The script
stitches multipolygon relations, builds the connection graph from the raw
skyway ways (BFS over shared nodes), attaches nearby landmarks (Target
Field, U.S. Bank Stadium…) to their closest connected building, tags edges
with stairs/open-air flags, and pulls landmark photos (with attribution)
from Wikimedia Commons.

```
npm run data:osm    # re-extract from Overpass (writes public/data/)
npm run data:seed   # tiny synthetic dataset for tests/dev
```

### Places just outside the network

Not every business sits inside a building the skyway graph captured. Those
resolve to their nearest network building within 120 m and carry
`nearby: true` — searchable and routable, but shown as *"Skyway access via
X"* and listed under *"Just outside"*, never as though they were inside it.
The route line stops at the building; only the pin sits at the real place.

Restrooms and elevators are deliberately excluded from this fallback: an
elevator listed under a building it isn't in is worse than one not listed
at all, because the people filtering for it are usually doing accessible
wayfinding.

## Development

```
npm install
npm run dev         # Vite dev server
npm test            # node --test, no browser needed
npm run build       # typecheck + bundle + service-worker manifest
```

## iOS (App Store)

`ios/App` is a Capacitor wrapper around the same build — see
[docs/app-store-readiness.md](docs/app-store-readiness.md) for the current
path to TestFlight/App Store.

```
npm run build && npx cap sync ios     # refresh native web assets
open ios/App/App.xcodeproj            # build/run from Xcode
```

## Feedback

The Feedback button and each place's "Report an issue" open an in-app form
that posts to `api/feedback.js`, a Vercel Function that mails the report on
via Resend. It needs `RESEND_API_KEY` in the Vercel project environment. Two optional
vars tune it without a deploy: `FEEDBACK_TO` (recipient) and
`FEEDBACK_FROM` (sender, once a domain is verified in Resend).

Note: Resend's shared `onboarding@resend.dev` sender only delivers to the
address the Resend account was registered with. Verifying a domain in
Resend removes that restriction.

Two things to know before changing it:

- **The endpoint must stay plain JavaScript.** `vercel build` fails to
  compile `api/*.ts` against this project's TypeScript, and the symptom in
  production is a 404 on the endpoint and a silent fall back to `mailto:`
  for every user. Run `vercel build` after touching anything in `api/`.
- **Native builds need an absolute URL.** iOS is served from
  `capacitor://localhost`, so a relative path posts into the void. Build
  with:

  ```
  VITE_FEEDBACK_ENDPOINT=https://skymap-alpha.vercel.app/api/feedback npm run build
  ```

  That alias is the project's stable production URL and is publicly
  reachable (the `skymap-<hash>-<org>.vercel.app` form always 302s to SSO —
  it is not a usable endpoint). Without the variable the native app goes
  straight to `mailto:` rather than opening a form it can't submit.

## Privacy

No accounts, no analytics, no tracking. Location never leaves the device.
The one thing that does leave is a feedback report, and only when someone
taps Send — see [public/privacy.html](public/privacy.html) (served at
`/privacy.html`).

## Docs

- [docs/why-skymap.md](docs/why-skymap.md) — the pitch and the competition
- [docs/app-store-readiness.md](docs/app-store-readiness.md) — App Store path
- [docs/feature-ideas.md](docs/feature-ideas.md) — researched roadmap ideas
- [docs/future-backend-design.md](docs/future-backend-design.md) — if/when a
  server becomes worth it
