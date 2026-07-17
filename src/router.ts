import type { Building, RouteResult, RouteStep, SkymapData } from "./types.ts";
import { isOpenAt } from "./hours.ts";

export const WALK_METERS_PER_MIN = 78; // ~2.9 mph indoor pace
const BUILDING_TRANSIT_MIN = 0.75; // corridors, escalators, doors per building passed

export function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la = (aLat * Math.PI) / 180;
  const lb = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function polylineMeters(coords: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineMeters(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  }
  return total;
}

/**
 * Prefix of `coords` covering the first `meters` of the line, ending in an
 * interpolated point when the cut falls inside a leg. Clamps to the whole
 * line. Powers the route draw-on animation and the walking dot.
 */
export function sliceAlong(coords: [number, number][], meters: number): [number, number][] {
  if (meters <= 0 || coords.length === 0) return coords.slice(0, 1);
  const out: [number, number][] = [coords[0]];
  let walked = 0;
  for (let i = 1; i < coords.length; i++) {
    const leg = haversineMeters(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    if (walked + leg >= meters) {
      const t = leg === 0 ? 0 : (meters - walked) / leg;
      if (t >= 1 - 1e-9) out.push(coords[i]);
      else
        out.push([
          coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
          coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
        ]);
      return out;
    }
    walked += leg;
    out.push(coords[i]);
  }
  return out;
}

/** Closest building to a GPS fix, within `maxMeters`, or null if nothing's close. */
export function nearestBuilding(
  lat: number,
  lon: number,
  buildings: Building[],
  maxMeters: number,
): Building | null {
  let best: Building | null = null;
  let bestDist = maxMeters;
  for (const b of buildings) {
    const d = haversineMeters(lat, lon, b.lat, b.lon);
    if (d <= bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return best;
}

/**
 * Which step of an active route a live GPS fix is closest to — building
 * granularity, not polyline projection, since "you're at building X" is
 * what a turn-by-turn prompt needs.
 */
export function routeStepIndex(route: RouteResult, lat: number, lon: number): number {
  let best = 0;
  let bestDist = Infinity;
  route.steps.forEach((step, i) => {
    const d = haversineMeters(lat, lon, step.building.lat, step.building.lon);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

interface GraphEdge {
  to: string;
  meters: number;
  crossing: string;
  /** Real bridge polyline oriented in the direction of travel, when known. */
  geometry?: [number, number][];
  hasSteps?: boolean;
  openAir?: boolean;
}

export class SkywayRouter {
  private buildings = new Map<string, Building>();
  private adjacency = new Map<string, GraphEdge[]>();

  constructor(data: SkymapData) {
    for (const b of data.buildings) {
      this.buildings.set(b.id, b);
      this.adjacency.set(b.id, []);
    }
    for (const e of data.edges) {
      const from = this.buildings.get(e.from)!;
      const to = this.buildings.get(e.to)!;
      const meters = e.geometry
        ? polylineMeters(e.geometry)
        : haversineMeters(from.lat, from.lon, to.lat, to.lon);
      this.adjacency
        .get(e.from)!
        .push({ to: e.to, meters, crossing: e.crossing, geometry: e.geometry, hasSteps: e.hasSteps, openAir: e.openAir });
      this.adjacency.get(e.to)!.push({
        to: e.from,
        meters,
        crossing: e.crossing,
        geometry: e.geometry && [...e.geometry].reverse(),
        hasSteps: e.hasSteps,
        openAir: e.openAir,
      });
    }
  }

  building(id: string): Building | undefined {
    return this.buildings.get(id);
  }

  /**
   * Every building reachable from `fromId` within `maxMinutes`, mapped to
   * walking minutes (same cost model as routes). Buildings closed at `when`
   * are not traversable; pass null for hours-blind reach.
   */
  reachable(
    fromId: string,
    when: Date | null,
    maxMinutes: number,
    options: { accessible?: boolean; closedEdges?: Set<string> } = {},
  ): Map<string, number> {
    const minutes = new Map<string, number>([[fromId, 0]]);
    if (!this.buildings.has(fromId)) return new Map();
    const open = new Set<string>([fromId]);
    while (open.size > 0) {
      let current = "";
      let best = Infinity;
      for (const id of open) {
        const m = minutes.get(id) ?? Infinity;
        if (m < best) {
          best = m;
          current = id;
        }
      }
      open.delete(current);
      for (const edge of this.adjacency.get(current) ?? []) {
        if (options.accessible && edge.hasSteps) continue;
        if (options.closedEdges?.has([current, edge.to].sort().join("|"))) continue;
        const b = this.buildings.get(edge.to)!;
        if (when && edge.to !== fromId && !isOpenAt(b, when)) continue;
        const transit = current === fromId ? 0 : BUILDING_TRANSIT_MIN;
        const tentative = best + transit + edge.meters / WALK_METERS_PER_MIN;
        if (tentative <= maxMinutes && tentative < (minutes.get(edge.to) ?? Infinity)) {
          minutes.set(edge.to, tentative);
          open.add(edge.to);
        }
      }
    }
    return minutes;
  }

  /**
   * A* shortest path. When `when` is set, buildings closed at that time are
   * not traversable (origin and destination are exempt so you can still
   * route "to the door"). Falls back to hours-blind routing when no open
   * route exists, flagging the result.
   */
  route(
    fromId: string,
    toId: string,
    when: Date | null,
    options: { accessible?: boolean; closedEdges?: Set<string> } = {},
  ): RouteResult | null {
    const strict = this.search(fromId, toId, when, options);
    if (strict) return { ...strict, ignoredClosures: false };
    if (when) {
      const blind = this.search(fromId, toId, null, options);
      if (blind) return { ...blind, ignoredClosures: true };
    }
    return null;
  }

  private search(
    fromId: string,
    toId: string,
    when: Date | null,
    options: { accessible?: boolean; closedEdges?: Set<string> } = {},
  ): Omit<RouteResult, "ignoredClosures"> | null {
    const goal = this.buildings.get(toId);
    const start = this.buildings.get(fromId);
    if (!goal || !start) return null;

    const dist = new Map<string, number>([[fromId, 0]]);
    const prev = new Map<
      string,
      { id: string; crossing: string; meters: number; geometry?: [number, number][]; hasSteps?: boolean; openAir?: boolean }
    >();
    const open = new Set<string>([fromId]);
    const fScore = new Map<string, number>([
      [fromId, haversineMeters(start.lat, start.lon, goal.lat, goal.lon)],
    ]);
    const closed = new Set<string>();

    while (open.size > 0) {
      let current = "";
      let best = Infinity;
      for (const id of open) {
        const f = fScore.get(id) ?? Infinity;
        if (f < best) {
          best = f;
          current = id;
        }
      }
      if (current === toId) return this.reconstruct(fromId, toId, prev, dist.get(toId)!);
      open.delete(current);
      closed.add(current);

      for (const edge of this.adjacency.get(current) ?? []) {
        if (closed.has(edge.to)) continue;
        if (options.accessible && edge.hasSteps) continue;
        if (options.closedEdges?.has([current, edge.to].sort().join("|"))) continue;
        const b = this.buildings.get(edge.to)!;
        const isEndpoint = edge.to === toId || edge.to === fromId;
        if (when && !isEndpoint && !isOpenAt(b, when)) continue;
        const tentative = dist.get(current)! + edge.meters;
        if (tentative < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, tentative);
          prev.set(edge.to, {
            id: current,
            crossing: edge.crossing,
            meters: edge.meters,
            geometry: edge.geometry,
            hasSteps: edge.hasSteps,
            openAir: edge.openAir,
          });
          fScore.set(edge.to, tentative + haversineMeters(b.lat, b.lon, goal.lat, goal.lon));
          open.add(edge.to);
        }
      }
    }
    return null;
  }

  private reconstruct(
    fromId: string,
    toId: string,
    prev: Map<
      string,
      { id: string; crossing: string; meters: number; geometry?: [number, number][]; hasSteps?: boolean; openAir?: boolean }
    >,
    totalMeters: number,
  ): Omit<RouteResult, "ignoredClosures"> {
    const steps: RouteStep[] = [];
    let cursor: string | undefined = toId;
    while (cursor) {
      const p = prev.get(cursor);
      steps.unshift({
        building: this.buildings.get(cursor)!,
        viaCrossing: p?.crossing,
        legMeters: p?.meters,
        legGeometry: p?.geometry,
        hasSteps: p?.hasSteps,
        openAir: p?.openAir,
        arrivalMinutes: 0,
      });
      cursor = cursor === fromId ? undefined : p?.id;
    }
    // Arrival at step i: walking time so far, plus the per-building transit
    // penalty for each intermediate building already crossed.
    let walked = 0;
    for (let i = 1; i < steps.length; i++) {
      walked += steps[i].legMeters ?? 0;
      steps[i].arrivalMinutes = walked / WALK_METERS_PER_MIN + (i - 1) * BUILDING_TRANSIT_MIN;
    }
    const totalMinutes =
      totalMeters / WALK_METERS_PER_MIN + Math.max(0, steps.length - 2) * BUILDING_TRANSIT_MIN;
    return { steps, totalMeters, totalMinutes };
  }
}
