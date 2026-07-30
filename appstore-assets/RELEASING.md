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

Screenshots only need updating when the UI in them actually changed — but
for 1.1 it did. `screenshots/3-place-card.png` shows the POI card as it was
before the reframe, a layout the app no longer has. Recapture at minimum
that one, and keep the whole set in a single appearance: the App Store
can't serve a light and a dark variant, so a mixed set just looks
inconsistent.

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
