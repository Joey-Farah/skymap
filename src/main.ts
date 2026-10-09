import "./styles.css";
import { Capacitor } from "@capacitor/core";
import type { Building, Poi, RouteResult, SkymapData } from "./types.ts";
import {
  SkywayRouter,
  chargesApproach,
  mainNetworkBuildings,
  nearestApproach,
  routeStepIndex,
  tripMeters,
  tripMinutes,
  skywayDeparture,
  withApproach,
  type Approach,
} from "./router.ts";
import { SkymapView, resolveStyle } from "./map.ts";
import { routeEnd } from "./route-end.ts";
import { BuildingCombo, Sheet } from "./ui.ts";
import { encodeRouteState, parseRouteState } from "./share.ts";
import { FeedbackForm } from "./feedback-form.ts";
import { TipJarCard } from "./tip-jar-card.ts";
import { getRecents, recordRecent } from "./recents.ts";
import { headingFromOrientation } from "./compass.ts";
import { locateTransition, tapPosition, type LocateMode } from "./locate-mode.ts";
import {
  ARRIVAL_LINGER_MS,
  canDismissArrival,
  hasArrived,
  settleRemaining,
  shouldRotate,
} from "./nav-progress.ts";
import { installGeolocation, locationPermission } from "./native-geolocation.ts";
import { locationOffMessage } from "./geolocation-errors.ts";
import { GROUP_COLORS, GROUP_LABELS, isBuildingMarker } from "./poi.ts";
import { CHIP_GROUPS } from "./chips.ts";
import { renderPoiIconDataUrl } from "./poi-icons.ts";
import { clearRetiredKeys } from "./storage.ts";
import { forgetTrip, rememberTrip, tripToResume } from "./trip-resume.ts";
import { UpdatePrompt } from "./update-prompt.ts";

/**
 * How far off the network "Current Location" will still offer to start a
 * trip. Measured across a grid of downtown, 300m covers 85% of the area
 * and 400m nearly all of it; past that you are outside the district the
 * skyway serves, and the nearest building stops being a useful answer.
 */
const MAX_APPROACH_METERS = 400;

