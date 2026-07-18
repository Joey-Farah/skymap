import type { Building, Poi, RouteResult } from "./types.ts";
import { reportIssueUrl } from "./share.ts";
import { CATEGORY_LABELS, GROUP_COLORS, GROUP_LABELS, landmarkNear, type PoiGroup } from "./poi.ts";
import { haversineMeters, WALK_METERS_PER_MIN } from "./router.ts";
import { buildComboEntries, searchEntries, type ComboEntry } from "./combo.ts";
import type { RecentEntry } from "./recents.ts";
import { renderPoiIconDataUrl } from "./poi-icons.ts";

// "building" is the one result icon that isn't a real POI group (buildings
// are the polygons on the map, not icon markers) — it keeps the plain
// letter badge. Every POI group instead gets the same glyph the map
// itself uses, memoized since there are only a handful of distinct icons
// no matter how many result rows are on screen.
const iconCache = new Map<string, string>();
function resultIconUrl(group: PoiGroup): string {
  let url = iconCache.get(group);
  if (!url) {
    url = renderPoiIconDataUrl(group, GROUP_COLORS[group], 32);
    iconCache.set(group, url);
  }
  return url;
}
import { closingSoonWarnings, formatMinute, formatWeeklyHours, statusAt } from "./hours.ts";

/** Searchable building picker attached to an existing .combo element. */
export class BuildingCombo {
  private input: HTMLInputElement;
  private list: HTMLUListElement;
  private buildingsById: Map<string, Building>;
  private poisById: Map<string, Poi>;
  private entries: ComboEntry[];
  private selectedId: string | null = null;
  /** The specific business behind the current selection, if any — a route
   * to/from this field should mark the business's own precise location,
   * not just its host building's centroid (which can be dozens of meters
   * off in a large building). */
  private selectedPoi: Poi | null = null;
  private activeIndex = -1;
  /** Only the "From" combo offers this — you don't route *to* where you are. */
  private showCurrentLocation: boolean;
  private currentLocationBuilding: Building | null = null;
  private recents: RecentEntry[] = [];
  /** Second argument is set when the choice was a specific business inside
   * a building, not the building itself — callers that want to show that
   * business's own card (hours, website) rather than just its host use it. */
  onSelect: ((b: Building, poi?: Poi) => void) | null = null;
  /** Fires only for a deliberate, named choice — not the current-location
   * shortcut — so callers can persist it as a recent without also
   * recording "wherever I happened to be standing" as a place name. */
  onRecentWorthy: ((b: Building) => void) | null = null;

  constructor(root: HTMLElement, buildings: Building[], pois: Poi[] = [], opts: { currentLocation?: boolean } = {}) {
    this.input = root.querySelector("input")!;
    this.list = root.querySelector(".combo-list")!;
    this.buildingsById = new Map(buildings.map((b) => [b.id, b]));
    this.poisById = new Map(pois.map((p) => [p.id, p]));
    this.entries = buildComboEntries(buildings, pois);
    this.showCurrentLocation = opts.currentLocation ?? false;

    this.input.addEventListener("input", () => {
      this.selectedId = null;
      this.render(this.input.value);
    });
    this.input.addEventListener("focus", () => this.render(this.input.value));
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    document.addEventListener("click", (e) => {
      if (root.contains(e.target as Node)) return;
      // A click elsewhere in the DOM can be exactly what focused this
      // field in the first place (e.g. tapping the idle "Where to?" bar
      // programmatically focuses From) — that click bubbles to this
      // listener a tick after the resulting render, and would otherwise
      // immediately hide the list it just showed.
      if (root.contains(document.activeElement)) return;
      this.hide();
    });
  }

  /**
   * Updates the building a live position fix resolves to. Re-renders
   * immediately if the list is already open (typically empty-query, just
   * focused) so the option appears the moment a fix arrives, not just on
   * the next focus.
   */
  setCurrentLocation(b: Building | null) {
    this.currentLocationBuilding = b;
    if (!this.list.hidden) this.render(this.input.value);
  }

