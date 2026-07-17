# Getting Skymap onto your iPhone — and, eventually, the App Store

Two different goals, two very different amounts of effort. This doc is
honest about which is which.

## Tonight: installable via "Add to Home Screen" (done)

This is a Progressive Web App (PWA) install — Safari puts a real icon on
your home screen, it launches full-screen with no browser chrome, and it
works fully offline after the first load. On iOS this is functionally
indistinguishable from an App Store app in daily use. No Apple Developer
account, no review process, no cost.

What was built tonight (branch `overnight/2026-07-16-pwa-native`):

- **Offline-first service worker** that precaches the entire app —
  the JS/CSS bundle, all 178 buildings' worth of data, all 105 bundled
  business logos, every icon — at install time, not just opportunistically
  as you browse. Verified end-to-end with the network fully killed: the
  app boots, loads all buildings, and computes a real route with zero
  successful network requests.
- **Splash screens** for every current iPhone size (X through 16 Pro
  Max) so opening the app shows the Skymap mark on launch instead of a
  blank white flash.
- **A maskable icon** so the home-screen icon looks correct regardless of
  what shape mask iOS/Android crops it to.
- **A hardened install**: if the service worker can't fetch the app shell
  itself (the core files, not the nice-to-haves), the install fails
  cleanly and the browser retries automatically next time — instead of
  silently "succeeding" with a broken, permanently-stuck offline cache.

### What you need to do

1. **Promote tonight's build to production** — one command, from this
   repo:
   ```
   vercel promote skymap-fux1vnrpe-joey-farahs-projects.vercel.app -y
   ```
   (This promotes the exact build that was tested tonight — no rebuild,
   no drift. I couldn't run this myself: production deploys are gated by
   a system-level permission check that requires you specifically, not
   just your say-so from earlier in the conversation.)
2. Open **https://skymap-alpha.vercel.app** in Safari on your iPhone.
3. Tap the Share button → **Add to Home Screen**.
4. That's it — you now have a Skymap icon that opens full-screen and
   works offline.
5. **Merge the branch** if you're happy with it:
   `git checkout main && git merge overnight/2026-07-16-pwa-native`
   (kept off `main` intentionally since you were asleep — nothing landed
   on `main` without you seeing it first).

## Eventually: an actual App Store listing

This is a real undertaking with real costs, and — critically — several
steps that only you can do, because they require your Apple ID,
2-factor authentication, and a credit card. I can't do any of these on
your behalf even in principle.

### What only you can do

1. **Enroll in the Apple Developer Program** — $99/year, tied to your
   Apple ID. Sign up at developer.apple.com. Apple sometimes takes 24–48
   hours to approve new enrollments.
2. **Install Xcode** (free, but it's an 8–15GB download) and sign into it
   with the same Apple ID.
3. Later, **accept a TestFlight invite** on your phone to test a real
   build before it's public, and eventually **approve the App Store
   Connect listing** (screenshots, description, privacy policy URL,
   support URL, age rating questionnaire) — all through Apple's web
   dashboard, tied to your account.

### What's already done in advance

Capacitor (the standard tool for wrapping a web app into a real,
Xcode-buildable native shell) is installed and configured
(`capacitor.config.ts`, pointed at `dist/` as the web content). This part
needed no Apple account — just npm. What's *not* done: actually generating
the iOS Xcode project (`npx cap add ios`), because that needs a full Xcode
install and CocoaPods, and this environment only has the Command Line
Tools — running it blind without being able to verify the result would
just hand you broken scaffolding to debug instead of a head start.

### What I can do once you've installed Xcode + enrolled

- **Generate and configure the Xcode project**: `npx cap add ios`, then
  bundle ID, app icons at every required size, launch screen, signing
  settings pointed at your Developer account.
- **Configure the Xcode project**: bundle ID, app icons at every required
  size, launch screen, signing settings pointed at your Developer account.
- **Draft the App Store Connect listing content**: description, keywords,
  what's-new text, privacy nutrition label answers (Skymap collects
  nothing — no accounts, no tracking, no analytics — so this should be
  straightforward).
- **Prepare screenshots** at the required device sizes.

### The honest complication: Apple's review guidelines

Apple's App Store Review Guideline 4.2 ("Minimum Functionality") has
historically been strict about apps that are just a website in a wrapper
with no added native value. A Capacitor-wrapped PWA can pass review, but
reviewers do sometimes reject "thin wrapper" submissions and ask for more
native integration. Skymap's offline-first design and on-device routing
(nothing round-trips to a server) work in our favor here — it's a
legitimately different experience from "open Safari and bookmark it" —
but it's worth knowing this isn't a guaranteed rubber-stamp, and a first
submission getting bounced back with review notes is a normal part of
the process, not a sign anything is wrong.

### Rough total effort, once you've enrolled

A few hours of my time for the Capacitor wrap + Xcode config + listing
content, assuming no major review pushback. Apple's review itself
typically takes 24–48 hours after submission, sometimes longer.

## My recommendation

Live with the home-screen install for a while first. It costs nothing,
works today, and for a single-user (or friends-and-family) navigation
tool, most people genuinely can't tell the difference from an App Store
app in daily use. Revisit the App Store path once you want it discoverable
by strangers searching the App Store, not just people you've sent a link.
