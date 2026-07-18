# Feature ideas, grounded in what comparable apps actually do

Written 2026-07-18 (overnight session), from a survey of every serious
indoor-pedestrian-network app findable: the two Minneapolis competitors,
plus Calgary's +15 apps and Houston's tunnel apps — the two cities whose
networks most resemble ours.

Sources: [Sky Walker (App Store)](https://apps.apple.com/us/app/sky-walker-minneapolis-skyway/id1166102666),
[skyway.run](https://skyway.run/),
[Star Tribune on skyway.run](https://www.startribune.com/minneapolis-skyway-map-directions-interactive-downtown-hours-shops-restaurants-skywayrun/601537080),
[Pedesting (Calgary)](https://pedesting.com/),
[Calgary Plus15](https://calgaryplus15.ca/),
[HTX Tunnels (Houston)](https://apps.apple.com/us/app/htx-tunnels/id6757819620),
[Mpls.St.Paul Magazine](https://mspmag.com/arts-and-culture/new-minneapolis-skyway-app-solves-the-downtown-maze/).

## High value, low-to-medium effort

1. **Accessible (no-stairs) routing toggle.** The router *already
   supports this* (`route(..., { accessible: true })` excludes stairs
   edges, and it's tested) — there's just no UI for it. Calgary's
   Pedesting and HTX Tunnels both lead with ADA-friendly paths; it's
   table stakes for this category and for us it's one switch in the
   directions editor. Pairs naturally with the elevator POIs we already
   extract.

2. **Street-level entrances / "how do I get IN?"** HTX Tunnels' directory
   is organized around *access points* — where you enter the network —
   because that's the newcomer's actual first problem. We already have
   `docs/street-access-research.md` started on exactly this. Surfacing
   known entrances (with hours) as a POI category would answer the #1
   first-timer question no current Minneapolis app answers well.

3. **Route sharing.** The URL already encodes any route (`?from=&to=`);
   the native app just needs a Share button wired to the Web Share API
   (works in WKWebView). Zero new infrastructure.

4. **"Open now" emphasis for the network itself.** skyway.run's whole
   pitch is up-to-date passageway status. We already do time-aware
   routing and closing-soon warnings; a small "network mostly closed —
   showing what's open" state on the map outside business hours would
   make that visible before someone plans a 10pm walk.

## Differentiators worth real thought

5. **Event mode.** Sky Walker was literally created for Super Bowl LII
   crowds ([mplsdid](https://www.mplsdid.com/news_article/show/882229)).
   Vikings/Twins/Wolves game days are when downtown fills with people who
   don't know the skyway. A "game day" preset — route to the stadiums,
   which ramps connect, what's open late — is seasonal marketing gold and
   mostly just curation of data we have (Target Field, U.S. Bank Stadium
   and Target Center are already attached landmarks).

6. **Level-change legibility.** Sky Walker color-codes when a route
   changes level (skyway → street → tunnel). Our routes are skyway-only
   today, but we already flag stairs and open-air stretches per step —
   rendering those as distinct route-line segments on the map (not just
   step-list badges) would communicate "this bit is different" at a
   glance.

7. **Alternate routes.** Calgary Plus15 offers alternate paths. Cheap
   version: second-best route that avoids whatever the first route got
   flagged for (stairs, open-air, closing-soon building).

## Lessons from their failures (what NOT to build)

- **Sky Walker's top review complaint is battery drain** from continuous
  GPS. We track continuously now too — worth a pass to confirm the watch
  pauses when backgrounded (WKWebView suspends JS, so it should) and
  considering lower-accuracy mode when no route is active.
- **Sky Walker sits at 2.7★ largely on data staleness and jank** — its
  map is a static drawing. skyway.run's Reddit reception was good
  *because* it looked current. Our OSM pipeline re-extracts in one
  command; keeping a visible "data updated <month>" stamp costs nothing
  and buys trust.
- **Neither competitor does turn-by-turn progress or drift correction** —
  the two things testers noticed first in SkyMap. That's the moat;
  deepen it before widening.

## Parking-lot (needs a backend or real ops)

- Crowdsourced closure reports with actual distribution (the client-side
  scaffolding exists in `incidents.ts`; see
  `docs/future-backend-design.md`).
- Live transit departures at the Blue/Green line stations we already map.
- Business hours verification loops (the "typical, unverified" hours we
  guess at could be confirmed via the feedback channel).
