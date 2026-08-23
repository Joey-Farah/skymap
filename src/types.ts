/** [openMinute, closeMinute] within a day, or null when closed all day. */
export type DayHours = [number, number] | null;

export interface Building {
  id: string;
  name: string;
  address: string;
  category:
    | "retailHub"
    | "office"
    | "government"
    | "hotel"
    | "venue"
    | "parking"
    | "hospital"
    | "residential";
  lat: number;
  lon: number;
  /** Closed polygon ring, [lon, lat] pairs. */
  footprint: [number, number][];
  /** Sunday-first weekly hours, or null when nobody publishes them.
   *
   * null is not "closed all week" — it is the absence of a claim. See
   * isOpenAt in hours.ts for why the two must stay distinguishable. */
  hours: DayHours[] | null;
  hoursNote: string;
  /** Landmark photo from Wikimedia Commons, via the building's OSM wikidata tag. */
  image?: { url: string; attribution: string; sourceUrl: string };
}

export interface Edge {
  from: string;
  to: string;
  crossing: string;
  /** Optional real path geometry ([lon, lat] pairs) from OSM extraction. */
  geometry?: [number, number][];
  /** True when this crossing includes a flight of stairs (OSM highway=steps). */
  hasSteps?: boolean;
  /** True when this crossing isn't confirmed enclosed (no indoor/covered/
   * tunnel/corridor tag or "Minneapolis Skyway" name) — may mean a brief
   * outdoor or uncovered stretch. */
  openAir?: boolean;
}

import type { PoiGroup } from "./poi.ts";

/** A business/amenity inside (or, for transit, right outside) a skyway building. */
export interface Poi {
  id: string;
  name: string;
  /** OSM value: "cafe", "restaurant", "clothes", "bus_stop", … */
  category: string;
  /** Which tag family it came from: "amenity", "shop", "leisure", "tourism",
   * "transit" — or "building", for the marker a building gets so it appears
   * under its own category's chip. See landmarkNear: a "building" record is
   * never a wayfinding cue. */
  kind: string;
  /** Display/styling group, derived from kind+category at extraction. */
  group: PoiGroup;
  lat: number;
  lon: number;
  buildingId: string;
  /** True for street-level features attached to their nearest building (transit). */
  exterior?: boolean;
  /** True when the place isn't inside buildingId — that's just the nearest
   * building the skyway reaches. Stays searchable (unlike `exterior`), but
   * the card must say "nearest skyway access" rather than name it as the
   * place's own building. */
  nearby?: boolean;
  /** Raw OSM level tag when present ("1", "0-1", …); "1" is the skyway level. */
  level?: string;
  /** Raw OSM opening_hours when present. */
  openingHours?: string;
  /** Business website from OSM (or resolved from brand:wikidata). */
  website?: string;
  /** Key into public/logos/<logo>.png, set when a favicon was bundled at build time. */
  logo?: string;
}

/** Real indoor walking path between two of a building's own skyway doors —
 * used when a route passes through (arrives via one bridge, leaves via
 * another) so that stretch traces the actual corridor instead of a
 * straight line between two unrelated interior points. */
export interface IndoorLink {
  buildingId: string;
  doorA: [number, number];
  doorB: [number, number];
  geometry: [number, number][];
}

export interface SkymapData {
  meta: { name: string; source: string; disclaimer: string; generated: string };
  buildings: Building[];
  edges: Edge[];
  pois?: Poi[];
  indoorLinks?: IndoorLink[];
}

export interface RouteStep {
  building: Building;
  /** Crossing description for the bridge leading INTO this building (absent on the first step). */
  viaCrossing?: string;
  /** Meters walked on the bridge leading into this building. */
  legMeters?: number;
  /** Real bridge polyline into this building ([lon, lat]), travel-oriented. */
  legGeometry?: [number, number][];
  /** True when the crossing leading into this building has stairs. */
  hasSteps?: boolean;
  /** True when the crossing leading into this building isn't confirmed
   * enclosed — may mean a brief outdoor or uncovered stretch. */
  openAir?: boolean;
  /** Minutes after departure when the walker reaches this building. */
  arrivalMinutes: number;
}

export interface RouteResult {
  steps: RouteStep[];
  /** The skyway walk only. Turn-by-turn progress measures against these,
   * so they must not include the outdoor approach below — by the time
   * you're navigating, that leg is already behind you. */
  totalMeters: number;
  totalMinutes: number;
  /** True when the route was only possible by ignoring closures. */
  ignoredClosures: boolean;
  /** The outdoor walk onto the network, when the trip started from a
   * position that wasn't on it yet. Absent when you were already there.
   * See tripMinutes/tripMeters for the door-to-door totals. */
  approach?: {
    meters: number;
    minutes: number;
    buildingName: string;
  };
}