  /** Recent, deliberately-chosen destinations — shown in place of an
   * unfiltered building dump when the field is focused empty. */
  setRecents(recents: RecentEntry[]) {
    this.recents = recents;
    if (!this.list.hidden) this.render(this.input.value);
  }

  get value(): string | null {
    return this.selectedId;
  }

  /** What's showing in the input — the business name when one was picked, else the building's. */
  get label(): string | null {
    return this.selectedId ? this.input.value : null;
  }

  /** The precise business location behind the current selection, if the
   * choice was a specific business rather than the building itself. */
  get poi(): Poi | null {
    return this.selectedPoi;
  }

  /** Programmatic selection (sheet actions, swap button) — always a building,
   * except when `poi` is passed along (e.g. "Directions" from a POI's own
   * card knows exactly which business it's routing to/from). `silent`
   * skips the onSelect callback — swap needs this: both fields' onSelect
   * are wired to trigger routing (and routing collapses the editor back
   * to the one-line trip strip), so a plain field swap would otherwise
   * immediately re-collapse the very form you just wanted to keep open. */
  select(b: Building, poi?: Poi, opts: { silent?: boolean } = {}) {
    this.selectedId = b.id;
    this.selectedPoi = poi ?? null;
    this.input.value = poi?.name ?? b.name;
    this.hide();
    if (opts.silent) return;
    this.onSelect?.(b, poi);
    this.onRecentWorthy?.(b);
  }

  private selectEntry(entry: ComboEntry) {
    const b = this.buildingsById.get(entry.buildingId);
    if (!b) return;
    this.selectedId = entry.buildingId;
    this.input.value = entry.label;
    this.hide();
    const poi = entry.poiId ? this.poisById.get(entry.poiId) : undefined;
    this.selectedPoi = poi ?? null;
    this.onSelect?.(b, poi);
    this.onRecentWorthy?.(b);
  }

  /** Public so callers can auto-fill "From" as a direct consequence of a
   * deliberate action (e.g. tapping Directions) — distinct from the old
   * silent auto-fill this replaced, which fired before anyone asked. */
  selectCurrentLocation() {
    const b = this.currentLocationBuilding;
    if (!b) return;
    this.selectedId = b.id;
    this.selectedPoi = null;
    this.input.value = "Current Location";
    this.hide();
    this.onSelect?.(b);
  }

