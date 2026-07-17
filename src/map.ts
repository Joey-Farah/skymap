import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Building, Poi, RouteResult, SkymapData } from "./types.ts";
import { isClosingSoon, isOpenAt } from "./hours.ts";
import { polylineMeters, sliceAlong } from "./router.ts";
import { renderPoiIcon } from "./poi-icons.ts";
import { GROUP_COLORS } from "./poi.ts";

// Liberty: colored roads/parks/water, much closer to Apple/Google Maps' look
// than Positron's grayscale. Dark: OpenFreeMap's own dark counterpart — a
// bright daytime style under a dark UI (app chrome follows
// prefers-color-scheme everywhere else) reads as broken, not intentional.
const LIGHT_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const DARK_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const DOWNTOWN_CENTER: [number, number] = [-93.2697, 44.976];

function prefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Minimal style used when the basemap host is unreachable (offline etc.). */
function fallbackStyle(dark: boolean): maplibregl.StyleSpecification {
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {},
    layers: [
      { id: "background", type: "background", paint: { "background-color": dark ? "#14161a" : "#f2f2ef" } },
    ],
  };
}

// Wayfinding palette: the city recedes to warm grey, the network reads like
// a transit diagram — ink-blue lines, signal-amber route.
const NETWORK = "#2257c9";
const NETWORK_DEEP = "#17356e";
const CLOSED = "#a5adbd";
const ROUTE = "#e08a00";
const INK = "#17243a";

/** Isochrone bands, nearest to farthest. Shared with the sheet legend. */
export const REACH_BANDS = [
  { maxMinutes: 5, color: "#17356e" },
  { maxMinutes: 10, color: "#2f66d0" },
  { maxMinutes: 15, color: "#8fb0ea" },
] as const;
const REACH_COLORS_EXPR: maplibregl.ExpressionSpecification = [
  "step",
  ["get", "minutes"],
  REACH_BANDS[0].color,
  REACH_BANDS[0].maxMinutes,
  REACH_BANDS[1].color,
  REACH_BANDS[1].maxMinutes,
  REACH_BANDS[2].color,
];

/** Use the remote basemap when reachable, else the local fallback. Picks
 * light/dark once at load time, matching the OS preference. */
export async function resolveStyle(): Promise<string | maplibregl.StyleSpecification> {
  const dark = prefersDark();
  const url = dark ? DARK_STYLE_URL : LIGHT_STYLE_URL;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) return url;
  } catch {
    // fall through
  }
  console.warn("Basemap unreachable; using offline fallback style.");
  return fallbackStyle(dark);
}

type FC = GeoJSON.FeatureCollection;

function buildingsFC(data: SkymapData, when: Date): FC {
  return {
    type: "FeatureCollection",
    features: data.buildings.map((b) => ({
      type: "Feature",
      properties: {
        id: b.id,
        name: b.name,
        open: isOpenAt(b, when),
        closingSoon: isClosingSoon(b, when, 20),
        hub: b.category === "retailHub",
      },
      geometry: { type: "Polygon", coordinates: [b.footprint] },
    })),
  };
}

function bridgesFC(data: SkymapData, when: Date): FC {
  const byId = new Map(data.buildings.map((b) => [b.id, b]));
  return {
    type: "FeatureCollection",
    features: data.edges.map((e) => {
      const a = byId.get(e.from)!;
      const b = byId.get(e.to)!;
      return {
        type: "Feature",
        properties: {
          crossing: e.crossing,
          open: isOpenAt(a, when) && isOpenAt(b, when),
        },
        geometry: {
          type: "LineString",
          coordinates: e.geometry ?? [
            [a.lon, a.lat],
            [b.lon, b.lat],
          ],
        },
      };
    }),
  };
}

/** Full route polyline: real bridge geometry when present, centroids otherwise. */
function routeCoords(route: RouteResult): [number, number][] {
  const coordinates: [number, number][] = [[route.steps[0].building.lon, route.steps[0].building.lat]];
  for (const s of route.steps.slice(1)) {
    if (s.legGeometry) coordinates.push(...s.legGeometry);
    else coordinates.push([s.building.lon, s.building.lat]);
  }
  return coordinates;
}

