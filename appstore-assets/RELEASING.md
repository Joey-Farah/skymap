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

## 1.3 — prepared, holding for a device walk

`MARKETING_VERSION` is 1.3. Screenshots recaptured against the six-chip row.
Do NOT submit until the TestFlight build has been walked: 1.2 shipped with a
compass change that was never run on hardware, and this release is the first
chance to confirm it.

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
