import "./styles.css";
import type { Building, SkymapData } from "./types.ts";
import { SkywayRouter } from "./router.ts";
import { SkymapView, resolveStyle } from "./map.ts";
import { BuildingCombo, Sheet } from "./ui.ts";
import { encodeRouteState, parseRouteState, toLocalIso } from "./share.ts";

async function boot() {
  const res = await fetch("./data/skymap-data.json");
  if (!res.ok) throw new Error(`Could not load skyway data (${res.status})`);
  const data: SkymapData = await res.json();

  const router = new SkywayRouter(data);
  const disclaimer = document.getElementById("disclaimer");
  if (disclaimer && data.meta.disclaimer) disclaimer.textContent = data.meta.disclaimer;
  const sheet = new Sheet(document.getElementById("sheet")!);

  const style = await resolveStyle();
  const view = new SkymapView(document.getElementById("map")!, data, style, (b) => onBuildingTap(b));

  const comboFrom = new BuildingCombo(document.getElementById("combo-from")!, data.buildings);
  const comboTo = new BuildingCombo(document.getElementById("combo-to")!, data.buildings);
  const whenInput = document.getElementById("input-when") as HTMLInputElement;
  const timeRadios = document.querySelectorAll<HTMLInputElement>('input[name="timemode"]');

  function selectedMode(): string {
    return [...timeRadios].find((r) => r.checked)?.value ?? "now";
  }

  function selectedTime(): Date {
    if (selectedMode() === "custom" && whenInput.value) return new Date(whenInput.value);
    return new Date();
  }

  function refreshTimeStyling() {
    view.setTime(selectedTime());
  }

  for (const r of timeRadios) {
    r.addEventListener("change", () => {
      whenInput.disabled = ![...timeRadios].some((x) => x.checked && x.value === "custom");
      if (!whenInput.disabled && !whenInput.value) {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        whenInput.value = now.toISOString().slice(0, 16);
      }
      refreshTimeStyling();
      routeIfReady();
    });
  }
  whenInput.addEventListener("change", () => {
    refreshTimeStyling();
    routeIfReady();
  });

  function routeIfReady() {
    const fromId = comboFrom.value;
    const toId = comboTo.value;
    if (!fromId || !toId) return;
    if (fromId === toId) {
      sheet.showMessage("Same building", "Origin and destination are the same place.");
      return;
    }
    const when = selectedTime();
    const route = router.route(fromId, toId, when);
    if (!route) {
      view.setRoute(null);
      sheet.showMessage(
        "No route found",
        "These buildings aren't connected in the current dataset.",
      );
      return;
    }
    view.setRoute(route);
    sheet.showRoute(route, when);
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
    view.focusBuilding(b);
    sheet.showBuilding(b, selectedTime(), {
      onFrom: () => comboFrom.select(b),
      onTo: () => comboTo.select(b),
    });
  }

  // Restore a shared route from the URL (?from=&to=&at=).
  const initial = parseRouteState(location.search);
  if (initial.when) {
    for (const r of timeRadios) r.checked = r.value === "custom";
    whenInput.disabled = false;
    whenInput.value = toLocalIso(initial.when);
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
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<p style="padding:2rem;font-family:sans-serif">Failed to start Skymap: ${err}</p>`;
});