function lineFC(coordinates: [number, number][]): FC {
  if (coordinates.length < 2) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
    ],
  };
}


function poisFC(pois: Poi[]): FC {
  return {
    type: "FeatureCollection",
    features: pois.map((p) => ({
      type: "Feature",
      properties: {
        id: p.id,
        name: p.name,
        group: p.group,
        color: GROUP_COLORS[p.group] ?? INK,
      },
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    })),
  };
}

const TILTED_PITCH = 45;

/** Apple Maps defaults to top-down and lets you opt into a tilted view —
 * a flat skyway network reads clearer from directly above, but the tilt
 * is nice once you're actually walking a route. */
class Pitch3DControl implements maplibregl.IControl {
  private map?: maplibregl.Map;
  private button!: HTMLButtonElement;

  onAdd(map: maplibregl.Map): HTMLElement {
    this.map = map;
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "maplibregl-ctrl-pitch-toggle";
    this.button.setAttribute("aria-label", "Toggle 3D view");
    this.button.textContent = "3D";
    this.button.addEventListener("click", () => {
      const next = (map.getPitch() ?? 0) > 5 ? 0 : TILTED_PITCH;
      map.easeTo({ pitch: next, duration: 400 });
    });
    map.on("pitch", () => this.syncActive());
    container.appendChild(this.button);
    this.syncActive();
    return container;
  }

  onRemove(): void {
    this.button.parentElement?.remove();
    this.map = undefined;
  }

  private syncActive() {
    const on = (this.map?.getPitch() ?? 0) > 5;
    this.button.classList.toggle("active", on);
  }
}

function pointFC(coord: [number, number] | null): FC {
  if (!coord) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: coord } }],
  };
}

export class SkymapView {
  readonly map: maplibregl.Map;
  /** The locate control — main.ts layers the heading-up tap cycle onto it. */
  geolocate!: maplibregl.GeolocateControl;
  private data: SkymapData;
  private when: Date = new Date();
  private markers: maplibregl.Marker[] = [];
  private ready = false;
  private routeAnim = 0;

