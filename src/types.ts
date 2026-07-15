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
  /** Sunday-first weekly hours. */
  hours: DayHours[];
  hoursNote: string;
}

export interface Edge {
  from: string;
  to: string;
  crossing: string;
  /** Optional real path geometry ([lon, lat] pairs) from OSM extraction. */
  geometry?: [number, number][];
}

/** A business/amenity inside a skyway-connected building. */
export interface Poi {
  id: string;
  name: string;
  /** OSM value: "cafe", "restaurant", "clothes", "hairdresser", … */
  category: string;
  /** Which side of the tags it came from. */
  kind: "amenity" | "shop" | "leisure";
  lat: number;
  lon: number;
  buildingId: string;
  /** Raw OSM level tag when present ("1", "0-1", …); "1" is the skyway level. */
  level?: string;
  /** Raw OSM opening_hours when present. */
  openingHours?: string;
}

export interface SkymapData {
  meta: { name: string; source: string; disclaimer: string; generated: string };
  buildings: Building[];
  edges: Edge[];
  pois?: Poi[];
}

export interface RouteStep {
  building: Building;
  /** Crossing description for the bridge leading INTO this building (absent on the first step). */
  viaCrossing?: string;
  /** Meters walked on the bridge leading into this building. */
  legMeters?: number;
  /** Real bridge polyline into this building ([lon, lat]), travel-oriented. */
  legGeometry?: [number, number][];
  /** Minutes after departure when the walker reaches this building. */
  arrivalMinutes: number;
}

export interface RouteResult {
  steps: RouteStep[];
  totalMeters: number;
  totalMinutes: number;
  /** True when the route was only possible by ignoring closures. */
  ignoredClosures: boolean;
}
