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

The set was recaptured on 2026-07-31 against the post-feedback UI (the
chip row now carries Hotels and Landmarks, so the 07-30 set was stale
again). It belongs to **1.2**: 1.1 was already WAITING_FOR_REVIEW and
pulling it back would have thrown away two days of queue for a screenshot
refresh, so it ships as-is a second time. Upload this set as the first
step of 1.2, before submitting.

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

## Always check the build predates nothing it claims (2026-08-06)

**A build only contains commits that landed before its run started.** This
is obvious and was still nearly missed: build 32 was uploaded at 18:21 CDT
on 07-31, and `b3d3a30` — the street-routing work that "What's New — 1.2"
advertises by name — was committed at 18:17, four minutes earlier. An
Xcode Cloud run (npm build, Capacitor sync, archive, upload) takes far
longer than four minutes, so build 32 cannot contain it. Submitting it
would have shipped release notes the binary didn't honor.

Before attaching a build, confirm what it actually built:

- Compare the build's upload time against `git log -1 --format=%cd` for
  the last commit the notes depend on. If the gap is under ~20 minutes,
  assume the build is older than the commit.
- Xcode → View → Navigators → Report → **Cloud** tab shows each run's
  source commit directly. That's the authoritative answer.

When in doubt, push and rebuild. Half an hour beats a review cycle.

## 1.2 — unblocked, 1.1 is live (as of 2026-08-06)

1.1 reached **Ready for Sale on 2026-07-29**, so Apple's one-version-at-a-
time rule no longer blocks 1.2, and no 1.2 version record exists yet.

`MARKETING_VERSION` is already 1.2. The job:

1. **Merge to `main`** and let Xcode Cloud build it. Do not reuse build 32
   — see the section above.
2. **Confirm the run built the commit you think it did**, then wait
   10–30 min for processing.
3. **+ next to "iOS App"** in the sidebar → version string `1.2`.
4. **Upload the 5 screenshots** from `appstore-assets/screenshots/` —
   captured 2026-07-31 against the 1.2 UI. Do this *before* submitting;
   after submission the API returns 409 and they wait another release.
5. **Paste "What's New — 1.2"** from below.
6. **Attach the new build**, then Save → Add for Review → Submit.

Set Version Release to **"Automatically release this version"** — on
manual release it parks in Pending Developer Release after approval and
blocks the next version until someone notices.

The build stays testable on TestFlight for the whole time 1.2 sits in
review, which is the cheapest way to catch anything the recording didn't.

Watch for: uploading a build while another version sits in review is a
documented way to disturb the in-review version's metadata
(developer.apple.com/forums/thread/745702). Not a concern while nothing
else is in review, but re-check the live version still reads correctly
after any upload.

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
