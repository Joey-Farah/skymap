import "./styles.css";
import type { Building, Poi, RouteResult, SkymapData } from "./types.ts";
import { SkywayRouter, nearestBuilding, routeStepIndex } from "./router.ts";
import { REACH_BANDS, SkymapView, resolveStyle } from "./map.ts";
import { BuildingCombo, Sheet } from "./ui.ts";
import { encodeRouteState, feedbackUrl, parseRouteState } from "./share.ts";
import { formatMinute, nextOccurrence } from "./hours.ts";
import { getSavedRamp, saveRamp } from "./ramp.ts";

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
    searchPanel.classList.add("trip-active");
  }
  function expandSearch() {
    tripStrip.hidden = true;
    searchPanel.classList.remove("trip-active");
  }
  document.getElementById("trip-edit")!.addEventListener("click", expandSearch);

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
    const route = router.route(fromId, toId, when, { accessible: accessibleInput.checked });
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

  // Keep "leave now" open/closed styling fresh.
  setInterval(refreshTimeStyling, 60_000);
  refreshTimeStyling();

  if ("serviceWorker" in navigator && !import.meta.env.DEV) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  // Test/debug handle (drives E2E camera positioning).
  (window as unknown as Record<string, unknown>).__skymap = { view, router, data, sheet, onPosition };
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<p style="padding:2rem;font-family:sans-serif">Failed to start Skymap: ${err}</p>`;
});
