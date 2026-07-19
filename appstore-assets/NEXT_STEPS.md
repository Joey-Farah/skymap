# Getting SkyMap on the App Store — your steps

Everything I could prepare in advance (copy, screenshots, icon, privacy/support
pages) is done — see `APP_STORE_SUBMISSION.md` in this folder. This document is
just the sequence of things that need *you*: your Apple ID, your payment method,
your Xcode sign-in.

## 1. Enroll in the Apple Developer Program
- Go to [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/)
- Sign in with your Apple ID, pay the $99/year fee
- This can take anywhere from a few minutes to a day or two if Apple needs to
  verify anything

## 2. Sign into Xcode with that Apple ID
- Xcode → Settings (⌘,) → Accounts → **+** → add your Apple ID
- This is what lets Xcode create a real distribution certificate and
  provisioning profile for the App Store (not just the local dev one we've
  been using to install on your phone)

## 3. Tell me once you're signed in
- Once step 2 is done, I can build the actual signed release archive and hand
  you the exact upload steps (or drive it further myself from the command
  line if you'd rather not touch Xcode directly)

## 4. Create the app in App Store Connect
- Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com/) →
  My Apps → **+** → New App
- Platform: iOS · Name: `SkyMap` · Bundle ID: `app.skymap.ios` · pick any SKU
- If `app.skymap.ios` doesn't show up as a bundle ID option, it needs to be
  registered first at
  [developer.apple.com/account/resources/identifiers](https://developer.apple.com/account/resources/identifiers/list) — I can walk you through that when you get there

## 5. Fill in the store listing
- Everything you need to paste in is in `APP_STORE_SUBMISSION.md`:
  name, subtitle, description, keywords, category, age rating, privacy
  answers, export compliance answer, and the two URLs (already live)
- Upload the 5 screenshots and the 1024 icon from this folder

## 6. Upload the build and submit
- Once the signed build from step 3 is uploaded, select it under the version
  you created in App Store Connect
- Hit **Submit for Review**
- Apple's review typically takes 1–3 days; you'll get an email either way

---

**Where things stand right now:** steps 1 and 2 are the only real blockers —
once you've done those two, ping me and I'll pick up the build/upload side.
