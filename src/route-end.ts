import type { Building, Poi } from "./types.ts";

/** Where a route actually starts or finishes for a picked place. */
export interface RouteEnd {
  /** The network building the route runs to. */
  buildingId: string;
  /** The marker's own spot, when it isn't the building's. */
  coord: [number, number] | undefined;
  /** The place sits outside the network: the line stops at the building's
   * door rather than being drawn on to the marker. */
  nearby: boolean;
}

/** A business marks its own spot. A curated ramp has no traced skyway link,
 * so it routes through the building its operator names, and nothing is drawn
 * across the stretch nobody has mapped. */
export function routeEnd(building: Building, poi: Poi | null): RouteEnd {
  if (poi) return { buildingId: poi.buildingId, coord: [poi.lon, poi.lat], nearby: poi.nearby ?? false };
  const access = building.skywayAccess?.[0];
  if (access) return { buildingId: access, coord: [building.lon, building.lat], nearby: true };
  return { buildingId: building.id, coord: undefined, nearby: false };
}
