import type { Building, IndoorLink, RouteResult, RouteStep, SkymapData } from "./types.ts";
import { isOpenAt } from "./hours.ts";

export const WALK_METERS_PER_MIN = 78; // ~2.9 mph indoor pace
// Non-distance friction per building passed through — elevators, doors,
// reading signs, general disorientation. Distinct from (and additive
// with) the real walking distance through that building: this constant
// alone used to stand in for the whole thing, silently assuming every
// building's door-to-door walk was ~58m (0.75min * 78m/min) regardless
// of how far it actually was — real indoor distance is used when known
// (see indoorLinkMeters), this stays as the leftover non-distance cost.
const BUILDING_TRANSIT_MIN = 0.75;

function coordsEqual(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
}

/** Real walking distance between two of a building's skyway doors, when
 * we have it — checked in both directions since a link's own doorA/doorB
 * order doesn't necessarily match the direction of travel. */
function indoorLinkMeters(
  links: IndoorLink[],
  buildingId: string,
  doorA: [number, number],
  doorB: [number, number],
): number | null {
  for (const link of links) {
    if (link.buildingId !== buildingId) continue;
    const matches =
      (coordsEqual(link.doorA, doorA) && coordsEqual(link.doorB, doorB)) ||
      (coordsEqual(link.doorB, doorA) && coordsEqual(link.doorA, doorB));
    if (matches) return polylineMeters(link.geometry);
  }
  return null;
}

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

/** Closest point on a segment [a, b] to p — plain linear interpolation in
 * lon/lat, not geodesic, but segments here (a route leg, a building edge)
 * are short enough that the difference is noise. */
export function nearestOnSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): [number, number] {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return a;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / lenSq));
  return [a[0] + t * abx, a[1] + t * aby];
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

/** A thing with a position and, usually, an outline — a building, or
 * anything else callers want measured the same way. */
export interface Footprinted {
  lat: number;
  lon: number;
  footprint?: [number, number][];
}

/** Even-odd ray cast in lon/lat; footprints are small enough that treating
 * them as planar is noise. */
export function pointInRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * How far a point is from a building's actual outline — 0 anywhere inside
 * it, else the nearest point on any footprint edge, falling back to the
 * centroid for a building with no footprint at all.
 */
export function distanceToFootprint(lat: number, lon: number, b: Footprinted): number {
  if (!b.footprint || b.footprint.length < 2) return haversineMeters(lat, lon, b.lat, b.lon);
  if (b.footprint.length > 2 && pointInRing(lon, lat, b.footprint)) return 0;
  let best = Infinity;
  for (let i = 0; i < b.footprint.length; i++) {
    const p = nearestOnSegment([lon, lat], b.footprint[i], b.footprint[(i + 1) % b.footprint.length]);
    best = Math.min(best, haversineMeters(lat, lon, p[1], p[0]));
  }
  return best;
}

/**
 * Closest building to a GPS fix, within `maxMeters` of its outline, or null
 * if nothing's close.
 *
 * Measured to the footprint, not the centroid. A centroid measurement asks
 * "are you near the middle of this building", which is the wrong question
 * for a downtown block: 62 of the 179 real buildings extend more than 60m
 * from their own centre, so standing at the far end of Ramp A or City
 * Center resolved to *no* building at all — and the "Current Location" row
 * this feeds is omitted rather than guessed, so it simply never appeared in
 * the places people most often start a trip from.
 */
export function nearestBuilding(
  lat: number,
  lon: number,
  buildings: Building[],
  maxMeters: number,
): Building | null {
  return nearestApproach(lat, lon, buildings, maxMeters)?.building ?? null;
}

/**
 * Downtown streets run on a grid, so the walk to a building is never the
 * straight line to it — you go along one block and up another. 1.3x is the
 * standard grid detour factor, and it is the honest direction to err: a
 * time that reads slightly long makes you early, one that reads short
 * makes you late.
 */
export const STREET_DETOUR_FACTOR = 1.3;

/** Below this, you're against the building — GPS wobble, not a walk. */
export const AT_BUILDING_METERS = 15;

export interface Approach {
  building: Building;
  /** Straight-line metres to the building's outline; 0 when inside it. */
  straightMeters: number;
  /** Walking metres, straight line inflated for the street grid. */
  meters: number;
  /** Walking minutes for `meters`, at the app's usual pace. */
  minutes: number;
}

