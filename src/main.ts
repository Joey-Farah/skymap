import "./styles.css";
import { Capacitor } from "@capacitor/core";
import type { Building, Poi, RouteResult, SkymapData } from "./types.ts";
import {
  SkywayRouter,
  mainNetworkBuildings,
  nearestApproach,
  routeStepIndex,
  tripMeters,
  tripMinutes,
  withApproach,
  type Approach,
} from "./router.ts";
import { SkymapView, resolveStyle } from "./map.ts";
import { BuildingCombo, Sheet } from "./ui.ts";
import { encodeRouteState, parseRouteState } from "./share.ts";
import { FeedbackForm } from "./feedback-form.ts";
import { getSavedRamp, saveRamp } from "./ramp.ts";
import { getRecents, recordRecent } from "./recents.ts";
import { headingFromOrientation } from "./compass.ts";
import { locateTransition, type LocateMode } from "./locate-mode.ts";
import { ARRIVAL_LINGER_MS, canDismissArrival, hasArrived, settleRemaining, shouldRotate } from "./nav-progress.ts";
import { installNativeGeolocation } from "./native-geolocation.ts";
import { GROUP_COLORS, GROUP_LABELS } from "./poi.ts";
import { renderPoiIconDataUrl } from "./poi-icons.ts";

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
  installNativeGeolocation();
  const res = await fetch("./data/skymap-data.json");
  if (!res.ok) throw new Error(`Could not load skyway data (${res.status})`);
  const data: SkymapData = await res.json();

  const router = new SkywayRouter(data);
  // Candidates for "where would I get on the skyway": the one big network,
  // not the isolated two-building bridges. Starting a trip on an island
  // strands you — see mainNetworkBuildings.
  const routableOrigins = mainNetworkBuildings(data);
  const sheet = new Sheet(document.getElementById("sheet")!);
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
    routeEditor.hidden = m !== "preview";
    navBanner.hidden = m !== "nav";
    searchBarTop.hidden = m === "preview" || m === "nav";
  }

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
  const poisByBuilding = new Map<string, Poi[]>();
  for (const p of data.pois ?? []) {
    if (!poisByBuilding.has(p.buildingId)) poisByBuilding.set(p.buildingId, []);
    poisByBuilding.get(p.buildingId)!.push(p);
  }

  const comboFrom = new BuildingCombo(document.getElementById("combo-from")!, data.buildings, data.pois, {
    currentLocation: true,
  });
  const comboTo = new BuildingCombo(document.getElementById("combo-to")!, data.buildings, data.pois);
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
  let destination: { b: Building; poi?: Poi } | null = null;

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
    view.setRoute(null);
    sheet.showIdle();
    setMode("idle");
    // Back to a blank slate, not the last thing that was searched for —
    // matches the map itself resetting to no pin, no route.
    comboSearch.clear();
    history.replaceState(null, "", location.pathname);
  }

  /** Screen 3: pin + place card. The Directions pill pre-computes the walk
   * time from the live location when there is one — Apple shows the
   * commitment cost on the button itself. */
  function showPlace(b: Building, poi?: Poi) {
    activeRoute = null;
    destination = { b, poi };
    view.setRoute(null);
    view.focusBuilding(b);
    let directionsLabel: string | undefined;
    // The same preview drives the button label and the card's "From you"
    // row — one route computation, two readings of it. Stays null when
    // there's no live location, and the row is omitted rather than guessed.
    let walk: { minutes: number; meters: number } | null = null;
    // Quoted from where you actually are, which now includes being outside
    // the network — so the estimate carries the walk to reach it, the same
    // number the route preview will show once you tap through.
    const origin = currentApproach;
    if (origin && origin.building.id !== b.id) {
      const preview = router.route(origin.building.id, b.id, selectedTime());
      if (preview) {
        const trip = withApproach(preview, origin);
        const minutes = Math.max(1, Math.round(tripMinutes(trip)));
        directionsLabel = `Directions · ${minutes} min`;
        walk = { minutes, meters: tripMeters(trip) };
      }
    }
    const actions = { onDirections: () => enterPreview(), directionsLabel };
    if (poi) sheet.showPoi(poi, b, selectedTime(), actions, walk);
    else sheet.showBuilding(b, selectedTime(), actions, poisByBuilding.get(b.id) ?? []);
    setMode("card");
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

  function computePreview() {
    if (mode !== "preview") return;
    const fromId = comboFrom.value;
    const toId = comboTo.value;
    if (!fromId) {
      sheet.showMessage("Choose a starting point", "Pick where you're starting from above.");
      (document.getElementById("input-from") as HTMLInputElement).focus();
      return;
    }
    if (!toId) return;
    if (fromId === toId) {
      // Not an invalid pick — the router just has no interior path to draw
      // between two spots in one building. You're already there.
      activeRoute = null;
      view.setRoute(null);
      const building = router.building(fromId);
      const toPoi = comboTo.poi;
      sheet.showMessage(
        "You're already here",
        toPoi
          ? `${toPoi.name} is in ${building?.name ?? "this building"} — 0 min away.`
          : `You're already at ${building?.name ?? "this building"}.`,
      );
      return;
    }
    const when = selectedTime();
    const skywayRoute = router.route(fromId, toId, when);
    // Charge the outdoor walk only when From *is* the live position. Picking
    // that same building by name means you consider yourself already in it.
    const route = skywayRoute && withApproach(skywayRoute, comboFrom.approach);
    if (!route) {
      activeRoute = null;
      view.setRoute(null);
      sheet.showMessage("No route found", "No skyway connection between these places.");
      return;
    }
    activeRoute = route;
    manualPositionUntil = 0;
    // The route itself is building-to-building (that's the network the
    // skyway graph actually models), but when either end is a specific
    // business, mark that business's own precise spot rather than its host
    // building's centroid.
    view.setRoute(route, {
      fromCoord: comboFrom.poi ? [comboFrom.poi.lon, comboFrom.poi.lat] : undefined,
      toCoord: comboTo.poi ? [comboTo.poi.lon, comboTo.poi.lat] : undefined,
      // A `nearby` place sits outside the network, so the last stretch to
      // its door isn't skyway and mustn't be drawn as though it were.
      fromNearby: comboFrom.poi?.nearby,
      toNearby: comboTo.poi?.nearby,
    });
    sheet.showRoutePreview(route, when, data.pois ?? [], { onGo: () => enterNav() });
    // The URL still describes the route even without a Share button: it
    // keeps the browser's own share/copy working on web, and inbound
    // ?from=&to= links (parsed at boot) still open straight into a preview.
    history.replaceState(null, "", encodeRouteState({ fromId, toId, when: null }));
  }

  /** Screen 5: GO pressed — banner up top, slim bar below, live tracking on. */
  function enterNav() {
    if (!activeRoute) return;
    setMode("nav");
    manualPositionUntil = 0;
    settledRemaining = null; // a new trip starts with nothing to hold against
    walkedHighWater = null;
    furthestStep = 0;
    sheet.showNavigating(activeRoute, selectedTime(), data.pois ?? [], { onEnd: () => enterIdle() });
    applyNavProgress(0);
  }

  function applyNavProgress(stepIndex: number, at?: { lat: number; lon: number }) {
    const raw = at ? view.remainingMeters(at.lat, at.lon) : null;
    // Held to non-increasing across the trip, so indoor GPS drift can't walk
    // the arrival time backwards — see nav-progress.ts.
    if (raw != null) settledRemaining = settleRemaining(settledRemaining, raw);
    if (settledRemaining != null) {
      walkedHighWater = walkedHighWater == null ? settledRemaining : Math.min(walkedHighWater, settledRemaining);
    }
    const remaining = raw == null ? null : settledRemaining;
    const info = sheet.updateNav(stepIndex, new Date(), remaining);
    if (!info) return;
    navInstruction.textContent = info.title;
    navInstructionSub.replaceChildren(...(info.sub ? [info.sub] : []));
    const arrived = !!activeRoute && hasArrived(stepIndex, activeRoute.steps.length);
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
    if (destination) showPlace(destination.b, destination.poi);
    else enterIdle();
  });

  comboSearch.onSelect = (b, poi) => showPlace(b, poi);
  comboFrom.onSelect = (b) => {
    // Destination searches measure "closest" from the chosen origin.
    comboTo.setSearchAnchor({ lat: b.lat, lon: b.lon });
    computePreview();
  };
  comboTo.onSelect = (b, poi) => {
    destination = { b, poi };
    computePreview();
  };

  document.getElementById("btn-swap")!.addEventListener("click", () => {
    const from = comboFrom.value ? router.building(comboFrom.value) : null;
    const to = comboTo.value ? router.building(comboTo.value) : null;
    const fromPoi = comboFrom.poi;
    const toPoi = comboTo.poi;
    if (to) comboFrom.select(to, toPoi ?? undefined, { silent: true });
    if (from) comboTo.select(from, fromPoi ?? undefined, { silent: true });
    computePreview();
  });

  function onBuildingTap(b: Building) {
    if (mode === "nav") return; // navigating: the map is for walking, not browsing
    showPlace(b);
  }

  function onPoiTap(p: Poi) {
    if (mode === "nav") return;
    const host = router.building(p.buildingId);
    if (host) showPlace(host, p);
  }

  // --- Live position: snap GPS fixes to the nearest network building -----
  // One mechanism for "route from here": the pinned "Current Location" row
  // in the From combo (see BuildingCombo.setCurrentLocation). Used to also
  // have a floating "Near X" pill and a silent auto-fill of From, both
  // doing the same job a different way — direct routing decisions should
  // be something you choose, not something that happens to you, and having
  // three of them meant the auto-fill usually raced ahead of the other two
  // and quietly claimed the field before you saw either.
  /** Where a fix puts you for the Save My Ramp prompt: essentially at the
   * building, or nothing. */
  let nearBuilding: Building | null = null;
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
  /** Furthest step this trip has reached. routeStepIndex is a nearest-
   * centroid scan with no memory, so a fix drifting onto a parallel skyway
   * a block away can jump it several buildings and back again. That used
   * to move one highlight border; now it also drives which rows render as
   * already-walked, so an unfiltered index makes the whole list flicker.
   * Held forward for the same reason walkedHighWater is. */
  let furthestStep = 0;
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
    furthestStep = Math.max(furthestStep, routeStepIndex(activeRoute, lat, lon));
    applyNavProgress(furthestStep, { lat, lon });
    view.setWalkerPosition([lon, lat]);
    view.setWalkedProgress(walkedHighWater);
    manualPositionUntil = Date.now() + MANUAL_POSITION_GRACE_MS;
  }

  function onPosition(lat: number, lon: number) {
    // Two different questions, so two different budgets. "Am I parked in
    // this ramp?" has to mean essentially at it, or Save My Ramp offers to
    // remember a ramp you merely walked past. "Where would I join the
    // skyway?" is answerable from much further out — most of downtown is
    // more than 60m from the network, so the tight budget was withholding
    // the From row exactly when someone outdoors wanted it.
    const approach = nearestApproach(lat, lon, routableOrigins, MAX_APPROACH_METERS);
    currentApproach = approach;
    nearBuilding = approach && approach.straightMeters <= 60 ? approach.building : null;
    if (activeRoute && mode === "nav" && Date.now() >= manualPositionUntil) {
      furthestStep = Math.max(furthestStep, routeStepIndex(activeRoute, lat, lon));
      applyNavProgress(furthestStep, { lat, lon });
      // Real GPS is back in control — but drawn on the skyway rather than
      // wherever the fix landed. Past the snap threshold this goes back to
      // null and MapLibre's own dot takes over, which is the honest answer
      // for someone who has actually walked off the route.
      // Only dim from a fix the snapper was willing to believe. Past the
      // threshold the dot honestly falls back to MapLibre's raw position,
      // and drawing a confident grey prefix off that same rejected fix
      // would contradict it on the same screen.
      const snapped = view.snapToActiveRoute(lat, lon);
      view.setWalkerPosition(snapped);
      view.setWalkedProgress(snapped ? walkedHighWater : null);
    }
    maybePromptSaveRamp(nearBuilding);
    comboFrom.setCurrentLocation(approach);
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
    nearBuilding = null;
    currentApproach = null;
    comboFrom.setCurrentLocation(null);
    comboFrom.setSearchAnchor(null);
  }

  // --- Save My Ramp: notice when you're parked, offer a one-tap way back --
  const rampPrompt = document.getElementById("ramp-prompt") as HTMLElement;
  const rampPromptText = document.getElementById("ramp-prompt-text")!;
  const rampReturn = document.getElementById("ramp-return") as HTMLButtonElement;
  let promptedForRampId: string | null = null;

  function refreshRampReturnButton() {
    const ramp = getSavedRamp(localStorage);
    rampReturn.hidden = !ramp;
    if (ramp) rampReturn.textContent = `← Back to ${ramp.name}`;
  }
  refreshRampReturnButton();

  function maybePromptSaveRamp(building: Building | null) {
    if (!building || building.category !== "parking") return;
    const already = getSavedRamp(localStorage);
    if (already?.id === building.id) return; // already saved, nothing to ask
    if (promptedForRampId === building.id) return; // asked this session already
    promptedForRampId = building.id;
    rampPromptText.textContent = `Parked at ${building.name}?`;
    rampPrompt.hidden = false;
  }

  document.getElementById("ramp-prompt-dismiss")!.addEventListener("click", () => {
    rampPrompt.hidden = true;
  });
  document.getElementById("ramp-prompt-save")!.addEventListener("click", () => {
    if (nearBuilding) saveRamp(localStorage, nearBuilding);
    rampPrompt.hidden = true;
    refreshRampReturnButton();
  });
  rampReturn.addEventListener("click", () => {
    const ramp = getSavedRamp(localStorage);
    const rampBuilding = ramp ? router.building(ramp.id) : undefined;
    if (!rampBuilding) return;
    // The button is visible in idle and card mode, which is where someone
    // who parked and walked away actually is. Without this the whole
    // handler was a silent no-op: computePreview() returns immediately
    // unless mode is already "preview", so the combo fields changed and
    // nothing else did.
    setMode("preview");
    // Both selects are silent so the route is computed once, at the end —
    // a non-silent select fires its own computePreview(), and two passes
    // back to back race the sheet's entrance animation (see enterPreview).
    // Same reasoning as enterPreview: whoever is walking back to their ramp
    // is often outdoors, where the tight radius is empty — and selecting it
    // as the *current location* is what charges the walk back to the door.
    if (currentApproach) comboFrom.selectCurrentLocation({ silent: true });
    comboTo.select(rampBuilding, undefined, { silent: true });
    computePreview();
  });

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
        showToast("Heading-up mode needs motion access — tap again to stop tracking.");
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
      // Advance to heading only from a settled lock: while the control is
      // still WAITING (spinner) or errored, its own tap-to-cancel must win,
      // and a denied compass demotes the cycle to plain on/off. locateMode
      // then resolves through the control's end/focus events.
      if (locateMode === "lock" && (compassUnavailable || watchState() !== "ACTIVE_LOCK")) return;
      const tr = locateTransition(locateMode, "tap", { navigating: mode === "nav" });
      if (tr.intercept) e.stopPropagation();
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
      showToast("Location is off — allow access in your browser settings to route from where you stand.");
    } else if (err.code === err.TIMEOUT && !toldAboutTimeout) {
      toldAboutTimeout = true;
      showToast("No GPS fix yet — normal deep indoors. It'll catch you near a window or bridge.");
    }
  });
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
  // Hotels earn a chip: they were searchable but unbrowsable, which for a
  // visitor is close to not being there.
  //
  // Landmarks deliberately have no chip of their own — seven pills wrapped
  // onto three lines and made the panel taller than the map it describes.
  // They ride along with Misc. instead. The *group* stays: landmarkNear
  // picks turn-instruction cues ("past Bill & Marty's") from food, coffee
  // and landmark POIs, so collapsing it in the data would have the nav
  // banner citing dentists and banks as the thing to walk past.
  const CHIP_GROUPS = {
    coffee: ["coffee"],
    food: ["food"],
    hotel: ["hotel"],
    other: ["other", "landmark"],
    restroom: ["restroom"],
    elevator: ["elevator"],
  } as const;
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
  if (initialFrom && initialTo) {
    // A shared link opens straight into the route preview (screen 4).
    destination = { b: initialTo };
    setMode("preview");
    comboFrom.select(initialFrom, undefined, { silent: true });
    comboTo.select(initialTo, undefined, { silent: true });
    computePreview();
  } else {
    enterIdle();
  }

  // Keep "open until…" / "closing soon" styling fresh as the clock moves.
  setInterval(() => view.setTime(selectedTime()), 60_000);
  view.setTime(selectedTime());

  // The per-step "report crossing closed" UI is gone, but reports it filed
  // live in localStorage for 4 hours and used to silently detour routing —
  // with no UI left to see or clear them, a stray old tap would just look
  // like the router picking a bizarre path. Purge on boot until closure
  // reporting returns as a deliberate feature (incidents.ts is kept and
  // tested for that day).
  localStorage.removeItem("skymap.incidents");

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
