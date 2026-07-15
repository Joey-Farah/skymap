import type { Building, RouteResult, RouteStep, SkymapData } from "./types.ts";
import { isOpenAt } from "./hours.ts";

const WALK_METERS_PER_MIN = 78; // ~2.9 mph indoor pace
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

interface GraphEdge {
  to: string;
  meters: number;
  crossing: string;
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
      this.adjacency.get(e.from)!.push({ to: e.to, meters, crossing: e.crossing });
      this.adjacency.get(e.to)!.push({ to: e.from, meters, crossing: e.crossing });
    }
  }

  building(id: string): Building | undefined {
    return this.buildings.get(id);
  }

  /**
   * A* shortest path. When `when` is set, buildings closed at that time are
   * not traversable (origin and destination are exempt so you can still
   * route "to the door"). Falls back to hours-blind routing when no open
   * route exists, flagging the result.
   */
  route(fromId: string, toId: string, when: Date | null): RouteResult | null {
    const strict = this.search(fromId, toId, when);
    if (strict) return { ...strict, ignoredClosures: false };
    if (when) {
      const blind = this.search(fromId, toId, null);
      if (blind) return { ...blind, ignoredClosures: true };
    }
    return null;
  }

  private search(
    fromId: string,
    toId: string,
    when: Date | null,
  ): Omit<RouteResult, "ignoredClosures"> | null {
    const goal = this.buildings.get(toId);
    const start = this.buildings.get(fromId);
    if (!goal || !start) return null;

    const dist = new Map<string, number>([[fromId, 0]]);
    const prev = new Map<string, { id: string; crossing: string; meters: number }>();
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
        const b = this.buildings.get(edge.to)!;
        const isEndpoint = edge.to === toId || edge.to === fromId;
        if (when && !isEndpoint && !isOpenAt(b, when)) continue;
        const tentative = dist.get(current)! + edge.meters;
        if (tentative < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, tentative);
          prev.set(edge.to, { id: current, crossing: edge.crossing, meters: edge.meters });
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
    prev: Map<string, { id: string; crossing: string; meters: number }>,
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
      });
      cursor = cursor === fromId ? undefined : p?.id;
    }
    const totalMinutes =
      totalMeters / WALK_METERS_PER_MIN + Math.max(0, steps.length - 2) * BUILDING_TRANSIT_MIN;
    return { steps, totalMeters, totalMinutes };
  }
}