/**
 * The nearest building you could enter the skyway through, and what it
 * costs to get to it on foot.
 *
 * The skyway is a network you have to *join*, and most of the time you are
 * not standing in it yet: across a grid of downtown, the median distance
 * to the nearest network building is 95m, and only 40% of the area is
 * within 60m. Offering "Current Location" only when you were already
 * inside therefore hid it in the majority of the cases someone would want
 * it — outdoors, deciding where to go.
 *
 * What this deliberately does *not* claim is which door to use. OSM's
 * entrance data can't support that (docs/street-access-research.md), so
 * the answer stops at the building, and the caller says so.
 */
export function nearestApproach(
  lat: number,
  lon: number,
  buildings: Building[],
  maxMeters: number,
): Approach | null {
  let best: Building | null = null;
  let bestDist = maxMeters;
  for (const b of buildings) {
    const d = distanceToFootprint(lat, lon, b);
    if (d <= bestDist) {
      bestDist = d;
      best = b;
    }
  }
  if (!best) return null;
  const meters = bestDist * STREET_DETOUR_FACTOR;
  return { building: best, straightMeters: bestDist, meters, minutes: meters / WALK_METERS_PER_MIN };
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

// No real wall-to-door gap is this big — past it, a "nearest footprint
// edge" result is almost certainly the wrong side of the building rather
// than a genuinely distant door.
const EXIT_POINT_MAX_METERS = 20;

/** Where a building's own centroid sits inside a footprint, a route drawn
 * from it cuts straight across the interior on its way to the skyway door
 * — for a building with any real footprint, that reads as ignoring the
 * skyway entirely rather than as "walk to the door first." Anchoring at
 * the footprint point nearest the direction the route actually leaves
 * (the first/last bridge's own attachment point) keeps that segment to
 * roughly the width of the building instead of a full diagonal.
 *
 * Building footprints are hand-traced in OSM and don't always agree with
 * where a bridge's own endpoint node was placed — usually within a meter
 * or two, but occasionally tens of meters off (a courtyard or notch the
 * footprint doesn't cover). When the nearest edge point wildly disagrees
 * with the real door location, trust the door coordinate itself rather
 * than snap to a footprint edge that's probably just the wrong side of
 * the building. */
export function buildingExitPoint(
  building: Pick<Building, "lon" | "lat" | "footprint">,
  towards: [number, number],
): [number, number] {
  const ring = building.footprint;
  if (!ring || ring.length < 2) return [building.lon, building.lat];
  let best: [number, number] = ring[0];
  let bestDist = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const candidate = nearestOnSegment(towards, a, b);
    const dx = candidate[0] - towards[0];
    const dy = candidate[1] - towards[1];
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  if (haversineMeters(best[1], best[0], towards[1], towards[0]) > EXIT_POINT_MAX_METERS) {
    return towards;
  }
  return best;
}

/**
 * Distance left to walk along the route's actual drawn polyline, measured
 * from wherever a live GPS fix projects onto it — not a per-step guess.
 * A step-fraction estimate (arrival step / total steps) reads as frozen
 * for a long stretch while crossing a large building: the step doesn't
 * change until you're closer to the *next* building's centroid than this
 * one's, even though you've been visibly walking the whole time. Snapping
 * to the nearest point on the line instead ticks down continuously
 * regardless of how big any single building along the way is.
 */
export function remainingRouteMeters(coords: [number, number][], lat: number, lon: number): number {
  if (coords.length < 2) return 0;
  const point: [number, number] = [lon, lat];
  let walked = 0;
  let bestOff = Infinity;
  let bestAlong = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const proj = nearestOnSegment(point, a, b);
    const off = haversineMeters(lat, lon, proj[1], proj[0]);
    const along = walked + haversineMeters(a[1], a[0], proj[1], proj[0]);
    if (off < bestOff) {
      bestOff = off;
      bestAlong = along;
    }
    walked += haversineMeters(a[1], a[0], b[1], b[0]);
  }
  return Math.max(0, walked - bestAlong);
}