  private render(query: string) {
    // An unfiltered dump of every building is not a useful starting point —
    // show recent, deliberately-chosen destinations instead, or nothing at
    // all if there aren't any yet. Typing narrows to a real search either way.
    const items = query.trim()
      ? searchEntries(this.entries, query).slice(0, 12)
      : this.recents
          .map((r): ComboEntry | null => {
            const b = this.buildingsById.get(r.id);
            return b ? { label: b.name, sublabel: b.address, buildingId: b.id, icon: "building" } : null;
          })
          .filter((e): e is ComboEntry => e !== null);
    this.activeIndex = -1;
    this.list.innerHTML = "";
    // Pinned first row, Apple-Maps style — only when the field is empty
    // (once you're typing a search, you're looking for something else)
    // and a position fix has actually resolved to a building. No fix yet
    // means no row, rather than a "Current Location" option that fails
    // when tapped.
    if (this.showCurrentLocation && !query.trim() && this.currentLocationBuilding) {
      const li = document.createElement("li");
      li.className = "current-location-row";
      const icon = document.createElement("span");
      icon.className = "result-icon icon-current-location";
      icon.textContent = "⌖";
      const text = document.createElement("span");
      text.className = "result-text";
      text.append(el("span", "Current Location", "result-name"));
      li.append(icon, text);
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.selectCurrentLocation();
      });
      this.list.appendChild(li);
    }
    for (const entry of items) {
      const li = document.createElement("li");
      const icon = document.createElement("span");
      icon.className = `result-icon icon-${entry.icon}`;
      if (entry.icon === "building") {
        icon.textContent = "B";
      } else {
        const img = document.createElement("img");
        img.src = resultIconUrl(entry.icon as PoiGroup);
        img.alt = "";
        icon.append(img);
      }
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
    this.list.hidden = this.list.children.length === 0;
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
  /** Measured, not guessed — see measureHeights(). Peek is however tall the
   * always-visible summary actually is (title, badges, the walk/arrival
   * line); expanded is the full content, capped so the map behind it
   * always stays partly visible. */
  private peekHeight = 0;
  private expandedHeight = 0;
  private expanded = false;
  private dragStartY = 0;
  private dragStartHeight = 0;
  private dragging = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.content = root.querySelector("#sheet-content")!;
    root.querySelector("#sheet-close")!.addEventListener("click", () => this.hide());

    const handle = root.querySelector<HTMLElement>("#sheet-handle")!;
    handle.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.root.classList.add("dragging");
      this.dragStartY = e.clientY;
      this.dragStartHeight = this.root.getBoundingClientRect().height;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      // 1:1 with the finger, Apple Maps style — not a threshold that jumps
      // to a fixed state once you've dragged "enough."
      const delta = this.dragStartY - e.clientY;
      const next = Math.min(this.expandedHeight, Math.max(this.peekHeight, this.dragStartHeight + delta));
      this.root.style.maxHeight = `${next}px`;
    });
    handle.addEventListener("pointerup", (e) => {
      const moved = Math.abs(this.dragStartY - e.clientY) > 8;
      this.dragging = false;
      this.root.classList.remove("dragging");
      if (!moved) {
        this.setExpanded(!this.expanded); // a plain tap still toggles
        return;
      }
      // Released mid-drag: snap to whichever end is closer, animated by
      // the CSS transition (re-enabled now that .dragging is off).
      const current = this.root.getBoundingClientRect().height;
      const midpoint = (this.peekHeight + this.expandedHeight) / 2;
      this.setExpanded(current > midpoint);
    });
  }

  /** Actual pixel heights for this sheet's current content: peek is the
   * height with .sheet-collapsible content hidden (title/badges/summary
   * only), expanded is the full height, capped at 60% of the viewport so
   * the map stays partly visible. Measuring rather than guessing means a
   * route with three warning badges and one with none both peek at
   * exactly their own correct height, never clipped or oversized. */
  private measureHeights() {
    const collapsibles = [...this.content.querySelectorAll<HTMLElement>(".sheet-collapsible")];
    const prevDisplay = collapsibles.map((el) => el.style.display);
    collapsibles.forEach((el) => (el.style.display = "none"));
    this.peekHeight = this.root.scrollHeight;
    collapsibles.forEach((el, i) => (el.style.display = prevDisplay[i]));
    this.expandedHeight = Math.min(this.root.scrollHeight, window.innerHeight * 0.6);
  }

  /** Peek shows just the summary; expanded shows full content. Always togglable via the handle. */
  private setExpanded(expanded: boolean) {
    this.expanded = expanded;
    this.root.style.maxHeight = `${expanded ? this.expandedHeight : this.peekHeight}px`;
    // Peeked content isn't display:none anymore (it needs to be in normal
    // flow to reveal progressively as you drag), which means it's also
    // technically scrollable — a stray scroll gesture could reveal the
    // steps without ever touching the handle. Only the fully-expanded
    // state should actually scroll, for the case content still exceeds
    // the 60vh cap.
    this.root.style.overflowY = expanded ? "auto" : "hidden";
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
    // The prompt starts hidden (nothing to say before a live fix arrives),
    // so peekHeight was measured without it — revealing it here would
    // otherwise clip against a now-stale height.
    this.progressPromptEl.hidden = false;
    this.measureHeights();
    this.setExpanded(this.expanded);
  }

  private show(expanded = true) {
    this.root.hidden = false;
    this.measureHeights();
    this.setExpanded(expanded);
    // Retrigger the content fade-in even when the sheet was already open
    // (e.g. tapping a different building) — a hard content swap otherwise
    // reads as a glitch rather than a transition.
    this.content.classList.remove("content-enter");
    void this.content.offsetWidth; // force reflow so the animation restarts
    this.content.classList.add("content-enter");
  }

  showBuilding(b: Building, when: Date, actions: { onDirections: () => void }, pois: Poi[] = []) {
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
    const directionsBtn = el("button", "Directions", "primary");
    directionsBtn.addEventListener("click", actions.onDirections);
    actionsRow.append(directionsBtn);

    // Everything past the essentials collapses away in peek mode.
    const more = document.createElement("div");
    more.className = "sheet-collapsible";
    if (b.image) more.append(this.landmarkPhoto(b.image));
    more.append(actionsRow);

    const interior = pois.filter((p) => !p.exterior);
    const transit = pois.filter((p) => p.exterior);
    const order: PoiGroup[] = ["coffee", "food", "shop", "service", "restroom", "elevator", "landmark"];
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
        const walk = formatWalk(haversineMeters(p.lat, p.lon, b.lat, b.lon));
        li.append(
          el("span", p.name),
          el("span", p.category === "bus_stop" ? "Bus" : "Light rail", "poi-cat"),
          el("span", walk, "poi-distance"),
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
  showPoi(p: Poi, host: Building | undefined, onDirections: () => void) {
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
    const directionsBtn = el("button", "Directions", "primary");
    directionsBtn.addEventListener("click", onDirections);
    actionsRow.append(directionsBtn);
    this.content.append(actionsRow, this.reportLink({ name: p.name, id: p.id }));
    this.show();
  }

  showRoute(route: RouteResult, when: Date, labels?: { from?: string; to?: string }, pois: Poi[] = []) {
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
    // not just discovering it mid-walk in the collapsed step list. Open-air
    // sorts first: staying enclosed is the app's actual promise, more
    // central than stairs.
    if (route.steps.some((s) => s.openAir)) {
      this.content.append(el("span", "⚠ May briefly go outside", "badge warn"));
    }
    if (route.steps.some((s) => s.hasSteps)) {
      this.content.append(el("span", "Includes stairs", "badge stairs"));
    }

    const totalMin = Math.max(1, Math.round(route.totalMinutes));
    const eta = new Date(when.getTime() + totalMin * 60_000);
    const summary = document.createElement("div");
    summary.className = "route-summary";
    summary.append(
      el("span", `${totalMin} min walk`, "big"),
      el("span", `Arrive ${formatMinute(eta.getHours() * 60 + eta.getMinutes())}`, "sub"),
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
    route.steps.forEach((step) => {
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
        const flags: string[] = [];
        if (step.openAir) flags.push("Outdoors");
        if (step.hasSteps) flags.push("Stairs");
        if (flags.length) {
          const suffix = generic ? "" : ` · ${step.viaCrossing}`;
          li.prepend(el("span", `${flags.join(" · ")}${suffix}`, `via ${step.openAir ? "open-air" : "steps"}`));
        } else if (!generic) {
          li.prepend(el("span", `Cross over ${step.viaCrossing}`, "via"));
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
  // Miles for anything a tenth of a mile or more — most US users read
  // that as the natural unit even for a short walk. Below that, feet would
  // be more precise but reads as false precision for "basically right
  // here" distances, so it's collapsed to a single "<0.1 mi" reading.
  const miles = meters / 1609.34;
  if (miles >= 0.1) return `${miles.toFixed(1)} mi`;
  return "<0.1 mi";
}

/** "3 min walk · 0.1 mi" — time leads since it's what people actually plan
 * around; distance alone doesn't say much without a pace attached. Uses
 * the router's own indoor walking pace so a "3 min" estimate here means
 * the same thing as a "3 min" route. */
function formatWalk(meters: number): string {
  const minutes = Math.max(1, Math.round(meters / WALK_METERS_PER_MIN));
  return `${minutes} min walk · ${formatDistance(meters)}`;
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
