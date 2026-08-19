import type { IndoorLink, RouteResult } from "./types.ts";
import { haversineMeters } from "./router.ts";

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


/**
 * The walk between one of a building's doors and a point inside it.
 *
 * A building you pass *through* mid-route already gets its real corridor
 * spliced in by findIndoorLink. The buildings you start and finish in never
 * did: the polyline simply put the from/to point at the end, so the first
 * and last legs were straight lines from a door to a pin, drawn over
 * whatever the building happens to contain. On the recorded 1.6 walk that
 * is the 35 m diagonal into 733 Building, cutting across a floor the walker
 * has to walk around.
 *
 * The corridors that reach this door are the walk that actually exists, so
 * take the one that gets nearest the point and follow it while it keeps
 * closing — past its nearest vertex it has started leading away, and that
 * is where the walker leaves it for the last few metres. When no corridor
 * touches the door there is nothing better to say than a straight line, and
 * this returns empty so that is what still gets drawn.
 */
function approachGeometry(
  links: IndoorLink[] | undefined,
  buildingId: string,
  door: [number, number],
  target: [number, number],
): [number, number][] {
  if (!links) return [];
  let best: [number, number][] = [];
  let bestDist = Infinity;
  for (const link of links) {
    if (link.buildingId !== buildingId) continue;
    let path: [number, number][] | null = null;
    if (coordsEqual(link.doorA, door)) path = link.geometry;
    else if (coordsEqual(link.doorB, door)) path = [...link.geometry].reverse();
    if (!path) continue;

    let cut = 0;
    let nearest = Infinity;
    for (let i = 0; i < path.length; i++) {
      const d = haversineMeters(path[i][1], path[i][0], target[1], target[0]);
      if (d < nearest) {
        nearest = d;
        cut = i;
      }
    }
    if (nearest < bestDist) {
      bestDist = nearest;
      // The door itself is already on the line; only the interior
      // waypoints up to the turn-off need adding.
      best = path.slice(1, cut + 1);
    }
  }
  return best;
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
  const steps = route.steps;
  const coordinates: [number, number][] = [fromCoord];
  const firstLeg = steps[1]?.legGeometry;
  if (firstLeg && steps[0]) {
    coordinates.push(
      ...approachGeometry(indoorLinks, steps[0].building.id, firstLeg[0], fromCoord).reverse(),
    );
  }
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
  const lastStep = steps[steps.length - 1];
  const lastLeg = lastStep?.legGeometry;
  if (lastLeg && lastStep) {
    coordinates.push(
      ...approachGeometry(
        indoorLinks,
        lastStep.building.id,
        lastLeg[lastLeg.length - 1],
        toCoord,
      ),
    );
  }
  coordinates.push(toCoord);
  return coordinates;
}
