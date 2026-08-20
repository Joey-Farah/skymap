# On-network hotel & civic buildings aren't marked on the map

Planned 2026-08-20, from a feedback-form report. Not yet implemented — this doc is
the handoff for the session that does it.

## Context

A user filled out the feedback form saying **Minneapolis Marriott City Center is not
marked in the app**. The report is half right, and the half that's right exposes a
systemic bug.

The Marriott *is* in the dataset — `minneapolis-marriott-city-center-27346715`,
30 South 7th Street, `category: "hotel"`, three skyway edges (Royal Sonesta, City
Center, Mayo Clinic Square). It is searchable in the From/To picker and fully
routable.

What it is not, is **marked**. Map pins are drawn only from the POI layer
(`skyway-pois`, `src/map.ts:545`). Buildings render as a polygon plus a name label
that only appears at zoom ≥ 16.4 (`src/map.ts:482`). So when a visitor taps the
**Hotels** chip, 22 hotel pins light up and the Marriott shows nothing. From the
user's side that is indistinguishable from the hotel not existing.

## Root cause

`scripts/fetch-osm.mjs` already has a synthesizer that turns hotel/venue/government
*buildings* into POIs so they get pins. It is guarded by one line:

```js
// scripts/fetch-osm.mjs:852
if (mainComponent.has(b.id)) continue; // already a real network building
```

That block was written to surface buildings the skyway **cannot** reach (US Bank
Stadium and friends), so it deliberately skips anything already on the network. The
side effect is inverted from the user's point of view: **the better connected a hotel
is, the less likely it is to be marked.** The Marriott, with three skyway edges, is
maximally on-network and therefore maximally invisible.

Measured against the committed dataset: **all 14 hotel buildings are on-network, and
0 of them have a pin bearing their own name.** All 22 existing hotel pins are either
real OSM hotel nodes or synthesized *off*-network landmarks. The three that looked
fine only contain a differently-branded hotel's POI — Holiday Inn Express inside
Hotel Ivy, Four Seasons inside RBC Gateway, Hyatt Regency inside Sheraton.

### Intended outcome

Every hotel, hospital and government building on the skyway network gets a pin under
the chip a visitor would use to look for it. 19 new pins.

## Load-bearing premises

Attack these first — the steps below are only as good as these.

1. **A building on the network still needs a pin.** The existing guard assumes
   on-network buildings are adequately represented by their polygon + label. The
   feedback report is direct evidence that they are not, because the label needs
   zoom 16.4 and the chips don't surface buildings at all.
2. **The generator is the right place to fix it, but must not be the only place.**
   `npm run data:osm` hits Overpass live and there is no cached raw response in the
   repo. A full re-fetch would pull in ~2 weeks of unrelated upstream OSM drift and
   conflate it with this fix. So: fix the generator *and* ship a replay script that
   patches the committed dataset in place. This is an established pattern here —
   `scripts/regroup-pois.mjs` exists for exactly this reason.
3. **Name-keyed dedupe makes this safe.** `dedupePois` keys on POI *name*
   (`src/poi.ts:162`), and the synthesized pins carry the building's own name. They
   will not collapse into the differently named hotel POIs already inside those
   buildings, and a building whose name already exists as a POI is skipped (this
   drops Sheraton, leaving 19 not 20).
4. **A building cannot be a wayfinding cue for itself.** `landmarkNear` counts
   `hotel` as a cue group (`src/poi.ts:246`) and picks alphabetically, so a naive
   synthesized pin would let a turn inside the Emery read "past Emery, Autograph
   Collection." Decided: exclude them.
5. **Label suppression is not affected.** `applyLabelSuppression` only hides labels
   under the walker dot and route endpoints, not under POI pins — no interaction.

## Approach

Invert the guard from "skip on-network buildings" to "skip buildings that already
have a pin in their own name", and mark the synthesized records so they can be
excluded as self-cues.

### Slice 1 — RED/GREEN: self-cues are excluded

- Test in `tests/poi.test.mjs`: a POI whose `kind` is `"building"` is not returned by
  `landmarkNear` for its own `buildingId`, while a genuine coffee/food POI in the same
  building still is.
- Implement: add `"building"` to the `kind` values, and have `landmarkNear`
  (`src/poi.ts:237`) filter out `p.kind === "building"`. Note `landmarkNear`'s generic
  constraint currently only requires `name`/`buildingId`/`group` — widen it to carry
  `kind`.
- Update `src/types.ts` `Poi.kind` if it is a union rather than `string`.

### Slice 2 — RED/GREEN: the generator emits pins for on-network buildings

