# Places in the skyway that SkyMap never had

Planned and implemented 2026-08-23, from a reader report. Shipping in 1.8.

**Outcome vs. plan.** The plan assumed this was a data-gathering problem — go find the
missing places, one building at a time, possibly against a licensed directory. It wasn't.
147 of the 171 missing records were *already in our Overpass response*; we downloaded them
and only ever read half their tags. The licensing question the plan spent a step on turned
out to be moot, and the hand-research step shrank from ~60 buildings to 7 confirmed
entries.

Two things the plan didn't foresee, both found by re-checking rather than by building:

- **Half the "known-bad" POIs were fine.** A 2026-08-07 pass had listed eight records as
  closed, mislocated or duplicated. Re-verifying on the day of the fix overturned four of
  them, including two businesses that are open and would have been deleted.
- **The duplicate belonged in code, not in an exception list.** Jack Link's was in the
  dataset twice because `dedupePois` keyed identity on the raw name and one record spells
  it with an apostrophe. Hand-removing the second record would have left the next
  extraction free to recreate it.

## Context

A reader reported a **Spyhouse Coffee in the lobby of a Marriott** that SkyMap doesn't
show. The report was correct, and — like the Marriott report before it — the half that was
correct exposed something systemic.

The hotel is the **Emery, Autograph Collection** (an Autograph Collection hotel is a
Marriott brand), `emery-autograph-collection-62006964`, and it was already in the dataset,
on the network, with skyway-specific hours. We even had **Giulia**, the restaurant in the
same lobby. We just didn't have Spyhouse.

## The systemic bug

`scripts/fetch-osm.mjs` asked Overpass for POIs as `node[...]` only.

OpenStreetMap maps a place either as a node inside a footprint or as tags on the footprint
itself, and which one you get is an accident of who mapped it. A way carrying both
`building` and `amenity` was read as a building and never as a business. The result:

- **27 food and drink venues** invisible — Murray's, Cowboy Jack's, Monte Carlo, Gluek's,
  J.D. Hoyt's, Graze Food Hall and more. Several of them appeared in the dataset as
  *buildings named after the restaurant* with nothing inside them, which is why a
  foodless-building sweep found them so quickly.
- **112 non-food records** invisible — theatres, museums, clinics, shops, hotels.

`venuePoiFromBuilding` (`src/poi.ts`) is the other half of that read, and the query gained
way/relation variants with `out center` for the 24 places mapped as an outline that isn't
a building.

### Three traps in the fix

- **`out center` re-emits a geometry-free copy** of any way an earlier `out body` already
  returned. Letting that copy win strips a building of the ring its footprint is built
  from. Only a copy carrying `nodes` may replace what's indexed.
- **`groupFor` answered "landmark" before it tested food.** A building reaching it as
  `kind: "building"` with `category: "restaurant"` filed a steakhouse under Landmarks,
  where nobody hunting dinner taps. Food and coffee now win over that rule, exactly as
  lodging already did and for the same reason.
- **A single-tenant building names its venue what it names itself.** Emitting an ordinary
  POI there puts two identical rows in search — the duplication the previous release
  removed for marked buildings. Those become the building's own marker carrying the
  *venue's* category instead, so Murray's is one record, opens a building card, and sits
  under the Food chip.

The marked-building work from earlier in 1.8 is untouched: `fetch-osm.mjs` suppresses a
building's marker when a POI of the same name exists, so a naive version of this change
would have silently un-marked hotels. `venuePoiFromBuilding` returns `null` for every
category in `MARKED_BUILDING_CATEGORIES`. Verified by diff — no marker lost, 25 gained.

## What OSM doesn't have

Spyhouse is absent from OpenStreetMap entirely, so none of the above reaches it. That is a
second, separate problem behind the same report.

`data/poi-overlay.json` + `scripts/apply-poi-overlay.mjs` carry it, and six more places
verified the same way. Kept apart from `hours-overlay.json` deliberately: that file answers
*when is this open*, this one answers *does this exist*. Grafting both into one artefact
would have made neither reviewable.

Rules the overlay enforces on itself:

- **Two independent sources** per entry, operator wins on conflict. The Emery's own page
  claimed Spyhouse runs 6:30–5 daily; Spyhouse publishes 6:30–7 Wed–Sun.
- **Hours that don't parse are refused**, not shipped. Aurora runs three services a day
  and the app renders one interval per day, so the only recordable form —
  `06:30–23:00` — claims it's open across two gaps it's closed. An unparseable string
  renders identically to having curated nothing, so it would sit in the file looking done
  while doing nothing.
- **Unconfirmed places are recorded, not shipped.** Broadway Pizza, JR Thai Food and Los
  Ocampos Express are named by the Meet Minneapolis skyway guide but were not confirmed at
  a second source.
- **A removal needs re-verification on the day it lands.** Removing a real place is worse
  than showing a dead one: a wrong removal is invisible, while a dead pin gets reported.

## Extraction wipes the overlays

`npm run data:osm -- --apply` rewrites `public/data/skymap-data.json` wholesale. It
silently dropped the entire curated hours overlay midway through this branch, and the only
reason it was caught is that a router test asserts a retracted building's hours are really
gone.

`npm run data:refresh` now runs extraction and both overlays in the right order. Use it.

## Numbers

| | before | after |
|---|---|---|
| POIs | 730 | 836 |
| Buildings with a pin | 20 | 45 |
| Food POIs | — | 212 |
| Coffee POIs | — | 40 |
| Food/coffee hours coverage | 171/227 | 186/252 |

Removed: The Seville (closed March 2026) and Midwest Motorcycle. Collapsed: one Jack
Link's duplicate. The diff against the previous dataset is exactly those three records —
the dedupe change collapses nothing else.
