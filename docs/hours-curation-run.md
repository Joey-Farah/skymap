# Overnight hours curation run — started 2026-08-06

Joey: "you have all night to work on those missing pieces… that's a huge fix."

## Objective

Research every POI and building that has no real opening hours, and record
an accurate answer for each — including "no hours are published anywhere",
which is an accurate answer and a successful outcome.

**The one forbidden move is guessing.** A blank hours line disappoints; a
confident wrong one sends someone to a locked door. Ambiguity gets recorded
as ambiguity.

## Scope

372 items: 274 POIs (food, coffee, hotel, shops/services) and 98 buildings
still on the Minneapolis city-ordinance default schedule.

## Sources — what is and isn't allowed

- **Allowed:** a business's own website; its own listing on its chain's
  store locator; a building's own property-manager page. A business
  publishing its hours is a fact we may record.
- **NOT allowed: `skywayaccess.com`.** It has per-building skyway hours for
  152 buildings whose names match ours, and its Terms of Service forbid
  reproducing site content and bar access by any means other than their
  interface. Checked 2026-08-06. Same wall as the Google Places licensing
  dead end. Do not use it, and do not use anything derived from it.
- **Not allowed:** Google Places (Maps Platform terms bar caching Places
  content and displaying it beside a non-Google basemap; SkyMap is
  MapLibre/OpenFreeMap).

## Mechanics

```
node scripts/hours-ledger.mjs init      # add newly-missing items
node scripts/hours-ledger.mjs status    # progress
node scripts/hours-ledger.mjs next 12   # next batch to research
node scripts/fetch-hours-candidates.mjs --render   # gather evidence
node scripts/apply-hours-overlay.mjs --write       # merge into the dataset
```

State is on disk, never in context: `data/hours-ledger.json` tracks what has
been researched, `data/hours-overlay.json` holds the answers and the
refusals. An interrupted run resumes from the ledger.

Every ledger item ends as one of: `done` (hours recorded), `none`
(researched, nothing published), `ambiguous` (sources disagree — recorded,
not resolved), `blocked` (can't identify or reach the source).

## Stop conditions

1. Ledger complete — no `pending` items left. **Or**
2. Three consecutive batches produce zero new `done`/`none`/`ambiguous`
   results — that means the approach has stopped working, and thrashing
   through the rest wastes the night. Halt and write up what's left.
3. Test suite goes red, or `npm run build` fails — stop immediately, that's
   a real regression and matters more than coverage.

## Working rules

- Branch `feat/hours-overlay`, never `main`.
- Commit after each batch, so an interruption loses at most one batch.
- `npm test` and `npx tsc --noEmit` green before every commit.
- `apply-hours-overlay.mjs` validates syntax before writing — an entry the
  parser rejects renders as *no hours*, indistinguishable from having none.
  It caught exactly that on the first run (`16:00-02:00` crossing midnight).

## Housekeeping

`caffeinate -dims` PID is recorded in the scratchpad at `caffeinate.pid`.
**Kill it at the end of the run and re-verify with `pgrep -lx caffeinate`** —
a stray one ran all night once before.

## Second objective, added mid-run

Joey: "do another sweep of any really bad bugs like this in the app and
resolve them over night… I expect to see a report and a prepare next
release (don't submit it yet of course)."

"Like this" means the shape of the hours gap: something plainly wrong that
a user hits in normal use, which nobody caught because nothing failed
loudly. Not style, not hypotheticals — things that mislead or strand
someone. The three found today all had that shape: an arrival clock that
oscillated on every walk, a locate button that killed navigation on the
second tap, 16 hotels vanishing from the cards of the buildings they're in.

Deliverables by morning:

1. Hours ledger as far as it gets, every outcome recorded.
2. Bug sweep findings, each verified before being called a bug.
3. Release 1.4 **prepared and NOT submitted** — version bumped, notes
   written, screenshots recaptured if the UI changed, build made and put
   on TestFlight so Joey can walk it. Submission is his call in the morning.

## Expected honest outcome

Not 100%. A real share of these businesses do not publish hours anywhere.
The realistic ceiling is roughly 80-85% for food and coffee, lower for shops
and services. The deliverable is an accurate dataset plus a written record
of what genuinely isn't available — not a percentage made to look good.
