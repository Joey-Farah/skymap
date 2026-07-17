import "./styles.css";
import type { Building, Poi, RouteResult, SkymapData } from "./types.ts";
import { SkywayRouter, nearestBuilding, routeStepIndex } from "./router.ts";
import { REACH_BANDS, SkymapView, resolveStyle } from "./map.ts";
import { BuildingCombo, Sheet } from "./ui.ts";
import { encodeRouteState, feedbackUrl, parseRouteState } from "./share.ts";
import { getSavedRamp, saveRamp } from "./ramp.ts";
import { getRecents, recordRecent } from "./recents.ts";
import { activeClosedEdges, reportClosedCrossing } from "./incidents.ts";
import { headingFromOrientation } from "./compass.ts";
import { locateTransition, type LocateMode } from "./locate-mode.ts";
import { GROUP_LABELS } from "./poi.ts";

async function boot() {
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
    searchPanel.classList.remove("idle");
    searchPanel.classList.add("trip-active");
  }
  function expandSearch() {
    tripStrip.hidden = true;
    searchPanel.classList.remove("trip-active", "idle");
  }
  document.getElementById("trip-edit")!.addEventListener("click", expandSearch);

  // Idle: the default, untouched state — a single compact "Where to?" bar,
  // not the full form. Apple Maps shows almost nothing until you actually
  // start searching; this is the single highest-leverage change toward
  // that feel. Tapping the bar reveals both fields; tapping away with
  // nothing entered collapses back.
  const idleBar = document.getElementById("search-idle-bar") as HTMLButtonElement;
  function showIdle() {
    searchPanel.classList.remove("trip-active");
    searchPanel.classList.add("idle");
  }
  function showEditing() {
    searchPanel.classList.remove("idle");
  }
  idleBar.addEventListener("click", () => {
    showEditing();
    // Origin's usually already filled from geolocation (see onPosition
    // below) — send focus straight to the field that actually needs input.
    (comboFrom.value ? document.getElementById("input-to") : document.getElementById("input-from"))?.focus();
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
    const route = router.route(fromId, toId, when, {
      closedEdges: activeClosedEdges(localStorage),
    });
    if (!route) {
      activeRoute = null;
      expandSearch();
      view.setRoute(null);
      sheet.showMessage("No route found", "No skyway connection between these places.");
      return;
    }
    activeRoute = route;
    view.setReach(null);
    view.setRoute(route);
    const fromLabel = comboFrom.label ?? router.building(fromId)!.name;
    const toLabel = comboTo.label ?? router.building(toId)!.name;
    sheet.showRoute(
      route,
      when,
      { from: fromLabel, to: toLabel },
      data.pois ?? [],
      (a, b) => {
        reportClosedCrossing(localStorage, a, b);
        routeIfReady(); // recalculate immediately, same as the spec's live-incident push
      },
    );
    collapseSearch(fromLabel, toLabel);
    // Make the address bar shareable: the URL always describes this route.
    history.replaceState(null, "", encodeRouteState({ fromId, toId, when: null }));
  }

  comboFrom.onSelect = () => routeIfReady();
  comboTo.onSelect = () => routeIfReady();

  document.getElementById("btn-route")!.addEventListener("click", routeIfReady);
  document.getElementById("btn-swap")!.addEventListener("click", () => {
    const from = comboFrom.value ? router.building(comboFrom.value) : null;
    const to = comboTo.value ? router.building(comboTo.value) : null;
    if (to) comboFrom.select(to);
    if (from) comboTo.select(from);
    if (!from && !to) return;
    routeIfReady();
  });

  function onBuildingTap(b: Building) {
    activeRoute = null;
    view.focusBuilding(b);
    sheet.showBuilding(
      b,
      selectedTime(),
      {
        onFrom: () => comboFrom.select(b),
        onTo: () => comboTo.select(b),
        onReach: () => showReach(b),
      },
      poisByBuilding.get(b.id) ?? [],
    );
  }

  function onPoiTap(p: Poi) {
    activeRoute = null;
    const host = router.building(p.buildingId);
    sheet.showPoi(p, host, () => {
      if (host) comboTo.select(host);
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

  function onPosition(lat: number, lon: number) {
    nearBuilding = nearestBuilding(lat, lon, data.buildings, 60);
    if (activeRoute) {
      sheet.updateRouteProgress(routeStepIndex(activeRoute, lat, lon));
    }
    maybePromptSaveRamp(nearBuilding);
    comboFrom.setCurrentLocation(nearBuilding);
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

  function showReach(b: Building) {
    activeRoute = null;
    const when = selectedTime();
    const maxBand = REACH_BANDS[REACH_BANDS.length - 1].maxMinutes;
    const reach = router.reachable(b.id, when, maxBand, {
      closedEdges: activeClosedEdges(localStorage),
    });
    const entries = [...reach.entries()]
      .filter(([id]) => id !== b.id)
      .map(([id, minutes]) => ({ building: router.building(id)!, minutes }));
    const counts = REACH_BANDS.map(
      (band, i) =>
        entries.filter(
          (e) => e.minutes <= band.maxMinutes && (i === 0 || e.minutes > REACH_BANDS[i - 1].maxMinutes),
        ).length,
    );
    view.setRoute(null);
    view.setReach(entries);
    sheet.showReach(b, when, REACH_BANDS, counts, () => {
      view.setReach(null);
      sheet.hide();
    });
  }

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

  if ("serviceWorker" in navigator && !import.meta.env.DEV) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  // --- POI quick-filters: "what's around" at a glance ---------------------
  const filterBar = document.getElementById("poi-filter-bar")!;
  const QUICK_FILTERS: (keyof typeof GROUP_LABELS | null)[] = [
    null,
    "restroom",
    "food",
    "coffee",
    "shop",
    "elevator",
  ];
  for (const group of QUICK_FILTERS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "poi-filter-chip";
    chip.dataset.group = group ?? "all";
    chip.textContent = group ? GROUP_LABELS[group] : "All";
    chip.classList.toggle("active", group === null);
    chip.addEventListener("click", () => {
      filterBar.querySelectorAll<HTMLButtonElement>(".poi-filter-chip").forEach((c) => {
        c.classList.toggle("active", c === chip);
      });
      view.setPoiGroupFilter(group);
    });
    filterBar.appendChild(chip);
  }
  // Only relevant once you can actually see businesses on the map — same
  // threshold the POI icon layer itself uses. Fading it in/out (rather
  // than always-on) is most of what "too much on screen" was about.
  const POI_FILTER_MINZOOM = 14.8;
  function updateFilterBarVisibility() {
    filterBar.classList.toggle("zoomed-out", view.map.getZoom() < POI_FILTER_MINZOOM);
  }
  view.map.on("zoom", updateFilterBarVisibility);
  view.map.on("load", updateFilterBarVisibility);
  updateFilterBarVisibility();

  // Test/debug handle (drives E2E camera positioning).
  (window as unknown as Record<string, unknown>).__skymap = { view, router, data, sheet, onPosition };
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<p style="padding:2rem;font-family:sans-serif">Failed to start SkyMap: ${err}</p>`;
});
