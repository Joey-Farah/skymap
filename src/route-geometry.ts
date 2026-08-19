import type { IndoorLink, RouteResult } from "./types.ts";

function coordsEqual(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
}

/** A through-building's real indoor path between the door it's entered by
 * and the door it's left by — checked in both directions since a link's
 * own doorA/doorB order doesn't necessarily match the route's direction
 * of travel through it. */
function findIndoorLink(
  links: IndoorLink[] | undefined,
  buildingId: string,
  arrival: [number, number],
  departure: [number, number],
): [number, number][] | null {
  if (!links) return null;
  for (const link of links) {
    if (link.buildingId !== buildingId) continue;
    if (coordsEqual(link.doorA, arrival) && coordsEqual(link.doorB, departure)) return link.geometry;
    if (coordsEqual(link.doorB, arrival) && coordsEqual(link.doorA, departure)) {
      return [...link.geometry].reverse();
    }
  }
  return null;
}

/** Full route polyline: real bridge geometry when present, centroids otherwise.
 * Starts/ends at the actual from/to point (a POI's precise spot, when
 * there is one) rather than the origin building's centroid — anchoring
 * the line there instead drew a straight cut from the building's
 * interior middle out to the skyway door, which reads as the route
 * "skipping across the building" instead of leaving from where the pin
 * actually is. Passing through a building mid-route gets the same
 * treatment: the real indoor path between the door it arrives through
 * and the door it leaves through, not a straight line between them. */
export function routeCoords(
  route: RouteResult,
  fromCoord: [number, number],
  toCoord: [number, number],
  indoorLinks?: IndoorLink[],
): [number, number][] {
  const coordinates: [number, number][] = [fromCoord];
  const steps = route.steps;
  for (let i = 1; i < steps.length; i++) {
    const s = steps[i];
    if (s.legGeometry) coordinates.push(...s.legGeometry);
    else coordinates.push([s.building.lon, s.building.lat]);

    const next = steps[i + 1];
    if (next?.legGeometry && s.legGeometry) {
      const arrival = s.legGeometry[s.legGeometry.length - 1];
      const departure = next.legGeometry[0];
      const indoor = findIndoorLink(indoorLinks, s.building.id, arrival, departure);
      // Both endpoints are already present (arrival just pushed above,
      // departure is next.legGeometry's own first point) — only the
      // interior waypoints need splicing in.
      if (indoor) coordinates.push(...indoor.slice(1, -1));
    }
  }
  coordinates.push(toCoord);
  return coordinates;
}
