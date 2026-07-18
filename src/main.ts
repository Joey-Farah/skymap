import "./styles.css";
import { Capacitor } from "@capacitor/core";
import type { Building, Poi, RouteResult, SkymapData } from "./types.ts";
import { SkywayRouter, nearestBuilding, routeStepIndex } from "./router.ts";
import { SkymapView, resolveStyle } from "./map.ts";
import { BuildingCombo, Sheet } from "./ui.ts";
import { encodeRouteState, feedbackUrl, parseRouteState } from "./share.ts";
import { getSavedRamp, saveRamp } from "./ramp.ts";
import { getRecents, recordRecent } from "./recents.ts";
import { headingFromOrientation } from "./compass.ts";
import { locateTransition, type LocateMode } from "./locate-mode.ts";
import { GROUP_COLORS, GROUP_LABELS } from "./poi.ts";
import { renderPoiIconDataUrl } from "./poi-icons.ts";

async function boot() {
  console.log("[skymap-build-marker] " + new Date().toISOString());
  const res = await fetch("./data/skymap-data.json");
  if (!res.ok) throw new Error(`Could not load skyway data (${res.status})`);
  const data: SkymapData = await res.json();

  const router = new SkywayRouter(data);
  const sheet = new Sheet(document.getElementById("sheet")!);
  (document.getElementById("feedback-link") as HTMLAnchorElement).href = feedbackUrl();
  const searchPanel = document.getElementById("search-panel")!;
  const tripStrip = document.getElementById("trip-strip") as HTMLElement;
  const tripFrom = document.getElementById("trip-from")!;
  const tripTo = document.getElementById("trip-to")!;

  function collapseSearch(fromLabel: string, toLabel: string) {
    tripFrom.textContent = fromLabel;
    tripTo.textContent = toLabel;
    tripStrip.hidden = false;
    searchPanel.classList.remove("idle", "picking");
    searchPanel.classList.add("trip-active");
  }
  function expandSearch() {
    tripStrip.hidden = true;
    searchPanel.classList.remove("trip-active", "idle", "picking");
  }
  document.getElementById("trip-edit")!.addEventListener("click", expandSearch);

  // Idle: the default, untouched state — a single compact "Where to?" bar,
  // not the full form. Apple Maps shows almost nothing until you actually
  // start searching; this is the single highest-leverage change toward
  // that feel. Tapping the bar opens search-first "picking" — just the
  // destination field, Apple Maps style — not the full From/To form;
  // tapping away with nothing entered collapses back.
  const idleBar = document.getElementById("search-idle-bar") as HTMLButtonElement;
  function showIdle() {
    searchPanel.classList.remove("trip-active", "picking");
    searchPanel.classList.add("idle");
  }
  function showPicking() {
    searchPanel.classList.remove("idle", "trip-active");
    searchPanel.classList.add("picking");
  }
  function showEditing() {
    searchPanel.classList.remove("idle", "picking");
  }
  idleBar.addEventListener("click", () => {
    showPicking();
    document.getElementById("input-to")?.focus();
  });
  document.addEventListener("click", (e) => {
    if (searchPanel.classList.contains("trip-active")) return;
    if (searchPanel.classList.contains("idle")) return;
    if (comboFrom.value || comboTo.value) return; // mid-search, don't yank it away
    if (searchPanel.contains(e.target as Node)) return;
    // Tapping locate is a normal thing to do mid-search (e.g. reaching for
    // "Current Location") — it shouldn't silently collapse the panel out
    // from under you. Class-checked at click time via closest() rather than
    // holding a reference, since the control isn't created yet this early
    // in boot().
    if ((e.target as HTMLElement).closest(".maplibregl-ctrl-geolocate")) return;
    showIdle();
  });

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

  // Recent destinations replace an unfiltered building dump on empty focus.
  // Both fields share one list — a place you routed *to* is just as worth
  // recalling when picking a *from* next time, and vice versa.
  function refreshRecents() {
    const recents = getRecents(localStorage);
    comboFrom.setRecents(recents);
    comboTo.setRecents(recents);
  }
  refreshRecents();
  const onRecentWorthy = (b: Building) => {
    recordRecent(localStorage, b);
    refreshRecents();
  };
  comboFrom.onRecentWorthy = onRecentWorthy;
  comboTo.onRecentWorthy = onRecentWorthy;

  // Routing always uses the current moment — no traffic to plan around,
  // and building-hours awareness (a closed building drops out of the
  // graph) already applies live without a departure-time picker.
  function selectedTime(): Date {
    return new Date();
  }

  let activeRoute: RouteResult | null = null;

  function routeIfReady() {
    const fromId = comboFrom.value;
    const toId = comboTo.value;
    if (!fromId || !toId) return;
    if (fromId === toId) {
      activeRoute = null;
      expandSearch();
      sheet.showMessage("Same building", "Pick two different places.");
      return;
    }
    const when = selectedTime();
    const route = router.route(fromId, toId, when);
    if (!route) {
      activeRoute = null;
      expandSearch();
      view.setRoute(null);
      sheet.showMessage("No route found", "No skyway connection between these places.");
      return;
    }
    activeRoute = route;
    manualPositionUntil = 0; // a fresh route starts under normal GPS tracking
    // The route itself is building-to-building (that's the network the
    // skyway graph actually models), but when either end is a specific
    // business, mark that business's own precise spot rather than its host
    // building's centroid — inside a large building those can be tens of
    // meters apart, enough to look like the pin missed the destination.
    view.setRoute(route, {
      fromCoord: comboFrom.poi ? [comboFrom.poi.lon, comboFrom.poi.lat] : undefined,
      toCoord: comboTo.poi ? [comboTo.poi.lon, comboTo.poi.lat] : undefined,
    });
    const fromLabel = comboFrom.label ?? router.building(fromId)!.name;
    const toLabel = comboTo.label ?? router.building(toId)!.name;
    sheet.showRoute(route, when, { from: fromLabel, to: toLabel }, data.pois ?? [], () => {
      void shareRoute(`${fromLabel} → ${toLabel}`);
    });
    collapseSearch(fromLabel, toLabel);
    // Make the address bar shareable: the URL always describes this route.
    history.replaceState(null, "", encodeRouteState({ fromId, toId, when: null }));
  }

  /** The URL already encodes any route (?from=&to=) — sharing is just
   * surfacing it. Inside the native shell location.origin is
   * capacitor://localhost, which is meaningless to a recipient, so links
   * are always built against the public web origin. */
  async function shareRoute(label: string) {
    const base = Capacitor.isNativePlatform()
      ? "https://skymap-alpha.vercel.app/"
      : location.origin + location.pathname;
    const url = base + location.search;
    try {
      if (navigator.share) await navigator.share({ title: `SkyMap: ${label}`, url });
      else {
        await navigator.clipboard.writeText(url);
        showToast("Route link copied");
      }
    } catch {
      // Share sheet dismissed, or clipboard denied — neither needs a scold.
    }
  }

  // Search-first (Apple Maps style): picking a destination shows its place
  // card, not an immediate route — "Directions" on that card is the actual
  // routing trigger. Once we're past picking (already in the From/To
  // editor), selecting either field just updates the route directly, same
  // as before tonight.
  comboFrom.onSelect = (b) => {
    // Destination searches measure "closest" from the chosen origin —
    // picking a From re-anchors the To field's chain-name ordering.
    comboTo.setSearchAnchor({ lat: b.lat, lon: b.lon });
    routeIfReady();
  };
  comboTo.onSelect = (b, poi) => {
    if (searchPanel.classList.contains("picking")) {
      showIdle(); // collapse the search chrome — the card takes over
      if (poi) onPoiTap(poi);
      else onBuildingTap(b);
      return;
    }
    routeIfReady();
  };

  document.getElementById("btn-route")!.addEventListener("click", routeIfReady);
  // Swap just swaps the fields — routing is a separate, deliberate action
  // via "Find route", not something that fires the moment you flip origin
  // and destination.
  document.getElementById("btn-swap")!.addEventListener("click", () => {
    const from = comboFrom.value ? router.building(comboFrom.value) : null;
    const to = comboTo.value ? router.building(comboTo.value) : null;
    const fromPoi = comboFrom.poi;
    const toPoi = comboTo.poi;
    // Silent: each combo's onSelect is wired to trigger routing, which
    // collapses the editor back to the one-line trip strip — a plain swap
    // should just swap the fields and leave the editor open, not act as
    // if you'd deliberately picked a new destination.
    if (to) comboFrom.select(to, toPoi ?? undefined, { silent: true });
    if (from) comboTo.select(from, fromPoi ?? undefined, { silent: true });
  });

  /** "Directions" on a place card: destination is whatever you tapped,
   * origin defaults to current location when known (a direct consequence
   * of pressing this button, not the old silent auto-fill), reveal the
   * editor, route. `poi`, when the card was for a specific business rather
   * than a bare building, carries its precise location through so the
   * route marker lands on the business itself, not just its host
   * building's centroid. */
  function showDirections(destination: Building, poi?: Poi) {
    showEditing();
    comboTo.select(destination, poi);
    if (nearBuilding) comboFrom.selectCurrentLocation();
    routeIfReady();
  }

  function onBuildingTap(b: Building) {
    activeRoute = null;
    view.focusBuilding(b);
    sheet.showBuilding(
      b,
      selectedTime(),
      { onDirections: () => showDirections(b) },
      poisByBuilding.get(b.id) ?? [],
    );
  }

  function onPoiTap(p: Poi) {
    activeRoute = null;
    const host = router.building(p.buildingId);
    sheet.showPoi(p, host, () => {
      if (host) showDirections(host, p);
    });
  }

  // --- Live position: snap GPS fixes to the nearest network building -----
  // One mechanism for "route from here": the pinned "Current Location" row
  // in the From combo (see BuildingCombo.setCurrentLocation). Used to also
  // have a floating "Near X" pill and a silent auto-fill of From, both
  // doing the same job a different way — direct routing decisions should
  // be something you choose, not something that happens to you, and having
  // three of them meant the auto-fill usually raced ahead of the other two
  // and quietly claimed the field before you saw either.
  let nearBuilding: Building | null = null;

  // GPS drifts indoors — sometimes badly enough to land on the wrong step
  // of a route. Borrowed from Sky Walker (iOS competitor): tapping the
  // route line manually corrects your position. The correction holds for
  // a while rather than being overwritten by the very next (possibly
  // still-drifting) GPS fix, which would defeat the point of tapping at
  // all; automatic updates resume on their own once the window passes.
  const MANUAL_POSITION_GRACE_MS = 45_000;
  let manualPositionUntil = 0;

  function onRouteTap(lat: number, lon: number) {
    if (!activeRoute) return; // nothing to correct against
    sheet.updateRouteProgress(routeStepIndex(activeRoute, lat, lon));
    view.setManualPosition([lon, lat]);
    manualPositionUntil = Date.now() + MANUAL_POSITION_GRACE_MS;
  }

  function onPosition(lat: number, lon: number) {
    nearBuilding = nearestBuilding(lat, lon, data.buildings, 60);
    if (activeRoute && Date.now() >= manualPositionUntil) {
      sheet.updateRouteProgress(routeStepIndex(activeRoute, lat, lon));
      view.setManualPosition(null); // real GPS is back in control
    }
    maybePromptSaveRamp(nearBuilding);
    comboFrom.setCurrentLocation(nearBuilding);
    // Same-name chains rank closest-first from where you actually are;
    // the To field prefers the chosen origin as its anchor when one's set.
    comboFrom.setSearchAnchor({ lat, lon });
    const fromB = comboFrom.value ? router.building(comboFrom.value) : null;
    comboTo.setSearchAnchor(fromB ? { lat: fromB.lat, lon: fromB.lon } : { lat, lon });
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
    if (nearBuilding) comboFrom.select(nearBuilding);
    comboTo.select(rampBuilding);
  });

  // --- Heading-up tracking: Apple-Maps locate cycle -----------------------
  // Tap 1 centers and tracks, tap 2 rotates the map with your heading,
  // tap 3 turns tracking off. Panning drops heading mode. Pure transitions
  // live in locate-mode.ts; this wires them onto MapLibre's control.
  let orientationHandler: ((e: Event) => void) | null = null;

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
      // geolocateSource marks the rotation as ours: without it the locate
      // control reads the camera move as a user pan and drops its lock.
      if (heading !== null) view.map.setBearing(heading, { geolocateSource: true });
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
      const tr = locateTransition(locateMode, "tap");
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
      showToast("Location is off — allow access in your browser settings to route from where you stand.");
    } else if (err.code === err.TIMEOUT && !toldAboutTimeout) {
      toldAboutTimeout = true;
      showToast("No GPS fix yet — normal deep indoors. It'll catch you near a window or bridge.");
    }
  });
  view.geolocate.on("trackuserlocationend", () => {
    // Fires both for real off AND for pan-to-background; only the former is
    // "end" (lostfocus already covers the background case).
    if (watchState() === "OFF") void applyLocate(locateTransition(locateMode, "end"));
  });

  // Restore a shared route from the URL (?from=&to=). Routing time is
  // always "now", so a shared link's own departure time (if any, from an
  // older link) isn't restored.
  const initial = parseRouteState(location.search);
  const initialFrom = initial.fromId ? router.building(initial.fromId) : undefined;
  const initialTo = initial.toId ? router.building(initial.toId) : undefined;
  if (initialFrom) comboFrom.select(initialFrom);
  if (initialTo) comboTo.select(initialTo);
  // A shared link already has something to show; a cold visit gets the
  // minimal idle bar instead of the full form.
  if (!initialFrom || !initialTo) showIdle();

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

  // --- Category suggestions: "show on map" toggles in the search panel ----
  // They live under the destination field in the picking state (tap "Where
  // to?"), Apple Maps style — not a floating button that inevitably ends up
  // colliding with the search panel or the directions sheet. Opt-in: the
  // map starts with no business icons at all; toggles are multi-select and
  // whatever's on stays on after the panel closes.
  const suggestionsRow = document.getElementById("suggestions-row")!;
  const SUGGESTED_GROUPS = ["coffee", "food", "shop", "restroom", "elevator"] as const;
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
      view.setPoiGroupFilter([...activeGroups]);
    });
    suggestionsRow.appendChild(pill);
  }
  view.setPoiGroupFilter([]); // nothing shown until the user opts in

  // Test/debug handle (drives E2E camera positioning).
  (window as unknown as Record<string, unknown>).__skymap = { view, router, data, sheet, onPosition, onRouteTap };
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<p style="padding:2rem;font-family:sans-serif">Failed to start SkyMap: ${err}</p>`;
});
