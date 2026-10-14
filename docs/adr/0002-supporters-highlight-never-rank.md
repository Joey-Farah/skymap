# 2. SkyMap Supporters: a paid highlight that never ranks

2026-10-14 · Accepted

## Context

SkyMap is free, with no account and no tracking, and its marketing says "No
ads" (the printed counter cards can't be changed). Joey wanted income from
the skyway businesses themselves, without anything that feels like an ad to
the people using the app. The design was argued out over 2026-10-11 to
10-14, with research on FTC disclosure guidance, App Review 2.5.18 and 3.1.3,
and what Apple Maps, Google Maps and Waze do. The full record is in
`docs/business-listings-plan.md` and `docs/business-listings-research.md`.

## Decision

- **A supporter gets a highlight, never a rank.** While a Coffee or Food
  chip it's in is on, its pin sits in a pink glow (3× the pin) with a thin
  deep-pink ring. Its card carries a "SkyMap Supporter" tag that, when
  tapped, says plainly that supporters pay, and offers Report this.
- **Paying changes nothing else.** The glow is drawn as circle layers from
  its own source, under the pins. Circles take no part in symbol collision,
  so every pin and name places exactly as it would with nobody paying.
  Search, routing, walk times and cues never read the list:
  `tests/supporters.test.mjs` fails if anything but `main.ts`, `map.ts` or
  `ui.ts` imports `supporters.ts`.
- **The list ships in the app** (`data/supporters.json`), as dated terms. A
  term starts with a release and ends on each phone's own date. The build
  refuses a list that can't ship (`scripts/check-supporters.mjs`): an
  unknown or renamed place, a non-Coffee/Food place, bad dates, more than 3
  Coffee or 8 Food at once, or two in one building and category at once.
- **The glow is off while the place is known to be closed,** from its own
  published hours. The tag stays.
- **Sold outside the app** by invoice. Nothing is payable in or from it.

## Alternatives rejected

- **Label it "Sponsored" or "Featured".** "Sponsored" read like ads to Joey;
  FTC staff called "Featured" ambiguous for paid placement. "SkyMap
  Supporter" plus an explainer that says they pay was chosen instead.
- **A star or badge on the pin.** A five-point star reads as a rating, the
  pattern Korea fined Booking.com for. Five prototype rounds led to the glow.
- **A gold or lime glow.** Gold sat too close to the orange Food pins and the
  orange route. Lime turned the same yellow as Food pins for red-green
  colour-blind users.
- **A bigger or always-named pin.** It would win label collisions and hide
  neighbours' names.
- **A fetched list.** Starts without a release, but it needs a server and
  a network request, against the app's no-backend design.
- **No cap.** It is easier to raise a cap than to lower one, and the glow
  only means something while it's rare.

## Consequences

- The first glow that goes live makes "No ads" untrue in the App Store
  description and the tip-jar text, which then change to "no pop-ups or
  banner ads". The printed cards stay.
- Every start or renewal needs an App Store release. An end never does.
- The list check runs in every `npm run build`, so a refresh of the OSM data
  that renames or drops a supporter's place stops the next release until
  the list is fixed.
