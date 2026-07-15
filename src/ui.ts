import type { Building, Poi, RouteResult } from "./types.ts";
import { googleMapsUrl } from "./share.ts";
import { CATEGORY_LABELS, GROUP_LABELS, type PoiGroup } from "./poi.ts";
import { haversineMeters } from "./router.ts";
import { buildComboEntries, searchEntries, type ComboEntry } from "./combo.ts";
import { closingSoonWarnings, formatWeeklyHours, formatWhen, statusAt } from "./hours.ts";

/** Searchable building picker attached to an existing .combo element. */
export class BuildingCombo {
  private input: HTMLInputElement;
  private list: HTMLUListElement;
  private buildingsById: Map<string, Building>;
  private entries: ComboEntry[];
  private selectedId: string | null = null;
  private activeIndex = -1;
  onSelect: ((b: Building) => void) | null = null;

  constructor(root: HTMLElement, buildings: Building[], pois: Poi[] = []) {
    this.input = root.querySelector("input")!;
    this.list = root.querySelector(".combo-list")!;
    this.buildingsById = new Map(buildings.map((b) => [b.id, b]));
    this.entries = buildComboEntries(buildings, pois);

    this.input.addEventListener("input", () => {
      this.selectedId = null;
      this.render(this.input.value);
    });
    this.input.addEventListener("focus", () => this.render(this.input.value));
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    document.addEventListener("click", (e) => {
      if (!root.contains(e.target as Node)) this.hide();
    });
  }

  get value(): string | null {
    return this.selectedId;
  }

  /** What's showing in the input — the business name when one was picked, else the building's. */
  get label(): string | null {
    return this.selectedId ? this.input.value : null;
  }

  /** Programmatic selection (sheet actions, swap button) — always a building. */
  select(b: Building) {
    this.selectedId = b.id;
    this.input.value = b.name;
    this.hide();
    this.onSelect?.(b);
  }

  private selectEntry(entry: ComboEntry) {
    const b = this.buildingsById.get(entry.buildingId);
    if (!b) return;
    this.selectedId = entry.buildingId;
    this.input.value = entry.label;
    this.hide();
    this.onSelect?.(b);
  }

  private render(query: string) {
    const items = searchEntries(this.entries, query).slice(0, 12);
    this.activeIndex = -1;
    this.list.innerHTML = "";
    for (const entry of items) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = entry.label;
      const sub = document.createElement("span");
      sub.className = "addr";
      sub.textContent = entry.poiId ? `in ${entry.sublabel}` : entry.sublabel;
      li.append(name, sub);
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.selectEntry(entry);
      });
      this.list.appendChild(li);
    }
    this.list.hidden = items.length === 0;
  }

  private onKey(e: KeyboardEvent) {
    const items = this.list.querySelectorAll("li");
    if (this.list.hidden || items.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      this.activeIndex =
        (this.activeIndex + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items.forEach((li, i) => li.classList.toggle("active", i === this.activeIndex));
      items[this.activeIndex].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const idx = this.activeIndex >= 0 ? this.activeIndex : 0;
      (items[idx] as HTMLElement).dispatchEvent(new MouseEvent("mousedown"));
    } else if (e.key === "Escape") {
      this.hide();
    }
  }

  private hide() {
    this.list.hidden = true;
  }
}

/** Bottom sheet renderer. */
export class Sheet {
  private root: HTMLElement;
  private content: HTMLElement;
  private dragStartY = 0;
  private dragStartExpanded = true;
  private dragging = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.content = root.querySelector("#sheet-content")!;
    root.querySelector("#sheet-close")!.addEventListener("click", () => this.hide());