- Test: drive the synthesizer over a small fixture where a hotel building sits on the
  network, and assert a POI is emitted for it with `group: "hotel"` and
  `kind: "building"`.
- Implement in `scripts/fetch-osm.mjs` (the block at ~840–890):
  - Widen `LANDMARK_CATEGORIES` to include `"hospital"` (it already has `venue`,
    `government`, `hotel`).
  - Replace the `mainComponent.has(b.id)` skip with a skip on
    "a POI with this name already exists".
  - For an on-network building, host is the building itself (`buildingId: b.id`,
    its own lat/lon) — the nearest-host search stays for the off-network case only.
  - Emit `kind: "building"` for these; keep `group: groupFor(...)` so the classifier
    stays the single source of truth (do **not** hardcode the group — the comment at
    line 872 records what happened last time someone did).
  - `id`: prefer a new `building-` prefix over reusing `landmark-`, so the two origins
    stay tellable apart in the data.

### Slice 3 — replay onto the committed dataset

- New `scripts/mark-buildings.mjs`, modeled directly on `scripts/regroup-pois.mjs`
  (`[--write]`, reports counts, idempotent, importable from `src/poi.ts`).
- Run it against `public/data/skymap-data.json` to add the 19 pins.
- Re-run `node scripts/apply-hours-overlay.mjs --write` afterwards so the dataset
  stays consistent with the curated hours overlay.
- Refresh the `public/data/skymap-data.osm.json` snapshot the same way, so the
  pre-overlay artifact doesn't silently diverge.

### Slice 4 — dataset invariant test

- In `tests/router.test.mjs` (which already loads the live committed dataset at
  line 553): assert every building whose `category` is in the pin-worthy set has a POI
  bearing its own name. This is the test that would have caught the original report.

## The 19 buildings

**Hotels (13)** → Hotels chip

Minneapolis Marriott City Center · Hotel Ivy · Hilton Minneapolis · Rand Tower ·
Radisson RED · Emery, Autograph Collection · Nicollet Island Inn · Plymouth Building ·
The Westin Minneapolis · Hampton Inn & Suites · Hyatt Centric · RBC Gateway ·
The Royal Sonesta

*(Sheraton Minneapolis Downtown Convention Center skipped — its name already exists
as a POI.)*

**Hospital (4)** → Misc. chip

Orange Building · Purple Building · Red Building · Ambulatory Outpatient Specialty
Center

**Government (2)** → Misc. chip

United States Courthouse and Federal Building · Minneapolis City Hall

## Files

| File | Change |
| --- | --- |
| `src/poi.ts` | `landmarkNear` skips `kind === "building"` |
| `src/types.ts` | `Poi.kind` gains `"building"` if it's a union |
| `scripts/fetch-osm.mjs` | invert the guard (~line 852), widen `LANDMARK_CATEGORIES`, emit `kind: "building"` |
| `scripts/mark-buildings.mjs` | **new** — replay onto the committed dataset |
| `public/data/skymap-data.json` + `.osm.json` | regenerated (+19 POIs) |
| `tests/poi.test.mjs`, `tests/router.test.mjs` | the two tests above |

## Verification

1. `npm test` — new tests green, existing 15 suites still green. Watch
   `router.test.mjs` in particular: it asserts against the live dataset, so the +19
   POIs must not break any routing invariant.
2. `npm run build` — `tsc --noEmit` catches the `kind` union change.
3. `npm run dev`, then **the actual reported flow**: open the app, tap the **Hotels**
   chip, confirm a pin sits on Minneapolis Marriott City Center. Then search
   "Marriott" and confirm the result still routes correctly.
4. Zoom past 16.4 over the Marriott and check the building label and the new pin label
   don't render the name twice — MapLibre collision should drop one. If both survive,
   drop `text-field` from the synthesized pins.
5. Check a route that turns at a hotel still gives a sensible cue (not "past The
   Westin" while inside the Westin).
6. Verify on the iPhone before shipping — `npx cap sync` first, since
   `ios/App/App/public/data/` carries its own copy of the dataset.

## Not in scope

- The Marriott's OSM footprint is a 1,259 m² wedge (31st smallest of 178) beside City
  Center's 194×157 m block — it's a bad polygon, but a separate data-quality fix.
- Sheraton containing a Hyatt Regency POI, and RBC Gateway containing a Four Seasons,
  are existence/accuracy problems that belong with the POI existence-corrections work.
- No new chips. Hospitals and government buildings ride along in Misc., per the
  existing note in `main.ts` about seven pills wrapping onto three lines.
