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
import { closingSoonWarnings, formatMinute, formatWeeklyHours, statusAt, statusFromHours } from "./hours.ts";
import { parseOpeningHours } from "./opening-hours.ts";

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
  /** Where "closest" is measured from for equally-relevant results — the
   * live GPS fix, or (for the To field) the chosen origin. */
  private searchAnchor: { lat: number; lon: number } | null = null;
  /** Second argument is set when the choice was a specific business inside
   * a building, not the building itself — callers that want to show that
   * business's own card (hours, website) rather than just its host use it. */
  onSelect: ((b: Building, poi?: Poi) => void) | null = null;
  /** Fires only for a deliberate, named choice — not the current-location
   * shortcut — so callers can persist it as a recent without also
   * recording "wherever I happened to be standing" as a place name. poi
   * is set for the same reason as onSelect's — the specific business
   * chosen, not just its host building. */
  onRecentWorthy: ((b: Building, poi?: Poi) => void) | null = null;

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

  /** Anchor for closest-first ordering of same-name results (chains). */
  setSearchAnchor(anchor: { lat: number; lon: number } | null) {
    this.searchAnchor = anchor;
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
    this.onRecentWorthy?.(b, poi);
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
    this.onRecentWorthy?.(b, poi);
  }

  /** Public so callers can auto-fill "From" as a direct consequence of a
   * deliberate action (e.g. tapping Directions) — distinct from the old
   * silent auto-fill this replaced, which fired before anyone asked. */
  selectCurrentLocation(opts: { silent?: boolean } = {}) {
    const b = this.currentLocationBuilding;
    if (!b) return;
    this.selectedId = b.id;
    this.selectedPoi = null;
    // Name the building the GPS fix snapped to: indoors, drift can cross a
    // street, and a plain "Current Location" hides a wrong snap until the
    // route's first step looks inexplicably wrong.
    this.input.value = `Current Location · ${b.name}`;
    this.hide();
    if (opts.silent) return;
    this.onSelect?.(b);
  }

  private render(query: string) {
    // An unfiltered dump of every building is not a useful starting point —
    // show recent, deliberately-chosen destinations instead, or nothing at
    // all if there aren't any yet. Typing narrows to a real search either way.
    const items = query.trim()
      ? searchEntries(this.entries, query, this.searchAnchor).slice(0, 12)
      : this.recents
          .map((r): ComboEntry | null => {
            const b = this.buildingsById.get(r.id);
            if (!b) return null;
            const poi = r.poiId ? this.poisById.get(r.poiId) : undefined;
            // A recent POI shows and reselects as that exact business, not
            // the building it happens to live in — same shape a live search
            // result for it would have.
            if (poi) return { label: poi.name, sublabel: b.name, buildingId: b.id, poiId: poi.id, icon: poi.group ?? "building" };
            return { label: b.name, sublabel: b.address, buildingId: b.id, icon: "building" };
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
      text.append(
        el("span", "Current Location", "result-name"),
        // Which building the fix resolved to — a wrong indoor snap should
        // be visible before routing, not discovered mid-route.
        el("span", this.currentLocationBuilding.name, "addr"),
      );
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
    for (const li of this.list.children) li.setAttribute("role", "option");
    this.input.setAttribute("aria-expanded", String(!this.list.hidden));
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
    this.input.setAttribute("aria-expanded", "false");
    // Selecting a result (or dismissing via Cancel) is a natural point to
    // give up focus too — closes the on-screen keyboard along with the
    // dropdown instead of leaving it up with nothing left to type into.
    this.input.blur();
  }

  /** The search bar's Cancel button — back to empty/unselected, dropdown
   * closed. Distinct from select(): this is "never mind," not a choice. */
  clear() {
    this.selectedId = null;
    this.selectedPoi = null;
    this.input.value = "";
    this.hide();
  }
}

/** Bottom sheet renderer. */
export type DrawerMode = "idle" | "card" | "preview" | "nav";

/**
 * The drawer: one bottom sheet that is, in turn, the idle rest state
 * (category shortcuts + footer — search itself lives in the persistent
 * top bar, not here), a place card, the route preview, and the slim
 * navigation bar — Apple Maps' architecture. Mode determines which static
 * section shows, how tall the sheet sits, and what dragging means.
 */
export class Sheet {
  private root: HTMLElement;
  private content: HTMLElement;
  private idleSection: HTMLElement;
  private closeBtn: HTMLButtonElement;
  private mode: DrawerMode = "idle";
  private activeRoute: RouteResult | null = null;
  private routePois: Poi[] = [];
  private navBarArrival: HTMLElement | null = null;
  private navBarRemaining: HTMLElement | null = null;
  private navStepsListEl: HTMLUListElement | null = null;
  /** Measured, not guessed — see measureHeights(). Peek is however tall the
   * always-visible summary actually is; expanded is the full content,
   * capped so the map behind it always stays partly visible. */
  private peekHeight = 0;
  private expandedHeight = 0;
  private expanded = false;
  private dragStartY = 0;
  private dragStartHeight = 0;
  private dragging = false;
  /** Card ✕ → back to idle. Owned by main.ts, which runs the mode state
   * machine. */
  onClose: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.content = root.querySelector("#sheet-content")!;
    this.idleSection = root.querySelector("#d-idle")!;
    this.closeBtn = root.querySelector("#sheet-close")!;
    this.closeBtn.addEventListener("click", () => this.onClose?.());

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
      if (this.mode !== "card" && this.mode !== "preview" && this.mode !== "nav") return;
      // 1:1 with the finger, Apple Maps style.
      const delta = this.dragStartY - e.clientY;
      const next = Math.min(this.expandedHeight, Math.max(this.peekHeight, this.dragStartHeight + delta));
      this.root.style.maxHeight = `${next}px`;
      this.setClearance(next + 12); // floaters track the drag live, not just at rest
    });
    handle.addEventListener("pointerup", (e) => {
      const moved = Math.abs(e.clientY - this.dragStartY) > 8;
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

    // Rotation / split-view resize invalidates the measured heights (the
    // expanded cap is a viewport fraction) — re-measure or the sheet keeps
    // portrait-sized bounds in landscape until reopened.
    window.addEventListener("resize", () => this.applyMode());
  }

  get currentMode(): DrawerMode {
    return this.mode;
  }

  /** Section visibility + sizing for the current mode. */
  private applyMode() {
    const m = this.mode;
    this.idleSection.hidden = m !== "idle";
    this.content.style.display = m === "card" || m === "preview" || m === "nav" ? "" : "none";
    this.closeBtn.hidden = m !== "card";
    this.root.classList.toggle("nav-mode", m === "nav");
    this.root.classList.toggle("idle-mode", m === "idle");
    if (m === "idle") {
      // Category shortcuts + footer, nothing to drag up into — search
      // itself lives in the persistent top bar now, not here.
      const pad = parseFloat(getComputedStyle(this.root).paddingBottom) || 0;
      const h = this.idleSection.offsetTop + this.idleSection.offsetHeight + pad;
      this.root.style.maxHeight = `${h}px`;
      this.root.style.overflowY = "hidden";
      this.setClearance(h + 12);
      this.root.classList.add("no-expand");
    } else {
      // card, preview, and nav all size the same way: peek clips at the
      // last always-visible element, expanded (drag-up) reveals the full
      // turn-by-turn list underneath.
      this.measureHeights();
      this.setExpanded(this.expanded);
      // Nothing gained by dragging (a plain message, a card with no extra
      // detail) — showing the handle and letting overflow scroll anyway
      // reads as an affordance for content that isn't there.
      this.root.classList.toggle("no-expand", this.expandedHeight <= this.peekHeight + 1);
    }
  }

  private setClearance(px: number) {
    document.documentElement.style.setProperty("--sheet-clearance", `${px}px`);
  }

  showIdle() {
    this.mode = "idle";
    this.clearRouteProgress();
    this.content.innerHTML = "";
    this.applyMode();
  }

  /** Actual pixel heights for this sheet's current content: peek clips at
   * the bottom edge of the last always-visible element, expanded is the
   * full height capped at 60% of the viewport so the map stays partly
   * visible. Read from rendered geometry so the clip boundary can't drift
   * from what's actually on screen. */
  private measureHeights() {
    const visible = [...this.content.children].filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement && !el.classList.contains("sheet-collapsible") && !el.hidden,
    );
    const last = visible[visible.length - 1];
    const padBottom = parseFloat(getComputedStyle(this.root).paddingBottom) || 0;
    if (last) {
      const lastBottom = last.offsetTop + last.offsetHeight;
      // Trailing space defaults to the sheet's own bottom padding, but a
      // collapsible element (the hidden detail content) often follows
      // right after with a smaller gap — using the full padding then
      // clips a few pixels INTO it instead of stopping cleanly at its
      // edge, which is exactly what showed as "Hours: …" peeking out
      // under the Directions button. A flush 0px gap (e.g. the route
      // steps list, which starts its own box right where the GO button
      // ends) still needs a few px of floor, though — with none at all,
      // the sheet's own rounded bottom corner has nowhere to round into
      // and reads as a hard-cropped edge. 6px is comfortably inside a
      // list item's own top padding (8px), so it never actually shows
      // real content, just gives the corner room to breathe.
      const next = last.nextElementSibling as HTMLElement | null;
      const gapToNext = next ? next.offsetTop - lastBottom : padBottom;
      this.peekHeight = lastBottom + Math.min(padBottom, Math.max(6, gapToNext));
    } else {
      this.peekHeight = 120;
    }
    // Only a sheet-collapsible section is worth dragging up for — without
    // one, root.scrollHeight can still exceed peekHeight by a few px of
    // margin-collapse noise, which isn't real content and shouldn't make
    // the sheet claim there's something to expand into.
    this.expandedHeight = this.content.querySelector(".sheet-collapsible")
      ? Math.max(this.peekHeight, Math.min(this.root.scrollHeight, window.innerHeight * 0.6))
      : this.peekHeight;
  }

  /** Peek shows just the summary; expanded shows full content. Always togglable via the handle. */
  private setExpanded(expanded: boolean) {
    this.expanded = expanded;
    this.root.style.maxHeight = `${expanded ? this.expandedHeight : this.peekHeight}px`;
    // Only the fully-expanded state scrolls, for content past the cap —
    // while peeked, a stray scroll would reveal the steps without the
    // handle ever being touched.
    this.root.style.overflowY = expanded ? "auto" : "hidden";
    // Bug this fixes: clearance always used peekHeight, even while
    // expanded — so anything floating above the drawer (the toast, the
    // locate button) thought the collapsed sheet was still the real
    // height and landed mid-drawer once you dragged it open.
    this.setClearance((expanded ? this.expandedHeight : this.peekHeight) + 12);
  }

  private clearRouteProgress() {
    this.activeRoute = null;
    this.routePois = [];
    this.navBarArrival = null;
    this.navBarRemaining = null;
    this.navStepsListEl = null;
  }

  private show(mode: DrawerMode, expanded: boolean) {
    this.mode = mode;
    this.applyMode();
    if (mode === "card" || mode === "preview" || mode === "nav") this.setExpanded(expanded);
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
    actions: { onDirections: () => void; directionsLabel?: string },
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
    const badge = el("span", status.label, `badge ${status.open ? "open" : "closed"}`);

    // Peek = name, status, and the Directions pill (with the walk time on
    // it when known) — Apple's card peek. Everything else under drag-up.
    const actionsRow = document.createElement("div");
    actionsRow.className = "actions";
    const directionsBtn = el("button", actions.directionsLabel ?? "Directions", "primary");
    directionsBtn.addEventListener("click", actions.onDirections);
    actionsRow.append(directionsBtn);

    const more = document.createElement("div");
    more.className = "sheet-collapsible";
    const hours = el("div", `Hours: ${formatWeeklyHours(b.hours)}`, "hours-line");
    // Real per-building hours come from OSM tags when present; the generic
    // schedule is a guess, and guesses should say so rather than pass as fact.
    if (b.hoursNote.startsWith("Default")) {
      hours.append(el("span", " (typical, unverified)", "hours-unverified"));
    }
    more.append(hours);
    if (b.image) more.append(this.landmarkPhoto(b.image));

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
    more.append(this.reportLink({ name: b.name, id: b.id }, formatWeeklyHours(b.hours)));
    this.content.append(h2, meta, badge, actionsRow, more);
    this.show("card", false);
  }

  private reportLink(target: { name: string; id: string }, hours?: string): HTMLElement {
    const link = document.createElement("a");
    link.href = reportIssueUrl(target, hours);
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
  showPoi(
    p: Poi,
    host: Building | undefined,
    when: Date,
    actions: { onDirections: () => void; directionsLabel?: string },
  ) {
    this.content.innerHTML = "";
    this.clearRouteProgress();
    this.content.append(el("h2", p.name));
    const where = host ? `${humanCategory(p.category)} · ${host.name}` : humanCategory(p.category);
    this.content.append(el("div", where, "meta"));
    // Raw OSM opening_hours is arbitrary syntax ("Mo-Fr 07:00-16:00") —
    // parsed into the same weekly-hours shape a building uses gets it the
    // same 12-hour formatting and an open/closed read, not just military
    // time dumped verbatim with no way to tell at a glance.
    const parsedHours = parseOpeningHours(p.openingHours);
    if (parsedHours) {
      const status = statusFromHours(parsedHours, when);
      this.content.append(el("span", status.label, `badge ${status.open ? "open" : "closed"}`));
    }
    if (p.level === "1") this.content.append(el("span", "Skyway level", "badge open"));

    const actionsRow = document.createElement("div");
    actionsRow.className = "actions";
    const directionsBtn = el("button", actions.directionsLabel ?? "Directions", "primary");
    directionsBtn.addEventListener("click", actions.onDirections);
    actionsRow.append(directionsBtn);
    this.content.append(actionsRow);

    const more = document.createElement("div");
    more.className = "sheet-collapsible";
    if (parsedHours) more.append(el("div", `Hours: ${formatWeeklyHours(parsedHours)}`, "hours-line"));
    else if (p.openingHours) more.append(el("div", `Hours: ${p.openingHours}`, "hours-line"));
    if (p.website) {
      const website = document.createElement("a");
      website.href = p.website;
      website.target = "_blank";
      website.rel = "noopener";
      website.className = "website-btn";
      website.textContent = "Website / menu ↗";
      more.append(website);
    }
    more.append(this.reportLink({ name: p.name, id: p.id }));
    this.content.append(more);
    this.show("card", false);
  }

  /** Screen 4: route preview — summary, warnings, Share, the green GO.
   * No live tracking here; that's what GO is for. */
  showRoutePreview(
    route: RouteResult,
    when: Date,
    pois: Poi[],
    actions: { onGo: () => void; onShare: () => void },
  ) {
    this.routePois = pois;
    this.content.innerHTML = "";
    this.clearRouteProgress();

    if (route.ignoredClosures) {
      this.content.append(
        el("span", "⚠ No fully open route at this time — showing the path ignoring closures", "badge warn"),
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
    if (route.steps.some((s) => s.openAir)) {
      this.content.append(el("span", "⚠ May briefly go outside", "badge warn"));
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
    const share = el("button", "Share", "share-btn");
    share.setAttribute("aria-label", "Share this route");
    share.addEventListener("click", actions.onShare);
    summary.append(share);
    this.content.append(summary);

    const go = el("button", "GO", "go-btn");
    go.addEventListener("click", actions.onGo);
    this.content.append(go);

    this.content.append(this.buildStepsList(route, when, pois));
    this.activeRoute = route;
    this.show("preview", false);
  }

  private buildStepsList(route: RouteResult, when: Date, pois: Poi[]): HTMLUListElement {
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
    return ol;
  }

  /** Screen 5: the slim bar under the instruction banner — arrival, time
   * and distance remaining, End — with the full turn-by-turn list one
   * drag-up away, same as the preview screen. */
  showNavigating(route: RouteResult, when: Date, pois: Poi[], actions: { onEnd: () => void }) {
    this.routePois = pois;
    this.activeRoute = route;
    this.content.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "nav-bar";
    this.navBarArrival = el("strong", "—");
    this.navBarRemaining = el("span", "", "sub");
    const end = el("button", "End", "end-btn");
    end.addEventListener("click", actions.onEnd);
    bar.append(this.navBarArrival, this.navBarRemaining, end);
    this.content.append(bar);
    this.navStepsListEl = this.buildStepsList(route, when, pois);
    this.content.append(this.navStepsListEl);
    // Expanded by default so the full turn-by-turn list is visible the
    // moment navigation starts, not just the slim arrival bar — still a
    // drag away from collapsing if someone wants the map instead.
    this.show("nav", true);
  }

  /**
   * Live navigation update: refreshes the bottom bar's arrival/remaining
   * numbers and returns the instruction for the top banner. Remaining is
   * a step-fraction estimate — plenty for indoor walking distances.
   */
  updateNav(stepIndex: number, now: Date): { title: string; sub: HTMLElement | null } | null {
    if (!this.activeRoute || this.mode !== "nav") return null;
    const route = this.activeRoute;
    this.navStepsListEl?.querySelectorAll("li").forEach((li, i) => {
      li.classList.toggle("current", i === stepIndex);
    });
    const lastIdx = route.steps.length - 1;
    const frac = lastIdx > 0 ? Math.min(1, stepIndex / lastIdx) : 1;
    const remainingMin = Math.round(route.totalMinutes * (1 - frac));
    const remainingMeters = route.totalMeters * (1 - frac);
    const eta = new Date(now.getTime() + remainingMin * 60_000);
    if (this.navBarArrival) {
      this.navBarArrival.textContent = formatMinute(eta.getHours() * 60 + eta.getMinutes());
    }
    if (this.navBarRemaining) {
      this.navBarRemaining.textContent = `arrival · ${Math.max(0, remainingMin)} min · ${formatDistance(remainingMeters)}`;
    }
    const next = route.steps[stepIndex + 1];
    if (!next) return { title: "You've arrived", sub: null };
    const crossing = next.viaCrossing ?? "";
    const generic = /^(minneapolis )?skyway$/i.test(crossing.trim());
    const verb = next.hasSteps
      ? "Take the stairs into"
      : generic || !crossing
        ? "Head into"
        : `Cross over ${crossing} into`;
    const landmark = landmarkNear(this.routePois, next.building.id);
    return { title: `${verb} ${next.building.name}`, sub: landmark ? landmarkCue(landmark) : null };
  }

  showMessage(title: string, body: string) {
    this.content.innerHTML = "";
    this.clearRouteProgress();
    this.content.append(el("h2", title), el("div", body, "meta"));
    // Not expanded: it's a couple lines of text, nothing further to drag
    // up into — matches the peek-only sizing applyMode() already gives it.
    this.show("card", false);
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