    const handle = root.querySelector<HTMLElement>("#sheet-handle")!;
    handle.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.dragStartY = e.clientY;
      this.dragStartExpanded = this.root.classList.contains("expanded");
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      // Drag up expands, drag down collapses — a live preview via a class
      // toggle at the halfway point feels responsive without a full
      // continuous-resize implementation.
      const delta = this.dragStartY - e.clientY;
      if (Math.abs(delta) > 20) this.setExpanded(delta > 0);
    });
    handle.addEventListener("pointerup", (e) => {
      const moved = Math.abs(this.dragStartY - e.clientY) > 8;
      this.dragging = false;
      if (!moved) this.setExpanded(!this.dragStartExpanded);
    });
  }

  /** Peek shows just the summary; expanded shows full content. Always togglable via the handle. */
  private setExpanded(expanded: boolean) {
    this.root.classList.toggle("expanded", expanded);
    this.root.classList.toggle("peek", !expanded);
  }

  hide() {
    this.root.hidden = true;
  }

  private show(expanded = true) {
    this.root.hidden = false;
    this.setExpanded(expanded);
  }

  showBuilding(
    b: Building,
    when: Date,
    actions: { onFrom: () => void; onTo: () => void; onReach: () => void },
    pois: Poi[] = [],
  ) {
    const status = statusAt(b, when);
    this.content.innerHTML = "";

    const h2 = el("h2", b.name);
    const kind = CATEGORY_LABELS[b.category];
    const meta = el("div", kind ? `${kind} · ${b.address}` : b.address, "meta");
    const badge = el("span", status.open ? status.label : status.label, `badge ${status.open ? "open" : "closed"}`);
    const hours = el("div", `Skyway hours: ${formatWeeklyHours(b.hours)}`, "hours-line");
    const note = el("div", b.hoursNote, "meta");

    const actionsRow = document.createElement("div");
    actionsRow.className = "actions";
    const fromBtn = el("button", "Route from here");
    const toBtn = el("button", "Route to here", "primary");
    fromBtn.addEventListener("click", actions.onFrom);
    toBtn.addEventListener("click", actions.onTo);
    actionsRow.append(fromBtn, toBtn);

    const reachBtn = el("button", "What's within 15 minutes?", "reach-btn");
    reachBtn.addEventListener("click", actions.onReach);

    // Everything past the essentials collapses away in peek mode.
    const more = document.createElement("div");
    more.className = "sheet-collapsible";
    more.append(actionsRow, reachBtn);

    const interior = pois.filter((p) => !p.exterior);
    const transit = pois.filter((p) => p.exterior);
    const order: PoiGroup[] = ["food", "shop", "service", "restroom", "landmark"];
    for (const group of order) {
      const members = interior.filter((p) => p.group === group);
      if (members.length === 0) continue;
      more.append(el("h3", `${GROUP_LABELS[group]} (${members.length})`, "poi-heading"));
      more.append(this.poiList(members));
    }
    if (transit.length > 0) {
      more.append(el("h3", GROUP_LABELS.transit, "poi-heading"));
      const list = document.createElement("ul");
      list.className = "poi-list";
      for (const p of transit.slice(0, 4)) {
        const li = document.createElement("li");
        const ft = Math.round(haversineMeters(p.lat, p.lon, b.lat, b.lon) * 3.28084);
        li.append(
          el("span", p.name),
          el("span", p.category === "bus_stop" ? "Bus" : "Light rail", "poi-cat"),
          el("span", `${ft} ft`, "poi-gmaps"),
        );
        list.appendChild(li);
      }
      more.append(list);
    }
    this.content.append(h2, meta, badge, hours, note, more);
    this.show();
  }

  private poiList(pois: Poi[]): HTMLElement {
    const list = document.createElement("ul");
    list.className = "poi-list";
    for (const p of [...pois].sort((a, b) => a.name.localeCompare(b.name))) {
      const li = document.createElement("li");
      li.append(el("span", p.name), el("span", humanCategory(p.category), "poi-cat"));
      const link = document.createElement("a");
      link.href = googleMapsUrl(p);
      link.target = "_blank";
      link.rel = "noopener";
      link.className = "poi-gmaps";
      link.textContent = "Maps ↗";
      li.append(link);
      list.appendChild(li);
    }
    return list;
  }

  /** Card for a single business tapped on the map. */
  showPoi(p: Poi, host: Building | undefined, onRouteTo: () => void) {
    this.content.innerHTML = "";
    this.content.append(el("h2", p.name));
    const where = host ? `${humanCategory(p.category)} · ${host.name}` : humanCategory(p.category);
    this.content.append(el("div", where, "meta"));
    if (p.level === "1") this.content.append(el("span", "Skyway level", "badge open"));
    if (p.openingHours) this.content.append(el("div", `Hours: ${p.openingHours}`, "hours-line"));

    const actionsRow = document.createElement("div");
    actionsRow.className = "actions";
    const gmaps = document.createElement("a");
    gmaps.href = googleMapsUrl(p);
    gmaps.target = "_blank";
    gmaps.rel = "noopener";
    gmaps.className = "gmaps-btn";
    gmaps.textContent = "Open in Google Maps ↗";
    const toBtn = el("button", "Route here", "primary");
    toBtn.addEventListener("click", onRouteTo);
    actionsRow.append(gmaps, toBtn);
    this.content.append(actionsRow);
    this.show();
  }

  /** Isochrone legend for the reach overlay. */
  showReach(
    origin: Building,
    when: Date,
    bands: readonly { maxMinutes: number; color: string }[],
    counts: number[],
    onClear: () => void,
  ) {
    this.content.innerHTML = "";
    this.content.append(el("h2", `Within reach of ${origin.name}`));
    this.content.append(el("div", `Leaving ${formatWhen(when)} · entirely indoors`, "meta"));

    const legend = document.createElement("ul");
    legend.className = "legend";
    let prev = 0;
    bands.forEach((band, i) => {
      const li = document.createElement("li");
      const dot = el("span", "", "legend-dot");
      dot.style.background = band.color;
      li.append(
        dot,
        el("span", `${prev}–${band.maxMinutes} min`),
        el("span", `${counts[i]} building${counts[i] === 1 ? "" : "s"}`, "legend-count"),
      );
      legend.appendChild(li);
      prev = band.maxMinutes;
    });
    this.content.append(legend);

    const clear = el("button", "Clear reach map", "reach-btn");
    clear.addEventListener("click", onClear);
    this.content.append(clear);
    this.show();
  }

  showRoute(route: RouteResult, when: Date, labels?: { from?: string; to?: string }) {
    this.content.innerHTML = "";
    const first = route.steps[0].building;
    const last = route.steps[route.steps.length - 1].building;

    this.content.append(el("h2", `${labels?.from ?? first.name} → ${labels?.to ?? last.name}`));

    if (route.ignoredClosures) {
      this.content.append(
        el(
          "span",
          "⚠ No fully open route at this time — showing the path ignoring closures",
          "badge warn",
        ),
      );
    } else {
      const warnings = closingSoonWarnings(route, when);
      for (const w of warnings.slice(0, 2)) {
        this.content.append(el("span", `⚠ ${w.label}`, "badge warn"));
      }
      if (warnings.length > 2) {
        this.content.append(el("span", `⚠ ${warnings.length - 2} more buildings closing soon`, "badge warn"));
      }
    }

    const summary = document.createElement("div");
    summary.className = "route-summary";
    summary.append(
      el("span", `${Math.max(1, Math.round(route.totalMinutes))} min`, "big"),
      el("span", formatDistance(route.totalMeters), "sub"),
      el("span", `${route.steps.length} buildings · fully indoors`, "sub"),
    );
    this.content.append(summary);

    const ol = document.createElement("ul");
    ol.className = "steps sheet-collapsible";
    for (const step of route.steps) {
      const li = document.createElement("li");
      const closedHere = !isOpenLabelOk(step.building, when);
      li.append(el("span", step.building.name + (closedHere ? " (closed)" : "")));
      if (step.viaCrossing) {
        // OSM often names every bridge "Minneapolis Skyway" — say something
        // shorter than "Cross over Minneapolis Skyway" on every step.
        const generic = /^(minneapolis )?skyway$/i.test(step.viaCrossing.trim());
        li.prepend(el("span", generic ? "Via skyway" : `Cross over ${step.viaCrossing}`, "via"));
      }
      ol.appendChild(li);
    }
    this.content.append(ol);
    // Peek: the summary line is the win, the full turn list can crowd out
    // the map it's describing — drag the handle up (or tap it) for that.
    this.show(false);
  }

  showMessage(title: string, body: string) {
    this.content.innerHTML = "";
    this.content.append(el("h2", title), el("div", body, "meta"));
    this.show();
  }
}

/** "fast_food" -> "Fast food". */
function humanCategory(cat: string): string {
  const words = cat.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isOpenLabelOk(b: Building, when: Date): boolean {
  return statusAt(b, when).open;
}

function formatDistance(meters: number): string {
  const miles = meters / 1609.34;
  return miles >= 0.095 ? `${miles.toFixed(1)} mi` : `${Math.round(meters * 3.28084)} ft`;
}

function el(tag: string, text?: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