  constructor(
    container: HTMLElement,
    data: SkymapData,
    style: string | maplibregl.StyleSpecification,
    onBuildingClick: (b: Building) => void,
    onPoiClick?: (p: Poi) => void,
    onPosition?: (lat: number, lon: number) => void,
    onRouteTap?: (lat: number, lon: number) => void,
  ) {
    this.data = data;
    this.map = new maplibregl.Map({
      container,
      style,
      center: DOWNTOWN_CENTER,
      zoom: 14.6,
      pitch: 0,
      attributionControl: { compact: true },
    });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    this.map.addControl(new Pitch3DControl(), "top-right");
    // MapLibre draws its own blue "you are here" dot + accuracy ring;
    // we just need to hear about updates for building-aware features
    // (turn-by-turn progress, "you're near X").
    const geolocate = new maplibregl.GeolocateControl({
      trackUserLocation: true,
      // maximumAge lets the first tap paint a recent cached fix instantly
      // (watchPosition then refines it); timeout surfaces an error instead
      // of spinning forever — the incumbent app's "wait 8-10 seconds and
      // tap again" bug is exactly this failure mode left silent.
      positionOptions: { enableHighAccuracy: true, maximumAge: 120000, timeout: 15000 },
    });
    this.map.addControl(geolocate, "top-right");
    geolocate.on("geolocate", (pos: GeolocationPosition) => {
      onPosition?.(pos.coords.latitude, pos.coords.longitude);
    });
    this.geolocate = geolocate;

    // If the basemap can't load (offline / blocked tiles), keep our overlay
    // usable on a plain background instead of dying.
    this.map.on("error", (e) => console.warn("Map resource error:", e.error?.message));

    this.map.on("load", () => {
      this.ready = true;
      this.declutterBasemap();
      this.registerPoiIcons();
      this.addLayers();
    });

    this.map.on("click", "skyway-buildings-fill", (e) => {
      // Let a POI hit win over the building underneath it.
      const poiHit = this.map
        .queryRenderedFeatures(e.point, { layers: ["skyway-pois"] })
        .length;
      if (poiHit) return;
      const id = e.features?.[0]?.properties?.id as string | undefined;
      const b = this.data.buildings.find((x) => x.id === id);
      if (b) onBuildingClick(b);
    });
    this.map.on("click", "skyway-pois", (e) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      const p = this.data.pois?.find((x) => x.id === id);
      if (p && onPoiClick) onPoiClick(p);
    });
    // GPS drifts indoors, sometimes badly enough to put you on the wrong
    // step of a route — a manual correction is the fallback (borrowed
    // from Sky Walker's "tap your dot back onto the route" idea). Lowest
    // priority of the three tap targets: a building or POI under the same
    // point still wins, since those are more specific intents.
    this.map.on("click", "skyway-route-casing", (e) => {
      const poiHit = this.map.queryRenderedFeatures(e.point, { layers: ["skyway-pois"] }).length;
      const buildingHit = this.map.queryRenderedFeatures(e.point, { layers: ["skyway-buildings-fill"] }).length;
      if (poiHit || buildingHit) return;
      onRouteTap?.(e.lngLat.lat, e.lngLat.lng);
    });
    for (const layer of ["skyway-buildings-fill", "skyway-pois", "skyway-route-casing"]) {
      this.map.on("mouseenter", layer, () => {
        this.map.getCanvas().style.cursor = "pointer";
      });
      this.map.on("mouseleave", layer, () => {
        this.map.getCanvas().style.cursor = "";
      });
    }
  }

  private registerPoiIcons() {
    for (const group of Object.keys(GROUP_COLORS) as (keyof typeof GROUP_COLORS)[]) {
      const id = `poi-icon-${group}`;
      if (this.map.hasImage(id)) continue;
      this.map.addImage(id, renderPoiIcon(group as Poi["group"], GROUP_COLORS[group]));
    }
  }

  /** The stock basemap labels every street and shop it can fit — reasonable
   * for a general atlas, but SkyMap already owns building/POI labeling at
   * the zoom levels people actually use, so the base style's own text just
   * competes with it. "place" (city/neighborhood names) is the one source
   * layer worth keeping for orientation; it's a stable OpenMapTiles schema
   * field so this holds even if the style's own layer ids get renamed. */
  private declutterBasemap() {
    for (const layer of this.map.getStyle().layers ?? []) {
      if (layer.type !== "symbol") continue;
      if ("source-layer" in layer && layer["source-layer"] === "place") continue;
      this.map.setLayoutProperty(layer.id, "visibility", "none");
    }
  }

  private addLayers() {
    this.map.addSource("skyway-bridges", { type: "geojson", data: bridgesFC(this.data, this.when) });
    this.map.addSource("skyway-buildings", { type: "geojson", data: buildingsFC(this.data, this.when) });
    this.map.addSource("skyway-route", { type: "geojson", data: lineFC([]) });
    this.map.addSource("skyway-walker", { type: "geojson", data: pointFC(null) });
    this.map.addSource("skyway-reach", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] } satisfies FC,
    });
    this.map.addSource("skyway-pois", { type: "geojson", data: poisFC(this.data.pois ?? []) });

    this.map.addLayer({
      id: "skyway-buildings-fill",
      type: "fill",
      source: "skyway-buildings",
      paint: {
        "fill-color": [
          "case",
          ["!", ["get", "open"]],
          CLOSED,
          ["get", "closingSoon"],
          ROUTE,
          ["get", "hub"],
          NETWORK_DEEP,
          NETWORK,
        ],
        "fill-opacity": ["case", ["get", "closingSoon"], 0.22, ["get", "open"], 0.16, 0.1],
      },
    });
    this.map.addLayer({
      id: "skyway-buildings-outline",
      type: "line",
      source: "skyway-buildings",
      paint: {
        "line-color": ["case", ["get", "closingSoon"], ROUTE, ["get", "open"], NETWORK, CLOSED],
        "line-width": ["case", ["get", "closingSoon"], 2.2, ["get", "open"], 1.6, 1],
        "line-opacity": 0.7,
      },
    });

    // Reach bands paint over building fills when an isochrone is active.
    this.map.addLayer({
      id: "skyway-reach-fill",
      type: "fill",
      source: "skyway-reach",
      paint: {
        "fill-color": REACH_COLORS_EXPR,
        "fill-opacity": 0.55,
      },
    });

    // Bridges above fills: confident metro-diagram strokes.
    this.map.addLayer({
      id: "skyway-bridges-casing",
      type: "line",
      source: "skyway-bridges",
      layout: { "line-cap": "round" },
      paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.9 },
    });
    this.map.addLayer({
      id: "skyway-bridges-line",
      type: "line",
      source: "skyway-bridges",
      layout: { "line-cap": "round" },
      paint: {
        "line-color": ["case", ["get", "open"], NETWORK, CLOSED],
        "line-width": ["case", ["get", "open"], 4.5, 3],
        "line-dasharray": ["case", ["get", "open"], ["literal", [1, 0]], ["literal", [1.2, 1.6]]],
      },
    });

    this.map.addLayer({
      id: "skyway-buildings-label",
      type: "symbol",
      source: "skyway-buildings",
      minzoom: 14.8,
      layout: {
        "text-field": ["get", "name"],
        "text-size": 11.5,
        "text-font": ["Noto Sans Bold"],
        "text-max-width": 8,
        "text-letter-spacing": 0.02,
      },
      paint: {
        "text-color": ["case", ["get", "closingSoon"], ROUTE, INK],
        "text-halo-color": "rgba(255,255,255,0.92)",
        "text-halo-width": 1.6,
      },
    });

    // Route draws under the businesses/labels it passes, not over them — a
    // thick line painted last used to blot out whatever it crossed.
    this.map.addLayer({
      id: "skyway-route-casing",
      type: "line",
      source: "skyway-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.95 },
    });
    this.map.addLayer({
      id: "skyway-route-line",
      type: "line",
      source: "skyway-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ROUTE, "line-width": 4.5 },
    });

    // Businesses appear as you zoom in: icons first, names closer. A glyph
    // (cup, bag, person, star…) says what's there without a tap; a plain
    // dot only said "something's here."
    // Transit stops wait for a deeper zoom — 121 of them would swamp the map.
    this.map.addLayer({
      id: "skyway-pois",
      type: "symbol",
      source: "skyway-pois",
      minzoom: 14.8,
      filter: ["!=", ["get", "group"], "transit"],
      layout: {
        "icon-image": ["concat", "poi-icon-", ["get", "group"]],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 14.8, 0.34, 17, 0.55],
        "icon-allow-overlap": true,
      },
    });
    this.map.addLayer({
      id: "skyway-pois-transit",
      type: "symbol",
      source: "skyway-pois",
      minzoom: 16.2,
      filter: ["==", ["get", "group"], "transit"],
      layout: {
        "icon-image": "poi-icon-transit",
        "icon-size": 0.4,
        "icon-allow-overlap": true,
      },
    });
    this.map.addLayer({
      id: "skyway-pois-label",
      type: "symbol",
      source: "skyway-pois",
      minzoom: 15.8,
      filter: ["!=", ["get", "group"], "transit"],
      layout: {
        "text-field": ["get", "name"],
        "text-size": 10.5,
        "text-font": ["Noto Sans Regular"],
        "text-max-width": 7,
        "text-offset": [0, 0.9],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: {
        "text-color": ["get", "color"],
        "text-halo-color": "rgba(255,255,255,0.92)",
        "text-halo-width": 1.3,
      },
    });

    this.map.addLayer({
      id: "skyway-walker",
      type: "circle",
      source: "skyway-walker",
      paint: {
        "circle-radius": 8,
        "circle-color": ROUTE,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2.5,
      },
    });
  }

  setTime(when: Date) {
    this.when = when;
    if (!this.ready) return;
    (this.map.getSource("skyway-buildings") as maplibregl.GeoJSONSource)?.setData(
      buildingsFC(this.data, when),
    );
    (this.map.getSource("skyway-bridges") as maplibregl.GeoJSONSource)?.setData(
      bridgesFC(this.data, when),
    );
  }

  setRoute(route: RouteResult | null) {
    const apply = () => {
      if (this.routeAnim) cancelAnimationFrame(this.routeAnim);
      this.routeAnim = 0;
      const routeSrc = this.map.getSource("skyway-route") as maplibregl.GeoJSONSource;
      const walkerSrc = this.map.getSource("skyway-walker") as maplibregl.GeoJSONSource;
      for (const m of this.markers) m.remove();
      this.markers = [];
      if (!route || route.steps.length < 2) {
        routeSrc?.setData(lineFC([]));
        walkerSrc?.setData(pointFC(null));
        return;
      }

      const coords = routeCoords(route);
      const first = route.steps[0].building;
      const last = route.steps[route.steps.length - 1].building;
      this.markers.push(
        new maplibregl.Marker({ color: "#16a34a" }).setLngLat([first.lon, first.lat]).addTo(this.map),
        new maplibregl.Marker({ color: "#dc2626" }).setLngLat([last.lon, last.lat]).addTo(this.map),
      );
      const lons = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      this.map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding: { top: 80, bottom: 260, left: 60, right: 60 }, maxZoom: 16 },
      );

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        routeSrc?.setData(lineFC(coords));
        walkerSrc?.setData(pointFC(null));
        return;
      }

      // Draw the route bridge-by-bridge, the walker riding the tip; start
      // once the camera flight has mostly settled.
      const total = polylineMeters(coords);
      const duration = Math.min(2800, Math.max(1300, total * 2));
      const startDelay = 550;
      const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
      const begin = performance.now() + startDelay;
      const frame = (now: number) => {
        const t = Math.min(1, Math.max(0, (now - begin) / duration));
        const partial = sliceAlong(coords, total * easeInOut(t));
        routeSrc?.setData(lineFC(partial));
        walkerSrc?.setData(pointFC(t > 0 && t < 1 ? partial[partial.length - 1] : null));
        if (t < 1) this.routeAnim = requestAnimationFrame(frame);
        else this.routeAnim = 0;
      };
      this.routeAnim = requestAnimationFrame(frame);
    };
    if (this.ready) apply();
    else this.map.once("load", apply);
  }

  /** Manual GPS-drift correction: MapLibre's own blue dot is driven by the
   * Geolocation API and can't be placed programmatically, so a tap
   * correction gets its own marker on the same dot layer the route-draw
   * animation already uses. `null` clears it once real GPS resumes. */
  setManualPosition(coord: [number, number] | null) {
    const walkerSrc = this.map.getSource("skyway-walker") as maplibregl.GeoJSONSource;
    walkerSrc?.setData(pointFC(coord));
  }

  focusBuilding(b: Building) {
    this.map.flyTo({ center: [b.lon, b.lat], zoom: 16 });
  }

  /** Quick-filter the map to one POI group (food, restroom, …), or null for everything. */
  setPoiGroupFilter(group: string | null) {
    const apply = () => {
      const filter: maplibregl.FilterSpecification = group
        ? ["==", ["get", "group"], group]
        : ["!=", ["get", "group"], "transit"];
      this.map.setFilter("skyway-pois", filter);
      this.map.setFilter("skyway-pois-label", filter);
    };
    if (this.ready) apply();
    else this.map.once("load", apply);
  }

  /** Shade reachable buildings by minutes band; null clears the overlay. */
  setReach(entries: { building: Building; minutes: number }[] | null) {
    const apply = () => {
      const fc: FC = {
        type: "FeatureCollection",
        features: (entries ?? []).map((e) => ({
          type: "Feature",
          properties: { minutes: e.minutes },
          geometry: { type: "Polygon", coordinates: [e.building.footprint] },
        })),
      };
      (this.map.getSource("skyway-reach") as maplibregl.GeoJSONSource)?.setData(fc);
      if (entries && entries.length > 1) {
        const lons = entries.flatMap((e) => e.building.footprint.map((c) => c[0]));
        const lats = entries.flatMap((e) => e.building.footprint.map((c) => c[1]));
        this.map.fitBounds(
          [
            [Math.min(...lons), Math.min(...lats)],
            [Math.max(...lons), Math.max(...lats)],
          ],
          { padding: { top: 80, bottom: 260, left: 60, right: 60 }, maxZoom: 15.5 },
        );
      }
    };
    if (this.ready) apply();
    else this.map.once("load", apply);
  }
}
