import type { Building, Poi, RouteResult } from "./types.ts";
import { googleMapsUrl } from "./share.ts";
import { closingSoonWarnings, formatWeeklyHours, formatWhen, statusAt } from "./hours.ts";

/** Searchable building picker attached to an existing .combo element. */
export class BuildingCombo {
  private input: HTMLInputElement;
  private list: HTMLUListElement;
  private buildings: Building[];
  private selectedId: string | null = null;
  private activeIndex = -1;
  onSelect: ((b: Building) => void) | null = null;

  constructor(root: HTMLElement, buildings: Building[]) {
    this.input = root.querySelector("input")!;
    this.list = root.querySelector(".combo-list")!;
    this.buildings = [...buildings].sort((a, b) => a.name.localeCompare(b.name));

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

  select(b: Building) {
    this.selectedId = b.id;
    this.input.value = b.name;
    this.hide();
    this.onSelect?.(b);
  }

  private matches(query: string): Building[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.buildings;
    return this.buildings.filter(
      (b) => b.name.toLowerCase().includes(q) || b.address.toLowerCase().includes(q),
    );
  }

  private render(query: string) {
    const items = this.matches(query).slice(0, 12);
    this.activeIndex = -1;
    this.list.innerHTML = "";
    for (const b of items) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = b.name;
      const addr = document.createElement("span");
      addr.className = "addr";
      addr.textContent = b.address;
      li.append(name, addr);
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.select(b);
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

  constructor(root: HTMLElement) {
    this.root = root;
    this.content = root.querySelector("#sheet-content")!;
    root.querySelector("#sheet-close")!.addEventListener("click", () => this.hide());
  }

  hide() {
    this.root.hidden = true;
  }

  private show() {
    this.root.hidden = false;
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
    const meta = el("div", b.address, "meta");
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

    this.content.append(h2, meta, badge, hours, note, actionsRow, reachBtn);

    if (pois.length > 0) {
      this.content.append(el("h3", `Inside (${pois.length})`, "poi-heading"));
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
      this.content.append(list);
    }
    this.show();
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

  showRoute(route: RouteResult, when: Date) {
    this.content.innerHTML = "";
    const first = route.steps[0].building;
    const last = route.steps[route.steps.length - 1].building;

    this.content.append(el("h2", `${first.name} → ${last.name}`));

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
    ol.className = "steps";
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
    this.show();
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
