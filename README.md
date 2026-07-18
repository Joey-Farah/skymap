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
- **What's nearby** — "Show on map" categories (coffee, food, shops,
  restrooms, elevators) in the search sheet; same-name chains rank
  closest-first.
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
178 buildings, 185 skyway connections, 411 businesses/POIs. The script
stitches multipolygon relations, builds the connection graph from the raw
skyway ways (BFS over shared nodes), attaches nearby landmarks (Target
Field, U.S. Bank Stadium…) to their closest connected building, tags edges
with stairs/open-air flags, and pulls landmark photos (with attribution)
from Wikimedia Commons.

```
npm run data:osm    # re-extract from Overpass (writes public/data/)
npm run data:seed   # tiny synthetic dataset for tests/dev
```

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

## Privacy

No accounts, no analytics, no tracking. Location never leaves the device.
See [public/privacy.html](public/privacy.html) (served at `/privacy.html`).

## Docs

- [docs/why-skymap.md](docs/why-skymap.md) — the pitch and the competition
- [docs/app-store-readiness.md](docs/app-store-readiness.md) — App Store path
- [docs/feature-ideas.md](docs/feature-ideas.md) — researched roadmap ideas
- [docs/future-backend-design.md](docs/future-backend-design.md) — if/when a
  server becomes worth it
