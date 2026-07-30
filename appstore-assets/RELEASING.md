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

Screenshots and description only need updating when the UI in them actually
changed. The 1.1 changes are subtle enough at screenshot scale that the
existing 1.0 screenshots still represent the app honestly.

## What's New — 1.1

```
Better walking times and a cleaner map.

• Live arrival times now follow your real position along the route, instead
  of jumping a step at a time — no more times that looked frozen while you
  crossed a large building.
• The map shows building names only when you zoom in, so the default view
  isn't crowded with text.
• Picking a destination in the building you're already standing in tells you
  you're there, instead of failing to search.
• Route start and end points now land on the actual skyway door.
• Simplified the filters: "Food" now covers restaurants and convenience
  stores, and shops and services are combined under "Misc."
```
