import type { Building, Poi, RouteResult } from "./types.ts";
import { reportIssueUrl } from "./share.ts";
import { CATEGORY_LABELS, GROUP_LABELS, landmarkNear, type PoiGroup } from "./poi.ts";
import { haversineMeters } from "./router.ts";
import { buildComboEntries, searchEntries, type ComboEntry } from "./combo.ts";

/** Single-letter result-row monogram per icon group — kept legible without emoji. */
const RESULT_ICON_LETTER: Record<string, string> = {
  building: "B",
  food: "F",
  shop: "S",
  service: "•",
  restroom: "R",
  elevator: "E",
  landmark: "L",
  transit: "T",
};
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
      const icon = document.createElement("span");
      icon.className = `result-icon icon-${entry.icon}`;
      icon.textContent = RESULT_ICON_LETTER[entry.icon] ?? "•";
      const text = document.createElement("span");
      text.className = "result-text";
      const name = document.createElement("span");
      name.className = "result-name";
      name.textContent = entry.label;
      const sub = document.createElement("span");
      sub.className = "addr";
      sub.textContent = entry.poiId ? `in ${entry.sublabel}` : entry.sublabel;
      text.append(name, sub);
      li.append(icon, text);
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
  private stepsListEl: HTMLUListElement | null = null;
  private progressPromptEl: HTMLElement | null = null;
  private activeRoute: RouteResult | null = null;
  private routePois: Poi[] = [];
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
    this.clearRouteProgress();
  }

  private clearRouteProgress() {
    this.stepsListEl = null;
    this.progressPromptEl = null;
    this.activeRoute = null;
    this.routePois = [];
  }

  /**
   * Called on every live position update while a route is showing: moves
   * the "current step" highlight and swaps the prompt to the next crossing.
   * No-op once the sheet has moved on to something else.
   */
  updateRouteProgress(stepIndex: number) {
    if (!this.stepsListEl || !this.progressPromptEl || !this.activeRoute) return;
    this.stepsListEl.querySelectorAll("li").forEach((li, i) => {
      li.classList.toggle("current", i === stepIndex);
    });
    const next = this.activeRoute.steps[stepIndex + 1];
    if (!next) {
      this.progressPromptEl.textContent = "You've arrived";
    } else {
      const crossing = next.viaCrossing ?? "";
      const generic = /^(minneapolis )?skyway$/i.test(crossing.trim());
      const verb = next.hasSteps
        ? "Take the stairs into"
        : generic || !crossing
          ? "Head into"
          : `Cross over ${crossing} into`;
      const landmark = landmarkNear(this.routePois, next.building.id);
      this.progressPromptEl.replaceChildren(`${verb} ${next.building.name}`);
      if (landmark) this.progressPromptEl.append(", ", landmarkCue(landmark));
    }
    this.progressPromptEl.hidden = false;
  }

  private show(expanded = true) {
    this.root.hidden = false;
    this.setExpanded(expanded);
    // Retrigger the content fade-in even when the sheet was already open
    // (e.g. tapping a different building) — a hard content swap otherwise
    // reads as a glitch rather than a transition.
    this.content.classList.remove("content-enter");
    void this.content.offsetWidth; // force reflow so the animation restarts
    this.content.classList.add("content-enter");
  }

  showBuilding(
    b: Building,
    when: Date,
    actions: { onFrom: () => void; onTo: () => void; onReach: () => void },
    pois: Poi[] = [],
  ) {
    const status = statusAt(b, when);
    this.content.innerHTML = "";
    this.clearRouteProgress();

    const h2 = el("h2", b.name);
    const kind = CATEGORY_LABELS[b.category];
    // "Minneapolis" is the extraction's placeholder for a missing address —
    // showing it says nothing the map doesn't already.
    const address = b.address === "Minneapolis" ? "" : b.address;
    const metaText = [kind, address].filter(Boolean).join(" · ");
    const meta = el("div", metaText, "meta");
    const badge = el("span", status.open ? status.label : status.label, `badge ${status.open ? "open" : "closed"}`);
    const hours = el("div", `Hours: ${formatWeeklyHours(b.hours)}`, "hours-line");
    // Real per-building hours come from OSM tags when present; the generic
    // schedule is a guess, and guesses should say so rather than pass as fact.
    if (b.hoursNote.startsWith("Default")) {
      hours.append(el("span", " (typical, unverified)", "hours-unverified"));
    }

    const actionsRow = document.createElement("div");
    actionsRow.className = "actions";
    const fromBtn = el("button", "Route from here");
    const toBtn = el("button", "Route to here", "primary");
    fromBtn.addEventListener("click", actions.onFrom);
    toBtn.addEventListener("click", actions.onTo);
    actionsRow.append(fromBtn, toBtn);

    const reachBtn = el("button", "Within 15 min", "reach-btn");
    reachBtn.addEventListener("click", actions.onReach);

    // Everything past the essentials collapses away in peek mode.
    const more = document.createElement("div");
    more.className = "sheet-collapsible";
    if (b.image) more.append(this.landmarkPhoto(b.image));
    more.append(actionsRow, reachBtn);

    const interior = pois.filter((p) => !p.exterior);
    const transit = pois.filter((p) => p.exterior);
    const order: PoiGroup[] = ["food", "shop", "service", "restroom", "elevator", "landmark"];
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
          el("span", `${ft} ft`, "poi-distance"),
        );
        list.appendChild(li);
      }
      more.append(list);
    }
    more.append(this.reportLink({ name: b.name, id: b.id }));
    this.content.append(h2, meta, badge, hours, more);
    this.show();
  }

  private reportLink(target: { name: string; id: string }): HTMLElement {
    const link = document.createElement("a");
    link.href = reportIssueUrl(target);
    link.className = "report-link";
    link.textContent = "Report an issue";
    return link;
  }

  private landmarkPhoto(image: NonNullable<Building["image"]>): HTMLElement {
    const wrap = document.createElement("figure");
    wrap.className = "landmark-photo";
    const img = document.createElement("img");
    img.src = image.url;
    img.loading = "lazy";
    img.alt = "";
    const caption = document.createElement("figcaption");
    const link = document.createElement("a");
    link.href = image.sourceUrl;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = `Photo: ${image.attribution}`;
    caption.append(link);
    wrap.append(img, caption);
    return wrap;
  }

  private poiList(pois: Poi[]): HTMLElement {
    const list = document.createElement("ul");
    list.className = "poi-list";
    for (const p of [...pois].sort((a, b) => a.name.localeCompare(b.name))) {
      const li = document.createElement("li");
      li.append(el("span", p.name), el("span", humanCategory(p.category), "poi-cat"));
      if (p.website) {
        const link = document.createElement("a");
        link.href = p.website;
        link.target = "_blank";
        link.rel = "noopener";
        link.className = "poi-website";
        link.textContent = "Website ↗";
        li.append(link);
      }
      list.appendChild(li);
    }
    return list;
  }

  /** Card for a single business tapped on the map. */
  showPoi(p: Poi, host: Building | undefined, onRouteTo: () => void) {
    this.content.innerHTML = "";
    this.clearRouteProgress();
    this.content.append(el("h2", p.name));
    const where = host ? `${humanCategory(p.category)} · ${host.name}` : humanCategory(p.category);
    this.content.append(el("div", where, "meta"));
    if (p.level === "1") this.content.append(el("span", "Skyway level", "badge open"));
    if (p.openingHours) this.content.append(el("div", `Hours: ${p.openingHours}`, "hours-line"));

    const actionsRow = document.createElement("div");
    actionsRow.className = "actions";
    if (p.website) {
      const website = document.createElement("a");
      website.href = p.website;
      website.target = "_blank";
      website.rel = "noopener";
      website.className = "website-btn";
      website.textContent = "Website / menu ↗";
      actionsRow.append(website);
    }
    const toBtn = el("button", "Route here", "primary");
    toBtn.addEventListener("click", onRouteTo);
    actionsRow.append(toBtn);
    this.content.append(actionsRow, this.reportLink({ name: p.name, id: p.id }));
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
    this.clearRouteProgress();
    this.content.append(el("h2", `Within reach of ${origin.name}`));
    this.content.append(el("div", `Leaving ${formatWhen(when)}`, "meta"));

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

  showRoute(
    route: RouteResult,
    when: Date,
    labels?: { from?: string; to?: string; accessible?: boolean },
    pois: Poi[] = [],
    onReportClosed?: (fromId: string, toId: string) => void,
  ) {
    this.routePois = pois;
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

    // Visible even in peek — worth knowing before you commit to a route,
    // not just discovering it mid-walk in the collapsed step list.
    if (route.steps.some((s) => s.hasSteps)) {
      this.content.append(el("span", "Includes stairs", "badge stairs"));
    } else if (labels?.accessible) {
      this.content.append(el("span", "Step-free route", "badge open"));
    }

    const summary = document.createElement("div");
    summary.className = "route-summary";
    summary.append(
      el("span", `${Math.max(1, Math.round(route.totalMinutes))} min`, "big"),
      el("span", formatDistance(route.totalMeters), "sub"),
      el("span", `${route.steps.length} buildings`, "sub"),
    );
    this.content.append(summary);

    // Filled in by updateRouteProgress() once live position updates arrive;
    // stays empty/hidden for a route you're just previewing.
    const prompt = el("div", "", "progress-prompt");
    prompt.hidden = true;
    this.content.append(prompt);

    const ol = document.createElement("ul");
    ol.className = "steps sheet-collapsible";
    route.steps.forEach((step, i) => {
      const li = document.createElement("li");
      const closedHere = !isOpenLabelOk(step.building, when);
      const landmark = landmarkNear(pois, step.building.id);
      li.append(el("span", step.building.name + (closedHere ? " (closed)" : "")));
      if (landmark) li.append(" — ", landmarkCue(landmark));
      if (step.viaCrossing) {
        // Every step is via skyway — that's the whole app — so the label
        // only appears when it says something: stairs on the crossing, or
        // a genuinely named crossing (OSM names most bridges the generic
        // "Minneapolis Skyway", which we treat as saying nothing).
        const generic = /^(minneapolis )?skyway$/i.test(step.viaCrossing.trim());
        if (step.hasSteps) {
          li.prepend(el("span", generic ? "Stairs" : `Stairs · ${step.viaCrossing}`, "via steps"));
        } else if (!generic) {
          li.prepend(el("span", `Cross over ${step.viaCrossing}`, "via"));
        }
        if (onReportClosed && i > 0) {
          const prevId = route.steps[i - 1].building.id;
          const curId = step.building.id;
          const report = el("button", "⚑", "report-crossing");
          report.title = "Report this crossing locked or closed";
          report.setAttribute("aria-label", "Report this crossing locked or closed");
          report.addEventListener("click", (e) => {
            e.stopPropagation();
            onReportClosed(prevId, curId);
          });
          li.append(report);
        }
      }
      ol.appendChild(li);
    });
    this.content.append(ol);
    this.stepsListEl = ol;
    this.progressPromptEl = prompt;
    this.activeRoute = route;
    // Peek: the summary line is the win, the full turn list can crowd out
    // the map it's describing — drag the handle up (or tap it) for that.
    this.show(false);
  }

  showMessage(title: string, body: string) {
    this.content.innerHTML = "";
    this.clearRouteProgress();
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

/**
 * Visual anchor for a landmark cue: the business's bundled favicon, when we
 * have one. No logo means no chip — a placeholder monogram implied more
 * data than we actually have.
 */
function landmarkChip(p: Poi): HTMLElement | null {
  if (!p.logo) return null;
  const chip = el("span", undefined, "lm-chip");
  const img = document.createElement("img");
  img.src = `logos/${p.logo}.png`;
  img.alt = "";
  img.loading = "lazy";
  img.addEventListener("error", () => chip.remove());
  chip.append(img);
  return chip;
}

/** " past [chip] <name>" as inline elements, shared by steps and live cue. */
function landmarkCue(p: Poi): HTMLElement {
  const cue = el("span", undefined, "lm-cue");
  const chip = landmarkChip(p);
  cue.append("past ", ...(chip ? [chip, " "] : []), p.name);
  return cue;
}
