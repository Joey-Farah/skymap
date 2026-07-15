import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Building, RouteResult, SkymapData } from "./types.ts";
import { isOpenAt } from "./hours.ts";
import { polylineMeters, sliceAlong } from "./router.ts";

// Positron: muted grey basemap that lets the skyway network carry the color.
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const DOWNTOWN_CENTER: [number, number] = [-93.2697, 44.976];

/** Minimal style used when the basemap host is unreachable (offline etc.). */
const FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {},
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#f2f2ef" } },
  ],
};

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

/** Use the remote basemap when reachable, else the local fallback. */
export async function resolveStyle(): Promise<string | maplibregl.StyleSpecification> {
  try {
    const res = await fetch(STYLE_URL, { signal: AbortSignal.timeout(5000) });
    if (res.ok) return STYLE_URL;
  } catch {
    // fall through
  }
  console.warn("Basemap unreachable; using offline fallback style.");
  return FALLBACK_STYLE;
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

function pointFC(coord: [number, number] | null): FC {
  if (!coord) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: coord } }],
  };
}

export class SkymapView {
  readonly map: maplibregl.Map;
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
  ) {
    this.data = data;
    this.map = new maplibregl.Map({
      container,
      style,
      center: DOWNTOWN_CENTER,
      zoom: 14.6,
      pitch: 30,
      attributionControl: { compact: true },
    });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    this.map.addControl(
      new maplibregl.GeolocateControl({ trackUserLocation: true, positionOptions: { enableHighAccuracy: true } }),
      "top-right",
    );

    // If the basemap can't load (offline / blocked tiles), keep our overlay
    // usable on a plain background instead of dying.
    this.map.on("error", (e) => console.warn("Map resource error:", e.error?.message));

    this.map.on("load", () => {
      this.ready = true;
      this.addLayers();
    });

    this.map.on("click", "skyway-buildings-fill", (e) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      const b = this.data.buildings.find((x) => x.id === id);
      if (b) onBuildingClick(b);
    });
    this.map.on("mouseenter", "skyway-buildings-fill", () => {
      this.map.getCanvas().style.cursor = "pointer";
    });
    this.map.on("mouseleave", "skyway-buildings-fill", () => {
      this.map.getCanvas().style.cursor = "";
    });
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

    this.map.addLayer({
      id: "skyway-buildings-fill",
      type: "fill",
      source: "skyway-buildings",
      paint: {
        "fill-color": ["case", ["!", ["get", "open"]], CLOSED, ["get", "hub"], NETWORK_DEEP, NETWORK],
        "fill-opacity": ["case", ["get", "open"], 0.16, 0.1],
      },
    });
    this.map.addLayer({
      id: "skyway-buildings-outline",
      type: "line",
      source: "skyway-buildings",
      paint: {
        "line-color": ["case", ["get", "open"], NETWORK, CLOSED],
        "line-width": ["case", ["get", "open"], 1.6, 1],
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
        "text-color": INK,
        "text-halo-color": "rgba(255,255,255,0.92)",
        "text-halo-width": 1.6,
      },
    });

    this.map.addLayer({
      id: "skyway-route-casing",
      type: "line",
      source: "skyway-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": 11, "line-opacity": 0.95 },
    });
    this.map.addLayer({
      id: "skyway-route-line",
      type: "line",
      source: "skyway-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ROUTE, "line-width": 6 },
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

  focusBuilding(b: Building) {
    this.map.flyTo({ center: [b.lon, b.lat], zoom: 16 });
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
