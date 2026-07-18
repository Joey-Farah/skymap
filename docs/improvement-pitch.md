# My own pitch: bugs, UX gaps, and debt worth paying down

Written overnight 2026-07-18 — things I noticed building and testing this
that nobody asked me to fix. Ordered by how much I'd push for each.
Nothing here was changed without asking; it's a pitch, not a changelog.

## 1. There's no way to re-center the map on yourself (real regression)

When we removed the map controls tonight, the locate button went with
them. Auto-tracking at launch covers the first minutes — but the moment
you pan away from your blue dot, there is *no affordance anywhere* to get
back to it. Mid-route, three blocks in, that's the single most-wanted
button in any navigation app. The heading-up compass mode (tap locate
twice in Apple Maps) also became unreachable — `locate-mode.ts` and
`compass.ts` are now fully-wired dead code.

**Pitch:** one small floating button, bottom-right above the attribution
mark — the one map control that earns its screen space. Tap: snap back to
your position. Second tap: heading-up mode (the code for the whole cycle
already exists and is tested). This is the first thing a real skyway
walker will miss.

## 2. Sheet heights go stale on rotation

Peek/expanded heights are measured when the sheet opens; rotating the
phone (or iPad split-view resize) doesn't re-measure, so the 60vh cap and
peek height are wrong until the sheet is reopened. One `resize` listener
calling `measureHeights()` fixes it.

## 3. "Current Location" trusts a 60m GPS snap indoors

Origin resolution picks the nearest building within 60m of the GPS fix.
Deep indoors, urban-canyon drift can cross a street — you'd get routed
from the building *next to* the one you're standing in and the route's
step one would immediately look wrong. Ideas, cheapest first: show the
resolved building name under the From field ("Current Location · IDS
Center") so a wrong snap is at least visible; or on tap, offer the 2–3
nearest candidates.

## 4. The trip strip truncates both ends

"Current L… → Minneapolis Cent…" is what you stare at during an entire
walk. Worth a smarter treatment — drop "Current Location" to a dot-icon,
give the destination the full width.

## 5. Release discipline: web and native can drift

PWA users get updates on next visit via the service worker; the native
app ships whatever was in `ios/App/App/public` at archive time. Nothing
enforces they match. A tiny build stamp (git short-hash baked into the
bundle, shown in the feedback email template) would make "which version
are you on?" answerable — cheap now, painful to retrofit after there are
users.

## 6. Bundle size (PWA cold load)

1.07MB JS (287KB gzip), almost all MapLibre. Native doesn't care (local
files); first-visit web users on cell data do. Dynamic-importing MapLibre
after first paint, or accepting it and preloading, is a decision worth
making once rather than by default.

## 7. VoiceOver / accessibility pass

Aria labels exist in most places, but nobody has walked the app with
VoiceOver once. For an app whose strongest near-term feature could be
no-stairs accessible routing (see feature-ideas #1), the app itself
being screen-reader-hostile would undercut the story. One deliberate
pass, fixing focus order and unlabeled buttons, before TestFlight
externals.

## 8. The hours data is honest but under-leveraged

Buildings with guessed hours already say "typical, unverified" — good.
But we never ask anyone to fix them. The feedback mailto could pre-fill
"Are these hours right? Mon–Fri 6am–8pm" when opened from a building
card, turning every curious tester into a data verifier for free.

## Explicitly not pitching

- A backend (see `docs/future-backend-design.md` — still not worth it).
- Ratings/reviews integration (every provider paywalls it; decided
  earlier and still right).
- Multi-city expansion before Minneapolis is polished.
