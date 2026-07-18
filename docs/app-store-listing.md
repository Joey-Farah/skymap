# App Store Connect listing — copy-paste pack

Drafted 2026-07-18 so listing day is paste-work, not writing work.
Everything below fits Apple's field limits (noted per field).

## App name (30 chars max)

> SkyMap: Minneapolis Skyway

(21 chars. If taken, fallback: `SkyMap — Skyway Navigator`, 25.)

## Subtitle (30 chars max)

> Navigate downtown, inside

(25 chars. Alternate: `Skyway routes & directions`, 26.)

## Description (4000 chars max)

> Eight miles of enclosed bridges connect downtown Minneapolis — if you
> know the way. SkyMap is turn-by-turn navigation for the skyway system:
> search any building or business, tap Directions, and walk there without
> stepping outside.
>
> ROUTES THAT KNOW THE HOURS
> Skyway segments close when their buildings do. SkyMap routes around
> buildings that will be closed when you'd reach them, warns you when one
> on your route is closing soon, and flags the rare stretch with stairs
> or a brief outdoor crossing.
>
> FOLLOWS ALONG AS YOU WALK
> Your position tracks live on the route, step by step — "Head into the
> Soo Line Building" — and if GPS drifts indoors (it does), tap the route
> line to correct it.
>
> FIND WHAT'S AROUND
> Coffee, restaurants, shops, restrooms, and elevators, mapped inside the
> buildings. Searching a chain shows the closest location first.
>
> PARKED IN A RAMP?
> SkyMap notices, offers to remember it, and routes you back at the end
> of the day.
>
> BUILT FOR THE SKYWAY
> Works offline once loaded. No account, no ads, no tracking — your
> location never leaves your phone. Data from OpenStreetMap, with a
> one-tap way to report anything that's changed.
>
> Whether you're a downtown regular, new to the maze, or in town for a
> game at Target Center or U.S. Bank Stadium — skip the skyway confusion
> and the Minnesota weather in one move.

## Keywords (100 chars max, comma-separated, no spaces needed)

> skyway,minneapolis,downtown,walking,indoor,navigation,directions,map,route,twin cities,st paul

(97 chars. Don't waste keywords on "SkyMap" — the name field already
counts.)

## Category

- Primary: **Navigation**
- Secondary: **Travel**

## URLs

- Support URL: `https://github.com/Joey-Farah/skymap`
- Marketing URL (optional): `https://skymap-alpha.vercel.app`
- Privacy Policy URL: `https://skymap-alpha.vercel.app/privacy.html`

## App Privacy questionnaire

- Location (Precise) → **App Functionality** → not linked to identity →
  not used for tracking.
- Everything else: **Data not collected.**

## Age rating

All questionnaire answers "None/No" → **4+**.

## App Review notes (the box reviewers read)

> SkyMap is a navigation app for the Minneapolis Skyway, the enclosed
> second-floor bridge system connecting ~180 downtown buildings.
>
> - Location permission is used only to show the user's position on the
>   map and their progress along a walking route. Processing is entirely
>   on-device; the app has no server and no analytics.
> - To test routing without being in Minneapolis: open the app, tap
>   "Where to?", search "Central Library", tap it, then tap Directions
>   and choose any starting building (e.g. "IDS Center") in the From
>   field. A full turn-by-turn skyway route renders.
> - All map/business data is from OpenStreetMap; the in-app "Report an
>   issue" link is a mailto for data corrections.

## Screenshots (to produce at submission time)

Required sizes: 6.9" (iPhone 16 Pro Max sim) and 6.5" (11 Pro Max sim).
Suggested five, in order:
1. Route view — "Current Location → Minneapolis Central Library" with
   the amber route and summary sheet.
2. Place card — a building with hours, photo, businesses.
3. Turn-by-turn list expanded, "Head into…" prompt visible.
4. "Show on map" category pills with coffee icons lit up.
5. Dark mode map.

## Version-day checklist (repeat every upload)

1. `npm run build && npx cap sync ios`
2. Bump `CURRENT_PROJECT_VERSION` (and `MARKETING_VERSION` when
   user-visible) in `ios/App/App.xcodeproj`.
3. Product → Archive (uses Release config — already verified building
   and running 2026-07-18).
