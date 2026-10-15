# 1.8 release status — paused 2026-08-23

Everything is staged. One step remains and it is blocked on something unexplained.

## Where it stands

| | |
|---|---|
| App Store version | 1.8 — `c87bf3a5-951c-4e33-b0a1-fd04bf6b7651` |
| State | `PREPARE_FOR_SUBMISSION` |
| Build | 56 — `4e0be4da-8034-4ea3-9685-8353d788049a`, VALID, attached |
| Built from | `5c4d572` (verified against `origin/main`, not inferred from build number) |
| Release notes | set, 1432 chars, from `appstore-assets/release-notes/1.8.txt` |
| Screenshots | 5, `APP_IPHONE_65`, all `COMPLETE` (carried over from 1.7) |
| en-US localization | `afe2e2bd-1d99-4a8c-acab-6e604a598846` |

Merged: **#17** (20 on-network buildings get pins) and **#18** (the missing-POI work).
Both on `main`. 202 tests pass, `tsc` and `build` clean.

## The blocker

`asc.py submit` returns **409 `STATE_ERROR.ENTITY_STATE_INVALID`**, with associated
errors on `appStoreReviewDetails/e3b0c9ba-7e5d-458b-a0aa-fbe5d49f78fd` naming four
required attributes: `contactFirstName`, `contactLastName`, `contactEmail`,
`contactPhone`.

**What doesn't add up:** those four fields read back `null` on 1.0, 1.6 *and* 1.7 —
all approved releases, and 1.7 was submitted through this same API on 2026-08-20.
So "the API can't set contact details" cannot be the whole story. I could not resolve
this before writes were locked down; treat any explanation below as unverified.

Two hypotheses, neither confirmed:

1. App Store Connect purges review contact details once a version goes live, so the
   history reads null regardless of what was submitted. If true, the values were
   present at 1.7's submit time and something populated them that didn't happen here.
2. The web UI populates the version's review detail from an app-level record the API
   doesn't expose, and 1.7 got populated because the version was opened in a browser
   at some point. 1.8 has only ever been touched through the API.

**Fastest way to settle it:** open App Store Connect → SkyMap → 1.8 → App Review
Information. If the fields are already filled in there, hypothesis 2 is right and the
API path simply never sets them. Submitting from the browser also just finishes the job.

## Cleanup owed

Three empty `reviewSubmissions` in `READY_FOR_REVIEW` with zero items, created by
repeated `asc.py submit` attempts — the command creates the submission record *before*
it validates, so each failed run leaves one behind:

- `db9266fe-bc93-44d5-ad7e-dd770c52f623`
- `1768cdfb-cb13-44e7-bc92-05846d318299`
- `535f98fe-47b6-4671-983e-333dbcf70174`

They hold no items so they should not block a real submission, but they are noise.
Deleting them needs the web UI or a permission this session didn't have.

**Worth fixing in `asc.py`:** `submit` should validate the version *before* creating a
`reviewSubmission`, or delete the record it created when the final PATCH fails.
Otherwise every failed attempt permanently litters the account.

## To finish

```sh
# once App Review Information has contact details
cd ~/.appstoreconnect/tools
./venv/bin/python asc.py submit 6792509326 c87bf3a5-951c-4e33-b0a1-fd04bf6b7651 --confirm
```

## Not done

**No device walk.** `docs/walk-checklist-1.8.md` is the checklist, generated from the
diff. The two sections that matter most:

- **The two removals** — The Seville and Midwest Motorcycle. If either is trading, the
  removal was wrong. A wrong removal is invisible from a desk; a dead pin gets reported.
- **The four kept** — FedEx Office, Dreamgirls, Trax, Laurie Booksellers. A 2026-08-07
  note called these broken; re-checking said otherwise. If the walk shows the old note
  was right, they go into `poi-overlay.json`'s `removed` section.

Build 56 is on TestFlight, so the walk can be done against exactly what would ship.

## Known, not caused by 1.8

**MacPhail Center for Music is no longer a routable building.** A skyway node reassigned
to Residence Inn at the Depot upstream in OSM. Confirmed as drift by running the
*baseline* extractor against today's OSM — it drops MacPhail too. It survives as a
`nearby` POI hosted by Portland Avenue Ramp.

## Tooling added this session

`asc.py` gained two commands, because Xcode Cloud has never once auto-triggered on a
push to main for this app:

```sh
asc.py workflows 205BBDD8-A502-4B7C-9298-4A9758C03362   # -> 56C93F0B-2B9E-4378-B884-594727ED7491
asc.py start-run 56C93F0B-2B9E-4378-B884-594727ED7491 main
```

Two API notes worth keeping: `/v1/ciBuildRuns/{id}/sourceCommit` is **not** a
relationship (404) — the commit is an attribute of the run itself. And `asc.py runs`
lists oldest-first capped at 8, so it will never show a run you just started; query the
run by id.

`npm run data:refresh` runs extraction and both overlays in the right order. Extraction
rewrites `public/data/skymap-data.json` wholesale and silently dropped the entire hours
overlay once during this work — use the script, not the bare extraction.
