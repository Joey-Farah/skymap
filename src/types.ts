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

export interface SkymapData {
  meta: { name: string; source: string; disclaimer: string; generated: string };
  buildings: Building[];
  edges: Edge[];
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
