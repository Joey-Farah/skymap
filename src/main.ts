import "./styles.css";
import type { Building, Poi, RouteResult, SkymapData } from "./types.ts";
import { SkywayRouter, nearestBuilding, routeStepIndex } from "./router.ts";
import { REACH_BANDS, SkymapView, resolveStyle } from "./map.ts";
import { BuildingCombo, Sheet } from "./ui.ts";
import { encodeRouteState, feedbackUrl, parseRouteState } from "./share.ts";
import { formatMinute, nextOccurrence } from "./hours.ts";
import { getSavedRamp, saveRamp } from "./ramp.ts";
import { activeClosedEdges, reportClosedCrossing } from "./incidents.ts";
import { headingFromOrientation } from "./compass.ts";
import { classifyWeather, fetchWeather } from "./weather.ts";
import { GROUP_LABELS } from "./poi.ts";

async function boot() {
  const res = await fetch("./data/skymap-data.json");
  if (!res.ok) throw new Error(`Could not load skyway data (${res.status})`);
  const data: SkymapData = await res.json();

  const router = new SkywayRouter(data);
  const disclaimer = document.getElementById("disclaimer");
  if (disclaimer && data.meta.disclaimer) disclaimer.textContent = data.meta.disclaimer;
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
  // that feel. Tapping the bar reveals everything (weather, both fields,
  // time/accessibility options); tapping away with nothing entered
  // collapses back.
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

  const comboFrom = new BuildingCombo(document.getElementById("combo-from")!, data.buildings, data.pois);
  const comboTo = new BuildingCombo(document.getElementById("combo-to")!, data.buildings, data.pois);
  const timeRadios = document.querySelectorAll<HTMLInputElement>('input[name="timemode"]');

  // --- Time scrubber: day chips + a slider through the day ---------------
  const scrubber = document.getElementById("scrubber")!;
  const scrubLabel = document.getElementById("scrub-label")!;
  const slider = document.getElementById("time-slider") as HTMLInputElement;
  const dayChips = document.getElementById("day-chips")!;
  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let scrubDay = new Date().getDay();

  for (const day of [1, 2, 3, 4, 5, 6, 0]) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "day-chip";
    chip.dataset.day = String(day);
    chip.textContent = DAY_LABELS[day];
    chip.addEventListener("click", () => {
      setScrubDay(day);
      refreshTimeStyling();
      routeIfReady();
    });
    dayChips.appendChild(chip);
  }

  function setScrubDay(day: number) {
    scrubDay = day;
    dayChips.querySelectorAll<HTMLButtonElement>(".day-chip").forEach((c) => {
      c.classList.toggle("active", Number(c.dataset.day) === day);
    });
  }

  function setScrubTo(when: Date) {
    setScrubDay(when.getDay());
    slider.value = String(when.getHours() * 60 + Math.floor(when.getMinutes() / 15) * 15);
  }

  function selectedMode(): string {
    return [...timeRadios].find((r) => r.checked)?.value ?? "now";
  }

  function selectedTime(): Date {
    if (selectedMode() === "custom") return nextOccurrence(scrubDay, Number(slider.value));
    return new Date();
  }

  function updateScrubLabel() {
    const custom = selectedMode() === "custom";
    scrubLabel.textContent = custom
      ? `${DAY_LABELS[scrubDay]} ${formatMinute(Number(slider.value))}`
      : "";
  }

  function refreshTimeStyling() {
    updateScrubLabel();
    view.setTime(selectedTime());
  }

  for (const r of timeRadios) {
    r.addEventListener("change", () => {
      const custom = selectedMode() === "custom";
      scrubber.hidden = !custom;
      if (custom) setScrubTo(new Date());
      refreshTimeStyling();
      routeIfReady();
    });
  }
  // Dragging restyles the network live; recompute the route on release.
  slider.addEventListener("input", refreshTimeStyling);
  slider.addEventListener("change", () => routeIfReady());

  let activeRoute: RouteResult | null = null;
  const accessibleInput = document.getElementById("input-accessible") as HTMLInputElement;
  accessibleInput.addEventListener("change", () => routeIfReady());

  function routeIfReady() {
    const fromId = comboFrom.value;
    const toId = comboTo.value;
    if (!fromId || !toId) return;
    if (fromId === toId) {
      activeRoute = null;
      expandSearch();
      sheet.showMessage("Same building", "Origin and destination are the same place.");
      return;
    }
    const when = selectedTime();
    const route = router.route(fromId, toId, when, {
      accessible: accessibleInput.checked,
      closedEdges: activeClosedEdges(localStorage),
    });
    if (!route) {
      activeRoute = null;
      expandSearch();
      view.setRoute(null);
      sheet.showMessage(
        "No route found",
        accessibleInput.checked
          ? "No stairs-free path connects these buildings in the current dataset."
          : "These buildings aren't connected in the current dataset.",
      );
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
      { from: fromLabel, to: toLabel, accessible: accessibleInput.checked },
      data.pois ?? [],
      (a, b) => {
        reportClosedCrossing(localStorage, a, b);
        routeIfReady(); // recalculate immediately, same as the spec's live-incident push
      },
    );
    collapseSearch(fromLabel, toLabel);
    // Make the address bar shareable: the URL always describes this route.
    history.replaceState(
      null,
      "",
      encodeRouteState({ fromId, toId, when: selectedMode() === "custom" ? when : null }),
    );
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
  const nearYou = document.getElementById("near-you") as HTMLButtonElement;
  let nearBuilding: Building | null = null;
  nearYou.addEventListener("click", () => {
    if (nearBuilding) comboFrom.select(nearBuilding);
  });

  function onPosition(lat: number, lon: number) {
    nearBuilding = nearestBuilding(lat, lon, data.buildings, 60);
    if (nearBuilding) {
      const dot = document.createElement("span");
      dot.className = "dot";
      const label = document.createElement("span");
      label.textContent = `Near ${nearBuilding.name}`;
      nearYou.replaceChildren(dot, label);
      nearYou.hidden = false;
    } else {
      nearYou.hidden = true;
    }
    if (activeRoute) {
      sheet.updateRouteProgress(routeStepIndex(activeRoute, lat, lon));
    }
    maybePromptSaveRamp(nearBuilding);
    // Apple-Maps-style implicit origin: quietly fill From with wherever you
    // are, so the common case is "just type a destination." Never
    // overwrites a real selection — only ever touches an empty field.
    if (nearBuilding && !comboFrom.value) comboFrom.select(nearBuilding);
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

  // --- Compass mode: rotate the map to match the phone's heading ---------
  const compassToggle = document.getElementById("compass-toggle") as HTMLButtonElement;
  let compassActive = false;
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
      if (heading !== null) view.map.setBearing(heading);
    };
    window.addEventListener("deviceorientationabsolute", orientationHandler);
    window.addEventListener("deviceorientation", orientationHandler);
    return true;
  }

  function disableCompass() {
    if (orientationHandler) {
      window.removeEventListener("deviceorientationabsolute", orientationHandler);
      window.removeEventListener("deviceorientation", orientationHandler);
      orientationHandler = null;
    }
    view.map.setBearing(0);
  }

  compassToggle.addEventListener("click", async () => {
    if (compassActive) {
      disableCompass();
      compassActive = false;
      compassToggle.classList.remove("active");
      return;
    }
    const ok = await enableCompass();
    if (ok) {
      compassActive = true;
      compassToggle.classList.add("active");
    } else {
      sheet.showMessage(
        "Compass unavailable",
        "Your browser or device doesn't support heading-based rotation, or permission was denied.",
      );
    }
  });

  function showReach(b: Building) {
    activeRoute = null;
    const when = selectedTime();
    const maxBand = REACH_BANDS[REACH_BANDS.length - 1].maxMinutes;
    const reach = router.reachable(b.id, when, maxBand);
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

  // Restore a shared route from the URL (?from=&to=&at=).
  const initial = parseRouteState(location.search);
  if (initial.when) {
    for (const r of timeRadios) r.checked = r.value === "custom";
    scrubber.hidden = false;
    setScrubTo(initial.when);
  }
  const initialFrom = initial.fromId ? router.building(initial.fromId) : undefined;
  const initialTo = initial.toId ? router.building(initial.toId) : undefined;
  if (initialFrom) comboFrom.select(initialFrom);
  if (initialTo) comboTo.select(initialTo);
  // A shared link already has something to show; a cold visit gets the
  // minimal idle bar instead of the full form.
  if (!initialFrom || !initialTo) showIdle();

  // Keep "leave now" open/closed styling fresh.
  setInterval(refreshTimeStyling, 60_000);
  refreshTimeStyling();

  if ("serviceWorker" in navigator && !import.meta.env.DEV) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  // Weather-aware framing: since every Skymap route is already indoors,
  // there's no outdoor alternative to switch to — just honest context on
  // why the climate-controlled path is (or isn't) worth caring about today.
  const weatherLine = document.getElementById("weather-line") as HTMLElement;
  fetchWeather(44.976, -93.2697).then((reading) => {
    if (!reading) return; // fails silently — never blocks the app
    const { harsh, label } = classifyWeather(reading);
    weatherLine.textContent = harsh
      ? `${label} outside — good thing this route stays indoors the whole way.`
      : `${label} outside — the skyway's still fully climate-controlled if you'd rather stay in.`;
    weatherLine.classList.toggle("harsh", harsh);
    weatherLine.hidden = false;
  });

  // --- POI quick-filters: "what's around" at a glance ---------------------
  const filterBar = document.getElementById("poi-filter-bar")!;
  const QUICK_FILTERS: (keyof typeof GROUP_LABELS | null)[] = [null, "restroom", "food", "shop", "elevator"];
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
  document.body.innerHTML = `<p style="padding:2rem;font-family:sans-serif">Failed to start Skymap: ${err}</p>`;
});
