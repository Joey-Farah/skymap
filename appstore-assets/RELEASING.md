# Shipping an update to the App Store

SkyMap Minneapolis is live. This is the repeatable flow for every update after
the initial submission. (`NEXT_STEPS.md` covers the *first* submission only and
is kept for history — don't follow it for updates.)

## The flow

1. **Bump `MARKETING_VERSION`** in `ios/App/App.xcodeproj/project.pbxproj`
   (both the Debug and Release build configurations — they must match).
   App Store Connect rejects an upload that reuses a version string already
   released, so this is the step that hard-blocks everything if skipped.

   Build numbers (`CURRENT_PROJECT_VERSION`) appear to be managed by Xcode
   Cloud rather than the project file — it has stayed at `1` while uploaded
   builds landed in App Store Connect as #2, #3, etc. If an upload is ever
   rejected for a duplicate build number, bump it here manually.

2. **Push to `main`.** Xcode Cloud's "Default" workflow has its Start Condition
   set to Branch Changes, so the push itself kicks off the build. Its
   Archive - iOS action has Distribution Preparation set to "App Store Connect",
   which uploads the archive on completion — no TestFlight post-action needed.

   Watch it in Xcode → View → Navigators → Report → **Cloud** tab.
   (⌘9 doesn't reliably jump there; use the menu.)

3. **Wait for the build to finish processing** in App Store Connect. It shows
   up under the app's Builds list. Processing typically takes 10–30 minutes
   after the cloud build goes green.

4. **Create the new version in App Store Connect**: My Apps → SkyMap Minneapolis
   → the **+** next to "iOS App" in the left sidebar → enter the same version
   string from step 1.

5. **Fill in "What's New in This Version"** — required for every update, unlike
   the initial submission. Text for the current release is below.

6. **Attach the build**, then Save → Add for Review → Submit.

   Export Compliance was answered once ("None of the algorithms mentioned
   above" — SkyMap only uses system HTTPS, no custom or linked crypto) and
   hasn't needed re-answering on later builds.

## Screenshots

Run `npm run screenshots` with the dev server up (`npm run dev -- --port
5180`). It renders headless at a 428x926 viewport with deviceScaleFactor 3,
landing exactly on Apple's 1284x2778 with no resize pass. Add `--light` for
the light appearance. Don't capture with macOS screenshot: that gives
physical screen pixels, which is how one attempt came out at 646x1396 —
right aspect, half the resolution, unusable.

Keep the whole set in a single appearance. The App Store can't serve a
light and a dark variant, so a mixed set just looks inconsistent.

**Screenshots cannot be changed once the version is `WAITING_FOR_REVIEW`** —
the API returns 409 `STATE_ERROR`, "Can't Create Screenshot while Waiting
For Review". Upload them *before* submitting, or they wait for the next
version. Editing a live version's screenshots also requires a new version,
so there's no back door once it's shipped.

The set in `appstore-assets/screenshots/` was recaptured **2026-08-06 for
1.3**, against the six-chip row (Landmarks folded into Misc.). The 07-31
set shipped with 1.2 and showed seven chips including Landmarks, so it is
stale the moment 1.3's filter change lands — recapture is not optional
here, the change is visible in shots 1 and 2.

Withdrawing a submission, if it ever *is* worth it, is not on the version
page — the modern flow puts "Remove from Review" on the **review
submission** (App Store tab banner / Review Submission in the sidebar).
The API equivalent is PATCH /v1/reviewSubmissions/{id} with canceled:true.

## Metadata gotchas found the hard way (2026-07-29)

- **Paragraphs in the description must each be one unbroken line.** The App
  Store renders literal newlines *and* soft-wraps to the device, so a
  hard-wrapped paragraph comes out ragged — long line, short line, long
  line. Only blank lines between paragraphs, never inside one.
- **The "Developer Website" link on the listing is `marketingUrl`**, not
  anything in your Apple account. It pointed at the web build of the app;
  it now points at joeyfarah.dev.
- **`supportUrl` must actually resolve.** It 404'd on the live listing for
  the whole of 1.0: production on Vercel was deployed hours *before*
  `public/support.html` was added, so the page had never shipped. Re-check
  it after any release — `curl -o /dev/null -w '%{http_code}'`.
- Metadata for a released version can't be edited; the fixes above live on
  the next version's record.

## Ask the API which commit a build came from (2026-08-06)

Before attaching a build, confirm what it actually built. There is an
exact answer, so don't estimate:

```
python asc.py runs 205BBDD8-A502-4B7C-9298-4A9758C03362
```

or, for the commit itself, `GET /v1/ciProducts/{id}/buildRuns` with
`sort=-number` and read `attributes.sourceCommit.commitSha`. Match that
against the commits the release notes depend on.

**Do not infer it from timestamps.** That was tried here and got the
wrong answer: build 32 was uploaded four minutes after the commit its
notes advertised, which looked impossible, so it was written off as
stale. The API said otherwise — run #32 started at 23:17:30Z and
uploaded at 23:21:44Z, having built exactly that commit. **A full Xcode
Cloud run on this project — npm build, Capacitor sync, archive, upload —
takes about four minutes.** It is much faster than it looks like it
should be, and reasoning from "a build must take longer than that" will
mislead you every time.

## 1.2 — SHIPPED 2026-08-06

Submitted 19:24 UTC, `READY_FOR_SALE` roughly an hour later with build 36.
**Review is not reliably slow.** 1.0 and 1.1 each took days, so the plan was
to submit and test on TestFlight during review, withdrawing if the walk
found something. Approval beat the walk. Anything that has to be verified on
real hardware must be verified *before* submitting — the withdraw path
(`PATCH /v1/reviewSubmissions/{id}` `{canceled: true}`) only exists until
review completes.

## 1.5 — queued behind 1.4 (2026-08-08)

Nothing to do until 1.4 is `READY_FOR_SALE`. Commits are on `main` and
**unpushed on purpose**: pushing builds a new binary, and while 1.4 sits in
review that only invites a withdraw-and-resubmit for no user-visible gain.

Waiting to go out:

- `0d3697b` — the operator's own hours outrank OSM by default, with a
  source requirement and staleness warnings. **Changes no shipped data**
  (verified byte-identical); it governs the next `npm run data:osm`.
- `af332ef` — docs only, the attribution line in the 1.4 notes.

Push both once 1.4 ships, then bump `MARKETING_VERSION`, regenerate the
notes, and reuse `prepare-1.4.sh` as the template (gate on the previous
version being `READY_FOR_SALE`, resolve the build by number, stop before
submit).

Also worth folding in: the six data follow-ups in
`docs/hours-curation-run.md` — three POIs that look like closed businesses,
two sitting far from their published address, a duplicate Jack Link's, and
a rename. None of them are code.

## 1.4 — prepared, NOT submitted (2026-08-07)

`MARKETING_VERSION` is 1.4. Eight user-visible bugs fixed, found by two
fresh-context sweeps, plus the hours work: 372 places researched, 113
recorded from operators' own sources, and the fabricated ordinance default
deleted. Build goes to TestFlight; **Joey submits it himself** after
walking it. 1.3 was still WAITING_FOR_REVIEW ~15 hours after submission,
so 1.2's one-hour approval was not the new normal — there is time to test
before sending this one.

**The build to test is 45** (commit 4ab17b2). Build 44 is the same release
minus the not-an-access-claim retraction; ignore it.

The App Store Connect side cannot be prepared yet. Apple rejects creating
1.4 while 1.3 is IN_REVIEW:

```
409 ENTITY_ERROR.RELATIONSHIP.INVALID
"You cannot create a new version of the App in the current state."
```

So it lives in `prepare-1.4.sh`, which refuses to run until 1.3 reaches
READY_FOR_SALE and then creates the version, sets the what's-new text from
`release-notes/1.4.txt`, and attaches build 45. It stops before submitting.

**Builds do not reach the TestFlight group on their own.** Both 44 and 45
had to be added explicitly:

```
POST /v1/betaGroups/1c4607e4-7ed4-46eb-98d2-dbb602b51bf1/relationships/builds
{"data": [{"type": "builds", "id": "<build uuid>"}]}
```

Earlier builds all being in the group looked like automatic distribution;
it isn't, and 44 sat VALID-but-undelivered until it was pushed manually.

## 1.3 — submitted without a device walk (Joey's call, 2026-08-06)

`MARKETING_VERSION` is 1.3. Screenshots recaptured against the six-chip row.

The 1.2 lesson said verify on hardware before submitting. Joey weighed that
against the new review speed and chose to ship: at roughly an hour a cycle,
a forward fix is faster than waiting for a walk. Worth being precise about
the fallback, because it is not what it sounds like — **the App Store has no
rollback.** You cannot revert to a previous build; removing a version from
sale pulls the app entirely. What actually exists is a fast *forward* fix:
submit a new version containing the old behaviour. At current review speed
that is about an hour, which is why the trade is reasonable — but it is a
new release, not an undo.

## What's New — 1.1

```
Better walking times, a cleaner map, and place cards that tell you what
you actually want to know.

• Tap a restaurant or shop and you'll now see how far it is, how long it
  takes to walk there, what floor it's on, and when the skyway itself is
  open — plus its logo and a link to its menu.
• Live arrival times now follow your real position along the route, instead
  of jumping a step at a time — no more times that looked frozen while you
  crossed a large building.
• The map shows building names only when you zoom in, so the default view
  isn't crowded with text.
• "Back to Ramp" now takes you back. It previously did nothing unless you
  were already planning a route.
• Location is only asked for once, and it asks in the app's own words.
• Picking a destination in the building you're already standing in tells you
  you're there, instead of failing to search.
• Route start and end points now land on the actual skyway door.
• Simplified the filters: "Food" now covers restaurants and convenience
  stores, and shops and services are combined under "Misc."
```

## What's New — 1.4

```
Hours you can trust — and honesty about the ones we don't have.

• Opening hours for 113 more restaurants, shops and services, every one of them read off the operator's own website, menu or door — never a directory listing.
• Buildings no longer borrow the city's generic skyway schedule. Most downtown buildings don't actually keep those hours, and showing them meant some buildings looked open four hours longer than they are, and open on weekends they're shut. Where nobody publishes hours, the app now says nothing at all instead of guessing.
• Directions no longer avoid a building because of hours that were never about walking through it — a museum's ticket times and a food hall's kitchen hours don't decide whether the skyway is open.
• Routes are smarter about the walk inside each building, not just the bridges between them — most trips are now shorter, and the longest are several minutes shorter.
• Places with accents or apostrophes in their names — Pizza Lucé, Fogo de Chão, Jalapeño Mexican Grill, Tom's Watch Bar — can now be found by typing them however you like.
• Somewhere open around the clock now says "Open 24 hours" instead of claiming it closes at midnight.
• The Government Plaza and Warehouse District light-rail stations are searchable.
• "You've arrived" no longer appears while you're still walking.
• Starting a second trip now routes from where you actually are, instead of where your last trip began.
• The map's credits now name OpenStreetMap for the skyway data itself, not just the map underneath it.
```

## What's New — 1.3

```
Hotels are where you'd expect them, and the map filters are simpler.

• Every downtown hotel now shows under the Hotels filter. Most of them were filed under Landmarks by mistake, so the filter meant for them was turning up nearly empty.
• Fewer filter buttons: landmarks like theatres, museums and public art now appear under Misc. rather than taking a row of their own.
```

## What's New — 1.2

The first release driven by user feedback. Leads with the places, because
that's what the reporter actually wrote in about.

```
Far more places, a position that stays on the skyway, and feedback you can
send without leaving the app.

• Search now finds hundreds more places — hotels, the downtown Target,
  shops, clinics, offices, even the skyway shoe repair. Somewhere just off
  the network says so, and tells you which building to walk out of.
• New Hotels and Landmarks filters on the map.
• Your location now follows the skyway you're walking, instead of drifting
  into the street below.
• You can now start a route from where you are, even out on the street —
  the app picks the nearest skyway building and includes the walk to reach
  it in the trip time. It used to offer this only if you were already
  standing inside a mapped building.
• The Feedback button opens a form right in the app — no mail app needed.
```
