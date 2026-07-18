# SkyMap → App Store: current status and what's actually left

Rewritten 2026-07-17, after the native wrapper was built and verified on a
real iPhone. (The previous version of this doc predates `ios/` existing —
everything it listed as future work is now done.)

## Where things stand (all verified working)

| Piece | Status |
| --- | --- |
| Native iOS project (Capacitor, `ios/App`) | ✅ builds clean via Swift Package Manager — no CocoaPods needed |
| Xcode toolchain | ✅ Xcode 16.4 in `/Applications`, selected, licensed (16.x is the newest line that runs on this Mac's macOS 15 / Intel hardware) |
| Simulator run | ✅ iPhone 16 / iOS 18.6 |
| Physical-device run | ✅ built, signed, installed, and live-tested on Joey's iPhone across many iterations |
| Code signing | ✅ automatic, personal team `2CNCUCPNVB` — good for device testing only |
| Location in the native shell | ✅ browser Geolocation API works inside WKWebView with the `NSLocationWhenInUseUsageDescription` string; no Capacitor geolocation plugin needed |
| App icon + launch screen | ✅ SkyMap's own mark at required sizes |
| Full-bleed layout in WKWebView | ✅ `contentInset: never`, locked viewport scale, fixed-position body — the early cropping/scrolling bugs are fixed |
| Privacy policy page | ✅ `public/privacy.html` → live at `https://skymap-alpha.vercel.app/privacy.html` after the next production promote |
| Feedback email | ✅ real monitored inbox (`joeyefarah+skymap@gmail.com`) |

## The one hard blocker: Apple Developer Program

The free personal team can install on Joey's own plugged-in iPhone —
nothing more. **TestFlight and the App Store both require the paid Apple
Developer Program ($99/yr)**: enroll at
[developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll)
with the same Apple ID already signed into Xcode. Approval is usually
minutes-to-a-day. Every step below waits on this.

## After enrollment, in order

1. **Confirm the bundle ID** — `app.skymap.ios` is set in
   `capacitor.config.json` and the Xcode project. It becomes permanent the
   moment it's registered in App Store Connect. (It's fine; a reverse-DNS
   of a domain we own would be marginally more conventional, but we don't
   own one.)
2. **Create the app record** at
   [appstoreconnect.apple.com](https://appstoreconnect.apple.com):
   New App → iOS → name "SkyMap" (if taken, e.g. "SkyMap Minneapolis"),
   language en-US, the bundle ID, SKU anything (`skymap-ios-1`).
3. **Switch Xcode signing to the paid team** (Signing & Capabilities →
   Team dropdown).
4. **Archive and upload** — Product → Archive in Xcode, then Distribute →
   App Store Connect. (A CLI equivalent via `xcodebuild archive` +
   `-exportArchive` exists once the team is set, so this can be scripted.)
5. **TestFlight**
   - *Internal testing*: add your own Apple ID as tester — live within
     minutes of the build processing, no review.
   - *External testers* (the actual goal): create a group, enable a public
     link, submit for Beta App Review — usually <24h, much lighter than
     full review. Testers install the TestFlight app and tap the link.
6. **Full App Store release** (later, when ready)
   - Screenshots: the 6.9" (iPhone 16 Pro Max) and 6.5" size classes —
     the installed simulators can produce all of these.
   - Description, keywords, support URL (the GitHub repo or the site).
   - Privacy policy URL: `https://skymap-alpha.vercel.app/privacy.html`.
   - App Privacy questionnaire — answers per the privacy audit:
     - **Location (precise)**: collected? *Yes* → used for **App
       Functionality** only → **not linked to identity** → **no
       tracking**. (It never leaves the device, but Apple's form counts
       on-device use as "collected".)
     - Everything else: **no data collected**. No analytics, no
       identifiers, no accounts.
   - Age rating questionnaire: all "no" → 4+.
   - Submit for review; typically 1–3 days. Demo note for the reviewer:
     "Navigation app for the Minneapolis Skyway; location is used only to
     position the user on the map, on-device."

## Gotchas worth knowing in advance

- **Debug vs Release**: everything so far has been Debug builds. Archive
  uses Release automatically — do one Release-config sanity run on the
  simulator first (`-configuration Release`).
- **Version discipline**: App Store Connect rejects re-uploads of the same
  build number. Bump `CURRENT_PROJECT_VERSION` on every upload.
- **The web build must be synced before every archive**:
  `npm run build && npx cap sync ios` — the archive packages whatever is
  sitting in `ios/App/App/public`, not the live repo state.
- **Guideline 4.2 ("minimum functionality")**: reviewers sometimes bounce
  thin website-wrappers. SkyMap's case is solid — offline dataset,
  on-device routing, no server at all — a legitimately different thing
  from a bookmarked website. A first-submission bounce with notes is a
  normal part of the process if it happens, not a crisis.