async function boot() {
  console.log("[skymap-build-marker] " + new Date().toISOString());
  // Before anything can touch navigator.geolocation — MapLibre's
  // GeolocateControl captures it when the map is constructed below.
  installGeolocation();
  const res = await fetch("./data/skymap-data.json");
  if (!res.ok) throw new Error(`Could not load skyway data (${res.status})`);
  const data: SkymapData = await res.json();

  const router = new SkywayRouter(data);
  // Candidates for "where would I get on the skyway": the one big network,
  // not the isolated two-building bridges. Starting a trip on an island
  // strands you — see mainNetworkBuildings.
  const routableOrigins = mainNetworkBuildings(data);
  const sheet = new Sheet(document.getElementById("sheet")!);
  // Apple tips in the iOS app, Patreon on the web; see tip-jar.ts. Built
  // this early because the nav banner asks it about the arrival line.
  const tipJar = new TipJarCard(showToast);
  void tipJar.load(Capacitor.isNativePlatform());
  const app = document.getElementById("app")!;
  const routeEditor = document.getElementById("route-editor") as HTMLElement;
  const navBanner = document.getElementById("nav-banner") as HTMLElement;
  const searchBarTop = document.getElementById("search-bar-top") as HTMLElement;
  const navInstruction = document.getElementById("nav-instruction")!;
  const navInstructionSub = document.getElementById("nav-instruction-sub")!;

  // The four screens of the Apple Maps flow. Mode lives on #app as a class
  // so CSS can hide/show chrome (locate button, editor, banner) per screen.
  // Search isn't a screen of its own anymore — the top search bar is always
  // on screen except where the From/To editor or nav banner already own
  // that same spot.
  type Mode = "idle" | "card" | "preview" | "nav";
  let mode: Mode = "idle";
  function setMode(m: Mode) {
    app.classList.remove(`mode-${mode}`);
    mode = m;
    app.classList.add(`mode-${mode}`);
    if (m !== "preview") resumePending = false; // left the resumed trip's preview
    routeEditor.hidden = m !== "preview";
    navBanner.hidden = m !== "nav";
    searchBarTop.hidden = m === "preview" || m === "nav";
    updateCameraPadding?.();
  }
  /** Set once the map exists — see below. */
  let updateCameraPadding: (() => void) | null = null;
  /** Reopened mid-trip (see trip-resume.ts): the first fix starts the trip
   * again from there, unless a From was picked or the preview left first. */
  let resumePending = false;
  /** When the trip under way was last written down for a reload. */
  let tripRememberedAt = 0;


  const style = await resolveStyle();
  const view = new SkymapView(
    document.getElementById("map")!,
    data,
    style,
    (b) => onBuildingTap(b),
    (p) => onPoiTap(p),
    (lat, lon) => onPosition(lat, lon),
    (lat, lon) => onRouteTap(lat, lon),
  );

  // Mid-trip the camera centres your dot in the map you can see, between
  // the banner and the sheet, and follows the sheet as it's dragged. Other
  // screens leave the camera alone: re-padding shifts the whole map, and
  // nothing there follows you. Wired here, once the map exists: the sheet
  // and the banner both report sizes before it does.
  let sheetClearance = 0;
  updateCameraPadding = () => {
    if (mode !== "nav") return view.setCameraPadding(null);
    view.setCameraPadding({ top: navBanner.getBoundingClientRect().bottom, bottom: sheetClearance });
  };
  sheet.onClearance = (px) => {
    sheetClearance = px;
    updateCameraPadding?.();
  };
  // The banner is measured as it is shown, before its instruction is
  // filled in; it grows a line or two after that.
  new ResizeObserver(() => updateCameraPadding?.()).observe(navBanner);
  const poisByBuilding = new Map<string, Poi[]>();
  for (const p of data.pois ?? []) {
    // A building's own marker is hosted by the building it names, so without
    // this every marked building listed itself among its interior places —
    // the Marriott's card carrying a "Hotels (1)" section containing the
    // Marriott. The marker exists to draw a pin, not to be a place inside
    // anything. Third consumer to need this guard, after combo.ts and
    // landmarkNear.
    if (isBuildingMarker(p)) continue;
    if (!poisByBuilding.has(p.buildingId)) poisByBuilding.set(p.buildingId, []);
    poisByBuilding.get(p.buildingId)!.push(p);
  }

  const comboFrom = new BuildingCombo(document.getElementById("combo-from")!, data.buildings, data.pois, {
    currentLocation: true,
    revertOnBlur: true,
  });
  const comboTo = new BuildingCombo(document.getElementById("combo-to")!, data.buildings, data.pois, {
    revertOnBlur: true,
  });
  // The drawer's search field (screen 2) — picks a destination, whose place
  // card then owns the Directions step. Separate from the preview editor's
  // To field so each screen keeps its own text state, Apple-style.
  const comboSearch = new BuildingCombo(document.getElementById("combo-search")!, data.buildings, data.pois);

  // Recent destinations replace an unfiltered building dump on empty focus.
  // Both fields share one list — a place you routed *to* is just as worth
  // recalling when picking a *from* next time, and vice versa.
  function refreshRecents() {
    const recents = getRecents(localStorage);
    comboFrom.setRecents(recents);
    comboTo.setRecents(recents);
    comboSearch.setRecents(recents);
  }
  refreshRecents();
  const onRecentWorthy = (b: Building, poi?: Poi) => {
    recordRecent(localStorage, { id: b.id, name: poi?.name ?? b.name, poiId: poi?.id });
    refreshRecents();
  };
  comboFrom.onRecentWorthy = onRecentWorthy;
  comboTo.onRecentWorthy = onRecentWorthy;
  comboSearch.onRecentWorthy = onRecentWorthy;

  // Routing always uses the current moment — no traffic to plan around,
  // and building-hours awareness (a closed building drops out of the
  // graph) already applies live without a departure-time picker.
  function selectedTime(): Date {
    return new Date();
  }

  let activeRoute: RouteResult | null = null;
  /** The place the user picked (screen 3) — what Directions routes to. */
  /** `fromSearch`: the card was opened from the search bar, which still
   * names it. */
  let destination: { b: Building; poi?: Poi; fromSearch?: boolean } | null = null;

  // --- The mode transitions -----------------------------------------------

  function enterIdle() {
    // However the trip ended, a pending auto-dismiss must not fire into
    // whatever comes next and clear it out from under someone.
    if (arrivalTimer) {
      clearTimeout(arrivalTimer);
      arrivalTimer = 0;
    }
    activeRoute = null;
    destination = null;
    forgetTrip(localStorage); // however it ended, it's over
    view.setRoute(null);
    view.forgetCameraHold(); // nothing on screen is holding it now
    // Mode first: the idle sheet's new height re-pads the camera, and read
    // as a mid-trip resize it recentred on the walker as the trip ended.
    setMode("idle");
    sheet.showIdle();
    // Back to a blank slate, not the last thing that was searched for —
    // matches the map itself resetting to no pin, no route.
    //
    // From and To go too. Leaving From set meant the *next* trip silently
    // started from the last one's origin: walk Target Center -> IDS, end,
    // walk on to Wells Fargo, pick a new destination, and the card offered
    // "Directions · 8 min" from your real position while the preview drew
    // an 18-minute route from Target Center — labelled "Current Location ·
    // Target Center", a building you left twenty minutes ago. The stale
    // value also blocked the branch below that fills From in from the live
    // fix, because it only fires when From is empty.
    comboSearch.clear();
    comboFrom.clear();
    comboTo.clear();
    history.replaceState(null, "", location.pathname);
  }

  /** Screen 3: pin + place card. The Directions pill pre-computes the walk
   * time from the live location when there is one — Apple shows the
   * commitment cost on the button itself. */
  function showPlace(b: Building, poi?: Poi, opts: { fromSearch?: boolean } = {}) {
    activeRoute = null;
    destination = { b, poi, fromSearch: opts.fromSearch };
    // The search bar keeps only what was searched for this card. Reached
    // any other way — a map tap after a search — the old query stayed over
    // the new card (QA 042). Cleared, not renamed: a named bar takes the
    // next query typed into it as more of the same name.
    if (!opts.fromSearch) comboSearch.clear();
    // And the address no longer describes a route (QA 020).
    clearRouteUrl();
    view.setRoute(null);
    view.focusBuilding(b);
    renderPlaceCard();
    setMode("card");
  }

  /** The address stops describing a route. Left in place, a reload or a
   * share brought back a route that was no longer on screen (QA 020). */
  function clearRouteUrl() {
    if (location.search) history.replaceState(null, "", location.pathname);
  }

  /** The card for `destination`. The Directions button quotes the walk from
   * the start Directions will actually use: a From still picked by name
   * (QA 016), else where you are. The "From you" row only ever means you.
   * Called again, in place, when location comes or goes under an open card,
   * so it never quotes a walk from a position the app no longer has
   * (QA 011). */
  function renderPlaceCard() {
    if (!destination) return;
    const { b, poi } = destination;
    const named = comboFrom.value && !comboFrom.isCurrentLocation ? router.building(comboFrom.value) : null;
    // Through routeEnd, as the preview routes it: a curated parking ramp is
    // reached through its building, and routed from raw it had no route.
    const originId = (named && routeEnd(named, comboFrom.poi).buildingId) ?? currentApproach?.building.id ?? null;
    // Picking a building by name means you consider yourself in it: no walk.
    const approach = named ? null : currentApproach;
    let directionsLabel: string | undefined;
    // The same preview drives the button label and the card's "From you"
    // row — one route computation, two readings of it. Stays null when
    // there's no live location, and the row is omitted rather than guessed.
    let walk: { minutes: number; meters: number } | null = null;
    const target = routeEnd(b, poi ?? null).buildingId;
    let trip: { minutes: number; meters: number } | null = null;
    if (originId && originId !== target) {
      const preview = router.route(originId, target, skywayDeparture(selectedTime(), approach));
      if (preview) {
        const withWalk = withApproach(preview, approach);
        trip = { minutes: tripMinutes(withWalk), meters: tripMeters(withWalk) };
      }
    } else if (originId && chargesApproach(approach)) {
      // You're outside the building you want: the whole trip is the walk to
      // it, not "you're already here" (QA 013).
      trip = { minutes: approach.minutes, meters: approach.meters };
    }
    if (trip) {
      const minutes = Math.max(1, Math.round(trip.minutes));
      directionsLabel = `Directions · ${minutes} min`;
      if (!named) walk = { minutes, meters: trip.meters };
    }
    const actions = { onDirections: () => enterPreview(), directionsLabel };
    if (poi) sheet.showPoi(poi, b, selectedTime(), actions, walk);
    else sheet.showBuilding(b, selectedTime(), actions, poisByBuilding.get(b.id) ?? []);
  }

  /** Screen 4: From/To editor slides in at the top, route draws, GO waits.
   * From defaults to the live location as a direct consequence of tapping
   * Directions — not a silent background fill. */
  function enterPreview() {
    if (!destination) return;
    setMode("preview");
    comboTo.select(destination.b, destination.poi, { silent: true });
    // Silent: computePreview() below already covers this — a non-silent
    // select would fire comboFrom.onSelect too, computing the preview
    // twice back to back. The second pass raced the sheet's just-started
    // entrance-animation transform and, on some runs, measured content
    // heights against the wrong offsetParent, undersizing the drawer by
    // exactly its own padding and clipping the GO button.
    // Gated on the approach, not the tight "are you in this building"
    // radius: outdoors that radius is empty, so tapping Directions from the
    // street left From blank and answered with "Choose a starting point" —
    // the app declining to route from where you plainly are.
    if (!comboFrom.value && currentApproach) {
      comboFrom.selectCurrentLocation({ silent: true });
      const { lat, lon } = currentApproach.building;
      comboTo.setSearchAnchor({ lat, lon });
    }
    computePreview();
  }

  /** Draws the route From/To describe, for now.
   *
   * `refresh` is the same question asked again later: a preview is a
   * statement about now, and left open it went on promising "Arrive 5:52pm"
   * at 6:05, through a building that had shut at 6 — and GO started that
   * stale route (QA 035). On a refresh, a route that hasn't changed only has
   * its times and warnings brought up to date, without redrawing the line or
   * moving the camera under someone reading it. */
  function computePreview(opts: { refresh?: boolean } = {}) {
    if (mode !== "preview") return;
    const fromId = comboFrom.value;
    const toId = comboTo.value;
    if (!fromId) {
      // Nothing to route from — including when the start was Current
      // Location and location has since gone. Clear the old route rather
      // than leave it drawn (and startable by GO).
      activeRoute = null;
      view.setRoute(null);
      clearRouteUrl();
      sheet.showMessage("Choose a starting point", "Pick where you're starting from above.");
      // Only when asked: a refresh is the app's own doing, and taking focus
      // on it opened the list again every minute.
      if (!opts.refresh) (document.getElementById("input-from") as HTMLInputElement).focus();
      return;
    }
    if (!toId) {
      // Nothing to route to — a swap with an empty From leaves To empty. Say
      // so, rather than leave a "Choose a starting point" that's no longer
      // true on screen.
      activeRoute = null;
      view.setRoute(null);
      clearRouteUrl();
      sheet.showMessage("Choose a destination", "Pick where you're going above.");
      return;
    }
    const from = routeEnd(router.building(fromId)!, comboFrom.poi);
    const to = routeEnd(router.building(toId)!, comboTo.poi);
    if (fromId !== toId && from.buildingId === to.buildingId) {
      // A curated ramp and the building it's reached through: the mapped
      // skyway ends here, and nothing is drawn for the stretch beyond.
      activeRoute = null;
      view.setRoute(null);
      clearRouteUrl();
      // The ramp, not whichever end has a pin: a business marks its own spot too.
      const far = router.building(router.building(fromId)?.skywayAccess ? fromId : toId);
      sheet.showMessage("You're already here", `The skyway doesn't go any closer to ${far?.name ?? "this place"}.`);
      return;
    }
    if (fromId === toId) {
      // Not an invalid pick — the router just has no interior path to draw
      // between two spots in one building. You're already there.
      activeRoute = null;
      view.setRoute(null);
      clearRouteUrl();
      const building = router.building(fromId);
      const toPoi = comboTo.poi;
      const walkIn = comboFrom.approach;
      if (chargesApproach(walkIn)) {
        // Unless you're outside it: Current Location reaches up to 400m, so
        // its building can be the one you asked for while you stand a few
        // blocks away (QA 013). Nothing in the skyway to draw — say the walk.
        const mins = Math.max(1, Math.round(walkIn.minutes));
        sheet.showMessage(
          `${mins} min walk`,
          `${toPoi?.name ?? building?.name ?? "It"} is about ${mins} min away on foot, outside the skyway.`,
        );
        return;
      }
      // A place just outside is reached through the building, not in it —
      // worded as its own card words it (QA 043).
      const outside = toPoi?.nearby ? toPoi : comboFrom.poi?.nearby ? comboFrom.poi : null;
      if (outside) {
        sheet.showMessage(
          "Just outside",
          `${outside.name} is just outside ${building?.name ?? "this building"}, its skyway access — no skyway route to draw.`,
        );
        return;
      }
      sheet.showMessage(
        "You're already here",
        toPoi
          ? `${toPoi.name} is in ${building?.name ?? "this building"} — 0 min away.`
          : `You're already at ${building?.name ?? "this building"}.`,
      );
      return;
    }
    const when = selectedTime();
    const skywayRoute = router.route(from.buildingId, to.buildingId, skywayDeparture(when, comboFrom.approach));
    // Charge the outdoor walk only when From *is* the live position. Picking
    // that same building by name means you consider yourself already in it.
    const route = skywayRoute && withApproach(skywayRoute, comboFrom.approach);
    if (!route) {
      activeRoute = null;
      view.setRoute(null);
      clearRouteUrl();
      // Connected, but not through open doors right now: say that, not
      // that the skyway doesn't go there.
      const closedNow = !skywayRoute && !!router.route(from.buildingId, to.buildingId, null);
      if (closedNow) {
        sheet.showMessage(
          "No open skyway route right now",
          "Every skyway path between these places goes through a building that's closed now.",
        );
      } else sheet.showMessage("No route found", "No skyway connection between these places.");
      return;
    }
    if (opts.refresh && activeRoute && sameRoute(activeRoute, route)) {
      activeRoute = route;
      sheet.refresh(() => sheet.showRoutePreview(route, when, data.pois ?? [], { onGo: () => enterNav() }));
      return;
    }
    activeRoute = route;
    manualPositionUntil = 0;
    // The route itself is building-to-building (that's the network the
    // skyway graph actually models), but when either end is a specific
    // business or a curated ramp, mark its own spot rather than the host
    // building's centroid.
    view.setRoute(route, {
      keepCamera: !!opts.refresh,
      clearTop: routeEditor.getBoundingClientRect().bottom,
      fromCoord: from.coord,
      toCoord: to.coord,
      // A `nearby` place sits outside the network, so the last stretch to
      // its door isn't skyway and mustn't be drawn as though it were.
      fromNearby: from.nearby,
      toNearby: to.nearby,
    });
    sheet.showRoutePreview(route, when, data.pois ?? [], { onGo: () => enterNav() });
    // The URL still describes the route even without a Share button: it
    // keeps the browser's own share/copy working on web, and inbound
    // ?from=&to= links (parsed at boot) still open straight into a preview.
    history.replaceState(null, "", encodeRouteState({ fromId, toId, when: null }));
  }

  /** Same buildings in the same order, with closures judged the same way. */
  function sameRoute(a: RouteResult, b: RouteResult): boolean {
    return (
      a.steps.length === b.steps.length &&
      a.steps.every((s, i) => s.building.id === b.steps[i].building.id)
    );
  }

  /** Screen 5: GO pressed — banner up top, slim bar below, live tracking on. */
  function enterNav() {
    // GO means "this route, now" — and the preview may have been on screen
    // long enough for a building on it to close (QA 035).
    computePreview({ refresh: true });
    if (!activeRoute) return;
    view.finishRouteDraw();
    setMode("nav");
    // Written down in case iOS reloads the page mid-walk, and the address
    // cleared: it names the trip's start, and a reload read it as a link to
    // plan the whole walk again from there (QA 051).
    rememberCurrentTrip();
    clearRouteUrl();
    // A trip that can't see you never moves: with location switched off at
    // the locate button, the banner sat on its first step for the whole walk
    // (the 2026-10-08 user report). GO turns it back on. Not after a denial:
    // MapLibre disables the button then, and only the OS can change that.
    if (watchState() === "OFF" && !locateButton?.disabled) view.geolocate.trigger();
    // And the camera follows you again, wherever the preview left it.
    else view.lockCameraOnWalker();
    manualPositionUntil = 0;
    settledRemaining = null; // a new trip starts with nothing to hold against
    settledAt = null;
    walkedHighWater = null;
    sheet.showNavigating(activeRoute, selectedTime(), data.pois ?? [], { onEnd: () => enterIdle() });
    applyNavProgress(0);
  }

  function rememberCurrentTrip() {
    if (!comboTo.value) return;
    rememberTrip(localStorage, { toId: comboTo.value, poiId: comboTo.poi?.id });
    tripRememberedAt = Date.now();
  }

  function applyNavProgress(fallbackStep: number, raw: number | null = null, offRoute = false) {
    // Held to non-increasing across the trip, so indoor GPS drift can't walk
    // the arrival time backwards — see nav-progress.ts.
    if (raw != null) {
      const now = Date.now();
      settledRemaining = settleRemaining(settledRemaining, raw, settledAt == null ? 0 : now - settledAt);
      settledAt = now;
    }
    if (settledRemaining != null) {
      walkedHighWater = walkedHighWater == null ? settledRemaining : Math.min(walkedHighWater, settledRemaining);
    }
    const remaining = raw == null ? null : settledRemaining;
    // Which building you're in comes from where you are on the drawn line,
    // not from whichever centroid is nearest — see stepIndexFromAlong. The
    // caller's index is only a fallback for before there's any fix to
    // measure with.
    const stepIndex = (activeRoute && remaining != null ? view.stepIndexAt(remaining) : null) ?? fallbackStep;
    const info = sheet.updateNav(stepIndex, new Date(), remaining);
    if (!info) return;
    navInstruction.textContent = info.title;
    // Off the route, the landmark cue is about a step we are no longer sure
    // the walker is on. Saying so beats naming a coffee shop they can't see.
    const arrived = !!activeRoute && hasArrived(stepIndex, activeRoute.steps.length);
    const tipLine = tipJar.arrivalTip(arrived);
    if (offRoute) {
      navInstructionSub.textContent = "Can't see you on the route — showing your last known spot";
    } else if (tipLine) {
      // Only when it isn't already there: replacing it on every fix would
      // swallow a tap that lands between two of them.
      if (navInstructionSub.firstChild !== tipLine) navInstructionSub.replaceChildren(tipLine);
    } else {
      navInstructionSub.replaceChildren(...(info.sub ? [info.sub] : []));
    }
    if (canDismissArrival(arrived, remaining)) scheduleArrivalDismiss();
  }

  /** Arrival ends the trip on its own after a beat. Left alone, "You've
   * arrived" stays on screen with the route still drawn until End is
   * tapped — in the recorded walk that was ~50s of a finished trip still
   * claiming to be under way.
   *
   * Any touch cancels it: the one thing worse than a banner that overstays
   * is the map resetting under someone's finger while they read the step
   * list. Re-arriving after a cancel doesn't reschedule, so a deliberate
   * "leave it up" survives the next position callback. */
  let arrivalTimer = 0;
  function scheduleArrivalDismiss() {
    if (arrivalTimer) return;
    arrivalTimer = window.setTimeout(() => {
      arrivalTimer = 0;
      if (mode === "nav") enterIdle();
    }, ARRIVAL_LINGER_MS);
  }
  /** Touching restarts the countdown rather than cancelling it. Interacting
   * means "not yet", not "never": a latch would let one incidental tap on
   * the map leave the finished trip up until End is pressed, which is the
   * exact defect the timer exists to fix. Keep touching and it keeps
   * waiting; stop, and it ends the trip a beat later. */
  function deferArrivalDismiss() {
    if (!arrivalTimer) return;
    clearTimeout(arrivalTimer);
    arrivalTimer = 0;
    scheduleArrivalDismiss();
  }
  for (const evt of ["pointerdown", "keydown", "wheel"]) {
    document.addEventListener(evt, deferArrivalDismiss, { passive: true });
  }

  // --- Wiring between screens ---------------------------------------------

  sheet.onClose = () => enterIdle(); // card ✕ → back to idle, Apple-style
  document.getElementById("search-cancel")!.addEventListener("click", () => comboSearch.clear());
  document.getElementById("editor-close")!.addEventListener("click", () => {
    // Leaving the preview returns to the place card, like closing Apple's
    // directions panel.
    if (destination) showPlace(destination.b, destination.poi, { fromSearch: destination.fromSearch });
    else enterIdle();
  });

  comboSearch.onSelect = (b, poi) => showPlace(b, poi, { fromSearch: true });
  comboFrom.onSelect = (b) => {
    // Destination searches measure "closest" from the chosen origin.
    comboTo.setSearchAnchor({ lat: b.lat, lon: b.lon });
    computePreview();
  };
  // An abandoned edit puts the field back; the preview follows it back too.
  comboFrom.onRevert = () => computePreview({ refresh: true });
  comboTo.onRevert = () => computePreview({ refresh: true });
  comboTo.onSelect = (b, poi) => {
    destination = { b, poi };
    computePreview();
  };

  document.getElementById("btn-swap")!.addEventListener("click", () => {
    const from = comboFrom.value ? router.building(comboFrom.value) : null;
    const to = comboTo.value ? router.building(comboTo.value) : null;
    const fromPoi = comboFrom.poi;
    const toPoi = comboTo.poi;
    // "Current Location" crosses over as itself, not as whichever building
    // it resolved to: re-selected by name, the walk outside was dropped and
    // swapping twice made the same trip 4 minutes shorter (QA 040).
    const fromHere = comboFrom.isCurrentLocation;
    const toHere = comboTo.isCurrentLocation;
    // An empty side swaps as empty: leaving the field alone put one place
    // in both and answered "You're already here" (QA 018).
    if (toHere) comboFrom.selectCurrentLocation({ silent: true });
    else if (to) comboFrom.select(to, toPoi ?? undefined, { silent: true });
    else comboFrom.clear();
    if (fromHere) comboTo.selectCurrentLocation({ silent: true });
    else if (from) comboTo.select(from, fromPoi ?? undefined, { silent: true });
    else comboTo.clear();
    // Where the trip now goes, as comboTo.onSelect records it. Left behind,
    // closing directions reopened the old destination's card, and its
    // Directions routed from it to itself (QA 014).
    const newTo = comboTo.value ? router.building(comboTo.value) : null;
    destination = newTo ? { b: newTo, poi: comboTo.poi ?? undefined } : null;
    computePreview();
  });

  function onBuildingTap(b: Building) {
    // Navigating, the map is for walking; previewing, it's for reading the
    // route. A tap on a building along it threw the route away, and the
    // card's ✕ then went to an empty map (QA 041).
    if (mode === "nav" || mode === "preview") return;
    showPlace(b);
  }

  function onPoiTap(p: Poi) {
    if (mode === "nav" || mode === "preview") return; // see onBuildingTap
    const host = router.building(p.buildingId);
    if (!host) return;
    // The marker stands for its building, so tapping it opens the building's
    // own card. Routed as a POI it rendered a strictly worse card than the
    // polygon underneath: the name twice over, no interior places, no photo,
    // and a grey "Hours unknown" badge — for 13 of the 20 marked buildings
    // the hours are right there on the building record.
    if (isBuildingMarker(p)) return showPlace(host);
    showPlace(host, p);
  }

  // --- Live position: snap GPS fixes to the nearest network building -----
  // One mechanism for "route from here": the pinned "Current Location" row
  // in the From combo (see BuildingCombo.setCurrentLocation). Used to also
  // have a floating "Near X" pill and a silent auto-fill of From, both
  // doing the same job a different way — direct routing decisions should
  // be something you choose, not something that happens to you, and having
  // three of them meant the auto-fill usually raced ahead of the other two
  // and quietly claimed the field before you saw either.
  /** Where a fix puts you for routing: the nearest way onto the network,
   * reaching well beyond the building you're standing in — see
   * MAX_APPROACH_METERS. */
  let currentApproach: Approach | null = null;

  // GPS drifts indoors — sometimes badly enough to land on the wrong step
  // of a route. Borrowed from Sky Walker (iOS competitor): tapping the
  // route line manually corrects your position. The correction holds for
  // a while rather than being overwritten by the very next (possibly
  // still-drifting) GPS fix, which would defeat the point of tapping at
  // all; automatic updates resume on their own once the window passes.
  const MANUAL_POSITION_GRACE_MS = 45_000;
  let manualPositionUntil = 0;
  /** Smoothed metres-to-go for the trip in progress; null between trips. */
  let settledRemaining: number | null = null;
  /** When settledRemaining last took a reading — see settleRemaining. */
  let settledAt: number | null = null;
  /** Closest to the destination this trip has ever got. The dimmed line is
   * drawn from this rather than from the live figure: skyways run parallel
   * a block apart, so a drifting fix can project onto a neighbouring leg
   * and read as a real detour, which would visibly un-walk a bridge you
   * just crossed. The arrival bar still tells the truth about a detour;
   * the grey line is a record of ground covered, and ground stays covered. */
  let walkedHighWater: number | null = null;

  function onRouteTap(lat: number, lon: number) {
    // A navigation-mode concern: previews are for reading, not walking.
    if (!activeRoute || mode !== "nav") return;
    // Set outright rather than held forward: a tap is someone telling the
    // app where they are, not another noisy sample. Clamping it removed
    // the only way to correct a trip that GPS drift had already pushed too
    // far ahead — the dot would move and the step list, walked line and
    // remaining distance would stay wrong for the rest of the walk.
    const placed = view.setPositionFromTap(lat, lon);
    applyNavProgress(routeStepIndex(activeRoute, lat, lon), placed?.remainingMeters ?? null);
    view.setWalkerPosition(placed?.coord ?? [lon, lat]);
    view.setWalkedProgress(walkedHighWater);
    manualPositionUntil = Date.now() + MANUAL_POSITION_GRACE_MS;
  }

  function onPosition(lat: number, lon: number) {
    // "Where would I join the skyway?" is answerable from well beyond the
    // building you're standing in — most of downtown is more than 60m from
    // the network, so a tight budget here would withhold the From row
    // exactly when someone outdoors wanted it — but only from a building
    // that goes somewhere.
    const approach = nearestApproach(lat, lon, routableOrigins, MAX_APPROACH_METERS, selectedTime());
    if (activeRoute && mode === "nav" && Date.now() >= manualPositionUntil) {
      // The walker stays on the skyway. A fix is evidence, not a position:
      // it moves them as far along the route as walking allows and no
      // further, so there is no longer a case where we hand the screen back
      // to MapLibre's raw dot — which indoors sits a floor below, out in
      // the street, and was the whole of the reported bug.
      const placed = view.trackPosition(lat, lon, Date.now());
      // Still walking: the trip stays worth resuming (see trip-resume.ts).
      if (Date.now() - tripRememberedAt > 15_000) rememberCurrentTrip();
      applyNavProgress(routeStepIndex(activeRoute, lat, lon), placed?.remainingMeters ?? null, !!placed?.offRoute);
      view.setWalkerPosition(placed?.coord ?? null, !!placed?.offRoute);
      // Off-route, the position is the last one we believed rather than a
      // live reading, so the grey walked prefix stops growing with it.
      view.setWalkedProgress(placed && !placed.offRoute ? walkedHighWater : null);
    }
    const movedBuilding = (approach?.building.id ?? null) !== (currentApproach?.building.id ?? null);
    currentApproach = approach;
    comboFrom.setCurrentLocation(approach);
    comboTo.setCurrentLocation(approach); // only ever "Current Location" via swap
    if (resumePending && approach && mode === "preview" && !comboFrom.value) {
      // The first fix after a reload mid-trip: the trip goes on from here.
      resumePending = false;
      comboFrom.selectCurrentLocation({ silent: true });
      enterNav();
    } else if (movedBuilding) followCurrentLocation();
    // Same-name chains rank closest-first from where you actually are;
    // the To field prefers the chosen origin as its anchor when one's set.
    comboFrom.setSearchAnchor({ lat, lon });
    const fromB = comboFrom.value ? router.building(comboFrom.value) : null;
    comboTo.setSearchAnchor(fromB ? { lat: fromB.lat, lon: fromB.lon } : { lat, lon });
  }

  /**
   * Location has stopped: drop everything derived from a fix.
   *
   * The "Current Location" row is the one part of the UI that turns a
   * position into a routing decision, so leaving it on screen after
   * tracking ends offers to route you from wherever you last happened to
   * be — the same confident lie as a frozen walker dot, but harder to
   * notice, since a stale row looks exactly like a live one. The row is
   * built to be absent when there's no fix; this is what makes "no fix"
   * true again.
   */
  function forgetPosition() {
    currentApproach = null;
    comboFrom.setCurrentLocation(null);
    comboTo.setCurrentLocation(null);
    comboFrom.setSearchAnchor(null);
    followCurrentLocation();
  }

  /** Where you are changed buildings, or stopped being known: whatever on
   * screen was measured from it is measured again now — a place card's walk
   * time (QA 011), or a preview that starts from Current Location, which
   * otherwise kept its old route under a label naming the new building until
   * the minute refresh (QA 010). */
  function followCurrentLocation() {
    if (mode === "card") sheet.refresh(renderPlaceCard);
    else if (mode === "preview" && (comboFrom.isCurrentLocation || comboTo.isCurrentLocation)) {
      computePreview({ refresh: true });
    }
  }

  // --- Heading-up tracking: Apple-Maps locate cycle -----------------------
  // Tap 1 centers and tracks, tap 2 rotates the map with your heading,
  // tap 3 turns tracking off. Panning drops heading mode. Pure transitions
  // live in locate-mode.ts; this wires them onto MapLibre's control.
  let orientationHandler: ((e: Event) => void) | null = null;
  /** Last bearing actually pushed to the camera, and when — the compass is
   * rate-limited against these so it stops cancelling recentre animations. */
  let lastBearing: number | null = null;
  let lastBearingAt: number | null = null;

  async function enableCompass(): Promise<boolean> {
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } })
      .DeviceOrientationEvent;
    if (DOE?.requestPermission) {
      try {
        if ((await DOE.requestPermission()) !== "granted") return false;
      } catch {
        return false;
      }
    } else if (!("DeviceOrientationEvent" in window)) {
      return false;
    }
    orientationHandler = (e: Event) => {
      const heading = headingFromOrientation(e as unknown as { webkitCompassHeading?: number; alpha?: number | null });
      if (heading === null) return;
      // Every setBearing cancels whatever camera animation is running, and
      // the geolocate control recentres by animating — so an unfiltered
      // compass leaves the map rotating but never following. See
      // shouldRotate.
      const now = Date.now();
      if (!shouldRotate(lastBearing, heading, lastBearingAt, now)) return;
      lastBearing = heading;
      lastBearingAt = now;
      // geolocateSource marks the rotation as ours: without it the locate
      // control reads the camera move as a user pan and drops its lock.
      view.map.setBearing(heading, { geolocateSource: true });
    };
    window.addEventListener("deviceorientationabsolute", orientationHandler);
    window.addEventListener("deviceorientation", orientationHandler);
    return true;
  }

  function disableCompass(resetBearing: boolean) {
    if (orientationHandler) {
      window.removeEventListener("deviceorientationabsolute", orientationHandler);
      window.removeEventListener("deviceorientation", orientationHandler);
      orientationHandler = null;
    }
    // Re-entering heading mode must apply its first reading immediately
    // rather than measure it against a bearing from the last time.
    lastBearing = null;
    lastBearingAt = null;
    if (resetBearing) view.map.easeTo({ bearing: 0 }, { geolocateSource: true });
  }

  // Transient notice that never touches the sheet — a GPS hiccup mid-route
  // must not wipe the directions off screen.
  const toast = document.getElementById("toast") as HTMLElement;
  let toastTimer = 0;
  function showToast(text: string) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 5000);
  }

  // Feedback goes through the in-app form now. The mailto: it replaced is
  // still in there as the fallback for a failed send or an unconfigured
  // native endpoint — see FeedbackForm.
  const feedbackForm = new FeedbackForm(showToast);
  document.getElementById("feedback-link")!.addEventListener("click", (e) => {
    e.preventDefault();
    feedbackForm.open();
  });
  sheet.onReport = (target, hours) => feedbackForm.open(target, hours);


  let locateMode: LocateMode = "off";
  let compassUnavailable = false; // denied once → cycle degrades to plain on/off
  let toldAboutTimeout = false; // watchPosition retries every 15s; nag once per session
  const locateButton = document.querySelector(
    "button.maplibregl-ctrl-geolocate",
  ) as HTMLButtonElement | null;
  const watchState = () => (view.geolocate as unknown as { _watchState?: string })._watchState;

  async function applyLocate(tr: ReturnType<typeof locateTransition>) {
    if (tr.heading && !orientationHandler) {
      if (!(await enableCompass())) {
        // No compass on this device: stay in plain tracking, and stop
        // intercepting future taps so "off" stays reachable.
        compassUnavailable = true;
        showToast(
          mode === "nav"
            ? "Heading-up mode needs motion access."
            : "Heading-up mode needs motion access — tap again to stop tracking.",
        );
        locateMode = "lock";
        locateButton?.classList.remove("heading-on");
        return;
      }
    }
    if (!tr.heading) disableCompass(tr.resetBearing);
    locateMode = tr.mode;
    locateButton?.classList.toggle("heading-on", tr.mode === "heading");
  }

  // Capture on the control container: it runs before the button's own
  // MapLibre handler, which on a second tap would just turn tracking off.
  locateButton?.parentElement?.addEventListener(
    "click",
    (e) => {
      if (!locateButton.contains(e.target as Node)) return;
      // Read where the tap lands from the control itself, not from
      // locateMode: that copy misses the first fix locking on, and a stale
      // "off" let MapLibre's own handler turn tracking off (QA 037). Whether
      // a tap may stop tracking at all — never mid-trip — is decided in
      // locate-mode.ts.
      const position = tapPosition(watchState(), orientationHandler !== null);
      const tr = locateTransition(position, "tap", { navigating: mode === "nav", compassUnavailable });
      if (tr.intercept) e.stopPropagation();
      if (tr.intercept && position === "error") view.refindWalker();
      void applyLocate(tr);
    },
    true,
  );
  view.geolocate.on("userlocationlostfocus", () => void applyLocate(locateTransition(locateMode, "blur")));
  view.geolocate.on("userlocationfocus", () => void applyLocate(locateTransition(locateMode, "focus")));
  view.geolocate.on("trackuserlocationstart", () => {
    toldAboutTimeout = false;
  });
  view.geolocate.on("error", (err: GeolocationPositionError) => {
    if (err.code === err.PERMISSION_DENIED) {
      // MapLibre goes OFF and disables its button here WITHOUT firing
      // trackuserlocationend — clean up ourselves or a live compass keeps
      // rotating a map no tap can ever reach again.
      void applyLocate(locateTransition(locateMode, "end"));
      // The snapped dot is only ever refreshed by a position callback, so
      // without this it stays frozen on the skyway looking like a live fix
      // long after tracking stopped — a confident lie, which is exactly
      // what the snap is supposed to prevent.
      view.setWalkerPosition(null);
      view.setWalkedProgress(null); // same reason: nothing left to keep it honest
      forgetPosition();
      showToast(locationOffMessage(Capacitor.isNativePlatform()));
    } else {
      // Lost the fix, or no fix yet. Mid-trip the dot would otherwise stay
      // solid where it was, looking live while the walker moves on (QA 039):
      // hold it, greyed, and say so until the next fix redraws it.
      if (mode === "nav" && activeRoute) {
        // Only claim a "last known spot" when there is one on screen: at the
        // start of a trip, before any fix, there isn't.
        navInstructionSub.textContent = view.markWalkerStale()
          ? "No GPS signal here — showing your last known spot"
          : "No GPS signal yet — the directions will follow once it finds you";
      }
      // The native bridge reports a lost fix as code 2, not 3 — same advice.
      if (!toldAboutTimeout) {
        toldAboutTimeout = true;
        showToast("No GPS fix yet — normal deep indoors. It'll catch you near a window or bridge.");
      }
    }
  });
  // Allowing location in Settings after a denial: MapLibre disabled its
  // button for good on the denial, and iOS keeps the app running when access
  // is granted, so without this the app stayed "Location not available"
  // until force-quit (QA 027). Never prompts — it only notices a change.
  async function recheckLocationPermission(retry: boolean) {
    if (document.visibilityState !== "visible" || !locateButton?.disabled) return;
    const state = await locationPermission();
    // Two returns in quick succession both get past the check above before
    // either answer comes back; the second trigger() would turn the first
    // one's tracking straight off again.
    if (!locateButton.disabled || watchState() !== "OFF") return;
    if (state !== "granted") {
      // The plugin can still be holding the pre-Settings answer just after
      // the app comes back: look once more, a moment later.
      if (retry) window.setTimeout(() => void recheckLocationPermission(false), 1500);
      return;
    }
    locateButton.disabled = false;
    locateButton.title = "Find my location";
    locateButton.setAttribute("aria-label", "Find my location");
    view.geolocate.trigger();
  }
  document.addEventListener("visibilitychange", () => void recheckLocationPermission(true));
  view.geolocate.on("trackuserlocationend", () => {
    // Fires both for real off AND for pan-to-background; only the former is
    // "end" (lostfocus already covers the background case).
    if (watchState() === "OFF") {
      void applyLocate(locateTransition(locateMode, "end"));
      // Nothing will update the corrected dot once tracking is off, so it
      // has to go — see the error handler above.
      view.setWalkerPosition(null);
      view.setWalkedProgress(null);
      forgetPosition();
    }
  });

  // --- Category suggestions: "show on map" toggles in the idle sheet ------
  // Live under the map in the rest state, Apple Maps style — not a floating
  // button that inevitably ends up colliding with the search bar or the
  // directions sheet. Opt-in: the map starts with no business icons at all;
  // toggles are multi-select and whatever's on stays on after the sheet
  // closes. Built before enterIdle() below (rather than at boot's end,
  // where this used to live) — enterIdle() measures the idle sheet's real
  // height from its rendered content, and measuring before these pills
  // exist locked in a height sized for an empty row, clipping them once
  // they actually appeared.
  const suggestionsRow = document.getElementById("suggestions-row")!;
  const SUGGESTED_GROUPS = Object.keys(CHIP_GROUPS) as (keyof typeof CHIP_GROUPS)[];
  const activeGroups = new Set<string>();
  for (const group of SUGGESTED_GROUPS) {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "suggestion-pill";
    pill.dataset.group = group;
    pill.setAttribute("aria-pressed", "false");
    const icon = document.createElement("img");
    icon.src = renderPoiIconDataUrl(group, GROUP_COLORS[group]);
    icon.alt = "";
    pill.append(icon, GROUP_LABELS[group]);
    pill.addEventListener("click", () => {
      if (activeGroups.has(group)) activeGroups.delete(group);
      else activeGroups.add(group);
      const on = activeGroups.has(group);
      pill.classList.toggle("active", on);
      pill.setAttribute("aria-pressed", String(on));
      // A chip can stand for more than one group — Misc. carries landmarks.
      view.setPoiGroupFilter([...activeGroups].flatMap((g) => CHIP_GROUPS[g as keyof typeof CHIP_GROUPS]));
    });
    suggestionsRow.appendChild(pill);
  }
  view.setPoiGroupFilter([]); // nothing shown until the user opts in

  // Restore a shared route from the URL (?from=&to=). Routing time is
  // always "now", so a shared link's own departure time (if any, from an
  // older link) isn't restored.
  const initial = parseRouteState(location.search);
  const initialFrom = initial.fromId ? router.building(initial.fromId) : undefined;
  const initialTo = initial.toId ? router.building(initial.toId) : undefined;
  // A trip iOS interrupted by reloading the page: back to it, from wherever
  // the walker has got to — known at the first fix. Unless the address
  // holds a link: GO clears it, so a reload never brings one, and a link
  // there is someone opening it.
  const linked = !!(initial.fromId || initial.toId);
  if (linked) forgetTrip(localStorage);
  const resume = linked ? null : tripToResume(localStorage);
  const resumeTo = resume ? router.building(resume.toId) : undefined;
  if (resume && resumeTo) {
    destination = { b: resumeTo, poi: data.pois?.find((p) => p.id === resume.poiId) };
    clearRouteUrl();
    setMode("preview");
    resumePending = true;
    comboTo.select(destination.b, destination.poi, { silent: true });
    // Asks for a start until the fix comes, without opening the keyboard.
    computePreview({ refresh: true });
    // A fix much later than this is someone reading the preview, not
    // waiting to be carried on.
    setTimeout(() => (resumePending = false), 60_000);
  } else if (initialFrom && initialTo) {
    // A shared link opens straight into the route preview (screen 4).
    destination = { b: initialTo };
    setMode("preview");
    comboFrom.select(initialFrom, undefined, { silent: true });
    comboTo.select(initialTo, undefined, { silent: true });
    computePreview();
  } else {
    enterIdle();
    // A link that only partly resolves — an id renamed by a data refresh —
    // opens what it can and says what it couldn't, rather than a blank map
    // that drops a perfectly good destination (QA 019).
    if (initialTo) {
      showPlace(initialTo);
      if (initial.fromId) showToast("That link's starting point isn't on the map any more.");
    } else if (initialFrom && initial.toId) {
      showToast("That link's destination isn't on the map any more.");
    } else if (initial.fromId || initial.toId) {
      showToast("Couldn't open that link — its places aren't on the map any more.");
    }
  }

  // Keep "open until…" / "closing soon" styling fresh as the clock moves.
  setInterval(() => {
    view.setTime(selectedTime());
    computePreview({ refresh: true }); // only acts while a preview is up
  }, 60_000);
  view.setTime(selectedTime());

  // State outlives the features that wrote it — a native update swaps the
  // bundle and leaves localStorage untouched. See RETIRED_KEYS.
  clearRetiredKeys(localStorage);

  // Last, and deliberately not awaited: whether this copy is out of date is
  // the least urgent thing on screen, and a slow or dead network must not
  // hold up a map someone is already looking at.
  void new UpdatePrompt().check();

  // The service worker's whole job is caching over-the-network requests for
  // the PWA. Inside the native wrapper, assets are already bundled on disk —
  // there's no network round-trip to save, and a stale cached build would
  // just silently survive across native rebuilds. Register it for the real
  // PWA only, and actively clear out any service worker + caches left over
  // from before this app was ever run natively (e.g. testing the PWA first).
  if ("serviceWorker" in navigator) {
    if (Capacitor.isNativePlatform()) {
      void (async () => {
        const regs = await navigator.serviceWorker.getRegistrations();
        if (regs.length === 0) return;
        await Promise.all(regs.map((reg) => reg.unregister()));
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        location.reload();
      })();
    } else if (!import.meta.env.DEV) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  // Test/debug handle (drives E2E camera positioning).
  (window as unknown as Record<string, unknown>).__skymap = {
    view, router, data, sheet, onPosition, onRouteTap,
    modes: { get current() { return mode; }, enterIdle, showPlace, enterPreview, enterNav },
  };
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<p style="padding:2rem;font-family:sans-serif">Failed to start SkyMap: ${err}</p>`;
});
