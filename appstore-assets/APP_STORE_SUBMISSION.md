# SkyMap — App Store Connect submission package

Everything below is ready to copy straight into App Store Connect. Sections marked
**[YOU DO THIS]** need your Apple ID / payment / account access — I can't do those parts.

---

## 0. Prerequisites — **[YOU DO THIS]**

1. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/enroll/) ($99/year), if not already done.
2. In [App Store Connect](https://appstoreconnect.apple.com/), create a new app:
   - Platform: iOS
   - Name: `SkyMap Minneapolis` (bare "SkyMap" was already taken)
   - Primary language: English (U.S.)
   - Bundle ID: `app.skymap.ios` (must already exist under your account — create it in
     [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list)
     first if it doesn't yet)
   - SKU: `skymap-ios` (or anything unique to you — not shown to users)

---

## 1. App name & subtitle

**Name** (30 char max): `SkyMap Minneapolis`
*(19 chars — "SkyMap" alone is already taken by another developer, so this is the App Store listing name. The app itself still says "SkyMap" everywhere — in-app branding, bundle display name, etc. — this only affects the storefront name.)*

**Subtitle** (30 char max): `Minneapolis Skyway Navigator`
*(29 chars)*

---

## 2. Promotional text (170 char max, editable anytime without a new review)

```
Never get turned around in the Skyway again. SkyMap gives clear turn-by-turn
directions to any coffee shop, restaurant, or building inside it.
```
*(142 chars)*

---

## 3. Description (4000 char max)

```
Ever gotten turned around in the Minneapolis Skyway, unsure which bridge
leads where or where the nearest coffee shop actually is? SkyMap fixes that.

SkyMap gets you where you're going through the Skyway — the largest
contiguous enclosed pedestrian skyway system in the world — without ever
stepping outside in a Minnesota winter.

Search any building or business connected to the skyway, and SkyMap draws
turn-by-turn walking directions through the actual indoor route: which
bridge to cross, which building to walk through, and when you'll need an
elevator or escalator along the way.

WHAT SKYMAP DOES

• Turn-by-turn skyway walking directions between any two connected buildings
• Real walking-time estimates, based on actual indoor path distances — not
  a straight-line guess
• Live building hours, so you're not routed into somewhere that's closed
• Warnings when a building on your route is closing soon, or when a stretch
  of your walk briefly goes outdoors
• Search restaurants, coffee shops, restrooms, elevators, and landmarks
  along the way
• Share a route with a link — no account needed on either end

WHY IT'S DIFFERENT

SkyMap is built specifically around the skyway system: real connections,
real hours, real walking distances — routed through the actual indoor path,
not a straight line — sourced from OpenStreetMap and continuously
improvable by anyone who spots something off.

PRIVACY

SkyMap has no account, no sign-in, and no analytics or tracking of any
kind. Location is used only on your device to show where you are and guide
your route — it's never stored or sent anywhere. Full privacy policy at
skymap-alpha.vercel.app/privacy.html.

Minneapolis Skyway data from OpenStreetMap contributors.
```
*(~1,700 chars — comfortably under the 4000 limit; trim the "WHY IT'S DIFFERENT"
section first if you want it shorter.)*

---

## 4. Keywords (100 char max, comma-separated, no spaces after commas to save room)

```
skyway,minneapolis,walking,directions,indoor,navigation,downtown,map,winter,pedestrian
```
*(89 chars)*

---

## 5. URLs

| Field | Value |
|---|---|
| Support URL | `https://skymap-alpha.vercel.app/support.html` |
| Marketing URL (optional) | `https://skymap-alpha.vercel.app/` |
| Privacy Policy URL | `https://skymap-alpha.vercel.app/privacy.html` |

Both `support.html` and `privacy.html` are already live at those URLs.

---

## 6. Category

- **Primary category:** Navigation
- **Secondary category:** Travel

---

## 7. Age rating

Apple's current age-rating questionnaire is a series of yes/no toggles. For SkyMap,
every content-based toggle (violence, mature themes, gambling, alcohol/drugs, horror,
etc.) should be answered **No / None** — this is a walking-directions app. Expected
result: **4+**.

---

## 8. App Privacy ("Nutrition Label")

In App Store Connect → App Privacy, declare:

| Data type | Collected? | Linked to identity? | Used for tracking? | Purpose |
|---|---|---|---|---|
| Precise Location | Yes | No | No | App Functionality |

Everything else (contact info, financial info, browsing history, identifiers,
usage data, diagnostics, etc.) — **not collected**. There's no analytics SDK, no
account system, and no server that receives or stores anything (see
`public/privacy.html` for the full explanation this label needs to match).

---

## 9. Export compliance

When asked *"Does your app use encryption?"*: **Yes** (it uses HTTPS).
When asked if it qualifies for the standard exemption: **Yes** — SkyMap only uses
standard HTTPS/TLS for network requests (map tiles, its own static data) and
implements no proprietary or non-exempt encryption. This qualifies under Apple's
standard exemption (no `ITSAppUsesNonExemptEncryption` action needed beyond
answering the questionnaire this way at submission).

---

## 10. Version info

- **Version:** `1.0` *(already set in the Xcode project)*
- **Copyright:** `© 2026 Joey Farah`
- **What's New in This Version** (first release — App Store Connect requires text
  here even for v1.0):
  ```
  First release. Turn-by-turn walking directions through the Minneapolis Skyway,
  with real indoor routing, live hours, and no account required.
  ```

---

## 11. Screenshots

Located in `appstore-assets/screenshots/`, sized 1284×2778 (Apple's iPhone
6.5" display bucket — the one App Store Connect actually validated against
for this app; an earlier 1290×2796 (6.7"/6.9") set was rejected for wrong
dimensions):

1. `1-idle-map.png` — the map at rest, search bar + category filters
2. `2-search.png` — live search results
3. `3-place-card.png` — a selected place with hours and directions
4. `4-route-preview.png` — route summary before starting
5. `5-navigation.png` — live turn-by-turn navigation

Upload all 5, in that order, under the iPhone tab's screenshot section. If
App Store Connect asks for other device sizes (6.7", 5.5"), it will generally
accept the same images scaled — try uploading the same 5 first.

---

## 12. App icon

`appstore-assets/app-icon-1024.png` — 1024×1024, no alpha channel, matches what's
already bundled in the app itself. Upload this in the App Information / General
section's app icon field if App Store Connect asks for it separately from the
binary.

---

## 13. Build upload — **[YOU DO THIS, with my help if you want it]**

Once you've enrolled and created the app record above, building an actual
signed archive for upload needs your Apple ID logged into Xcode (Preferences →
Accounts) so a real distribution certificate/provisioning profile can be created —
I can drive Xcode's command line once that's in place, but the initial sign-in
has to be you. Steps, when ready:

1. Xcode → sign in with your Apple ID (Settings → Accounts)
2. Product → Archive (or `xcodebuild archive` from the command line)
3. Upload via Xcode Organizer, or `xcrun altool` / Transporter
4. Back in App Store Connect, select the uploaded build under the version you
   created, fill in the fields above, and submit for review

---

## Summary: what's done vs. what's left

**Done, already live:**
- Privacy policy page
- Support page
- App icon (1024, bundled + separate upload copy)
- Screenshots (5, at required resolution)
- iPhone-only device restriction
- All submission copy (name, subtitle, description, keywords, category, age
  rating, privacy label, export compliance)

**Left for you:**
- Apple Developer Program enrollment ($99)
- Creating the app record in App Store Connect
- Signing into Xcode with your Apple ID and producing a signed build
- Filling the App Store Connect form with the content above and hitting Submit