/**
 * The stretch of route already behind a walker, as its own polyline —
 * everything from the start up to whatever is left to walk.
 *
 * Drawn dimmed over the route, this is the only thing on screen that says
 * how far along you are at a glance: without it the whole line stays lit
 * from origin to destination and only the dot moves, which reads as a
 * route that hasn't started.
 *
 * Takes a distance rather than a position on purpose. The caller decides
 * which remaining figure to believe, and during navigation that is the
 * *settled* one the arrival bar uses — feeding this the raw projection
 * instead put two disagreeing accounts of progress on the same screen,
 * with the grey line un-walking a bridge under drift while the arrival
 * time held still.
 */
export function walkedPrefix(coords: [number, number][], remainingMeters: number): [number, number][] {
  if (coords.length < 2) return coords.slice(0, 1);
  return sliceAlong(coords, polylineMeters(coords) - remainingMeters);
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
  private indoorLinks: IndoorLink[];

  constructor(data: SkymapData) {
    this.indoorLinks = data.indoorLinks ?? [];
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

    // Cost is MINUTES, not bridge metres. reconstruct() reports a trip as
    // bridge distance PLUS the indoor door-to-door walk through every
    // building PLUS a per-building transit penalty, and the search used to
    // optimise only the first of those three. On Moment Apartments -> T3
    // that meant steering by 749 m of bridge while ignoring 1,604 m of
    // indoor walking, and across the network 14.4% of routes came back over
    // a minute slower than an alternative the router itself scores better.
    const dist = new Map<string, number>([[fromId, 0]]);
    // Bridge metres alongside the minutes: reconstruct() needs the distance
    // to report, and the two stopped being the same number the moment the
    // search started costing in time.
    const bridgeMeters = new Map<string, number>([[fromId, 0]]);
    const prev = new Map<
      string,
      { id: string; crossing: string; meters: number; geometry?: [number, number][]; hasSteps?: boolean; openAir?: boolean }
    >();
    const open = new Set<string>([fromId]);
    // Straight-line minutes: still admissible, since no real path beats
    // walking the direct line at full pace.
    const fScore = new Map<string, number>([
      [fromId, haversineMeters(start.lat, start.lon, goal.lat, goal.lon) / WALK_METERS_PER_MIN],
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
      if (current === toId) return this.reconstruct(fromId, toId, prev, bridgeMeters.get(toId)!);
      open.delete(current);
      closed.add(current);

      for (const edge of this.adjacency.get(current) ?? []) {
        if (closed.has(edge.to)) continue;
        if (options.accessible && edge.hasSteps) continue;
        if (options.closedEdges?.has([current, edge.to].sort().join("|"))) continue;
        const b = this.buildings.get(edge.to)!;
        const isEndpoint = edge.to === toId || edge.to === fromId;
        if (when && !isEndpoint && !isOpenAt(b, when)) continue;
        // Crossing `current` costs the walk between the door we arrived by
        // and the door this edge leaves from — the term reconstruct() adds
        // afterwards and the search was blind to. The origin is entered from
        // outside, so it has neither an arrival door nor a transit penalty.
        const arrival = prev.get(current)?.geometry;
        const throughMeters =
          current === fromId || !arrival || !edge.geometry
            ? 0
            : (indoorLinkMeters(this.indoorLinks, current, arrival[arrival.length - 1], edge.geometry[0]) ?? 0);
        const transit = current === fromId ? 0 : BUILDING_TRANSIT_MIN;
        const tentative =
          dist.get(current)! + (edge.meters + throughMeters) / WALK_METERS_PER_MIN + transit;
        if (tentative < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, tentative);
          bridgeMeters.set(edge.to, (bridgeMeters.get(current) ?? 0) + edge.meters);
          prev.set(edge.to, {
            id: current,
            crossing: edge.crossing,
            meters: edge.meters,
            geometry: edge.geometry,
            hasSteps: edge.hasSteps,
            openAir: edge.openAir,
          });
          fScore.set(edge.to, tentative + haversineMeters(b.lat, b.lon, goal.lat, goal.lon) / WALK_METERS_PER_MIN);
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
    // Real indoor distance for each through-building — the walk from the
    // door it's entered by to the door it's left by, when we have that
    // data. Previously uncounted entirely; the flat per-building constant
    // below existed only for non-distance friction, not as a stand-in for
    // the walk itself.
    const throughIndoorMeters: number[] = steps.map(() => 0);
    for (let i = 1; i < steps.length - 1; i++) {
      const arrival = steps[i].legGeometry;
      const departure = steps[i + 1].legGeometry;
      if (!arrival || !departure) continue;
      const m = indoorLinkMeters(this.indoorLinks, steps[i].building.id, arrival[arrival.length - 1], departure[0]);
      if (m !== null) throughIndoorMeters[i] = m;
    }
    // Arrival at step i: walking distance so far (bridges plus real
    // indoor detours already crossed), plus the per-building transit
    // penalty for each intermediate building already crossed.
    let walked = 0;
    let indoorMeters = 0;
    for (let i = 1; i < steps.length; i++) {
      walked += steps[i].legMeters ?? 0;
      // Record the arrival before folding in this building's own indoor
      // crossing: you reach step i at its entry door, having walked through
      // every building *before* it but not yet through it. Adding it first
      // inflated every intermediate arrival by that building's own walk,
      // which closingSoonWarnings() then read as a later arrival than the
      // real one. The final total is unaffected — by the last step every
      // crossing really has happened.
      steps[i].arrivalMinutes = (walked + indoorMeters) / WALK_METERS_PER_MIN + (i - 1) * BUILDING_TRANSIT_MIN;
      indoorMeters += throughIndoorMeters[i];
    }
    const finalMeters = totalMeters + indoorMeters;
    const totalMinutes =
      finalMeters / WALK_METERS_PER_MIN + Math.max(0, steps.length - 2) * BUILDING_TRANSIT_MIN;
    return { steps, totalMeters: finalMeters, totalMinutes };
  }
}

/**
 * Attach the outdoor walk that gets you onto the network.
 *
 * Kept as a separate leg rather than folded into totalMeters/totalMinutes
 * on purpose. Those two drive turn-by-turn progress, which measures how
 * far along the *skyway* you are — and by the time you're navigating, the
 * outdoor leg is already behind you. Adding it to them would make the
 * remaining distance read high for the whole trip.
 *
 * So the route keeps describing the skyway, and the approach rides
 * alongside it for the one thing it's needed for: the total a person plans
 * by, via tripMinutes/tripMeters.
 */
export function withApproach(route: RouteResult, approach: Approach | null): RouteResult {
  if (!approach || approach.straightMeters <= AT_BUILDING_METERS) return route;
  return {
    ...route,
    approach: {
      meters: approach.meters,
      minutes: approach.minutes,
      buildingName: approach.building.name,
    },
  };
}

/** Door-to-door minutes: the outdoor approach plus the skyway walk. */
export function tripMinutes(route: RouteResult): number {
  return route.totalMinutes + (route.approach?.minutes ?? 0);
}

/** Door-to-door metres, same reasoning as tripMinutes. */
export function tripMeters(route: RouteResult): number {
  return route.totalMeters + (route.approach?.meters ?? 0);
}

/**
 * The buildings on the one big connected skyway, dropping the small
 * isolated clusters.
 *
 * The extraction is not a single network: the live data is 19 components —
 * 133 buildings downtown, plus 18 little islands of two or three (Archdale
 * and Glendale; Mill City Museum and Humboldt Annex; the HCMC ramp group).
 * Each island is a real skyway bridge, but nothing on it reaches the
 * network people mean when they say "the skyway".
 *
 * That matters for choosing where a trip starts. Picking the nearest
 * building outright offers an island 47% of the time across downtown, and
 * every one of those offers ends in "No route found" the moment you tap it
 * — the option that fails when used, which is exactly what the current
 * location row is built to avoid. Restricting to this component covers
 * less ground (67% of downtown rather than 93%) and everything it offers
 * actually goes somewhere.
 */
export function mainNetworkBuildings(data: SkymapData): Building[] {
  const adjacency = new Map<string, string[]>(data.buildings.map((b) => [b.id, []]));
  for (const edge of data.edges) {
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }
  const seen = new Set<string>();
  let largest: string[] = [];
  for (const b of data.buildings) {
    if (seen.has(b.id)) continue;
    const stack = [b.id];
    seen.add(b.id);
    const component: string[] = [];
    while (stack.length) {
      const id = stack.pop()!;
      component.push(id);
      for (const next of adjacency.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    if (component.length > largest.length) largest = component;
  }
  const ids = new Set(largest);
  return data.buildings.filter((b) => ids.has(b.id));
}
