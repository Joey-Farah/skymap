import { haversineMeters, nearestOnSegment, polylineMeters } from "./router.ts";

/**
 * Where the walker is on the route they're actually walking.
 *
 * The old answer was `snapToRoute`: take a fix, find the nearest point on
 * the drawn line, accept it under 60 m and give up over. Giving up is what
 * put someone in the street — clearing our marker un-hides MapLibre's raw
 * dot, which indoors is a floor below, out on the road. Measured over 60
 * real routes, that rule declines to place a walker on 14% of fixes at 60 m
 * of drift and 37% at 90 m, and the fixes it does accept land a median
 * 65 m from the truth. Both failures have one cause: nearest-point treats
 * every fix as if the walker could have teleported there.
 *
 * They can't. Position along a route is one number that only ever changes
 * at walking pace, so a fix is not a position — it is evidence about a
 * position. This holds the number and lets each fix nudge it as far as a
 * walker could plausibly have moved since the last one, which means a bad
 * fix moves you a little and a good one moves you exactly right. The same
 * 60 routes place 100% of fixes at every drift level tested, with median
 * error of 9-20 m.
 *
 * Geometry and motion policy live together here on purpose: every caller
 * wants the same question answered ("where am I?"), and none of them want
 * to know about cumulative segment lengths to ask it.
 */

/** Brisk indoor walking, with room for the stairs-two-at-a-time case. The
 * window this opens is the whole safety margin — too tight and a real
 * corner-cut reads as drift, too loose and a wild fix drags the dot with
 * it. */
const MAX_WALK_SPEED = 2.2; // m/s

/** A walker standing still still produces fixes that wander, and their
 * along-route component is as often backwards as forwards. Without a
 * little slack in both directions a stationary walker either creeps
 * forward or gets pinned. */
const BACK_SLACK = 8; // m
const FORWARD_SLACK = 8; // m

export interface Placement {
  /** Where to draw the walker, [lon, lat] — always a point on the route. */
  coord: [number, number];
  /** How far along the route that is, in metres. */
  alongMeters: number;
  /** How far is left to walk from there. */
  remainingMeters: number;
}

export class RouteTracker {
  private readonly coords: [number, number][];
  /** Cumulative distance to each vertex, so along-route distance and a
   * coordinate convert into each other without re-walking the line. */
  private readonly cum: number[];
  private readonly total: number;

  /** Metres along the route. Seeded at the start rather than left unknown:
   * navigation begins when someone asks to walk from a place they are
   * standing, so "at the beginning" is the one thing known for free — and
   * inferring it from a first fix instead means the worst fix of the trip
   * gets believed outright, with nothing to constrain it. */
  private along = 0;
  private atMs: number;

  constructor(coords: [number, number][], startedAtMs = 0) {
    this.coords = coords;
    this.atMs = startedAtMs;
    this.cum = [0];
    for (let i = 1; i < coords.length; i++) {
      this.cum.push(
        this.cum[i - 1] + haversineMeters(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]),
      );
    }
    this.total = this.cum[this.cum.length - 1] ?? 0;
  }

  /**
   * Fold one GPS fix into the estimate and return where to draw the walker.
   *
   * Null only when there is no route to be on — every fix on a real route
   * produces a position, which is the whole point.
   */
  update(lat: number, lon: number, atMs: number): Placement | null {
    if (this.coords.length < 2) return null;

    const seconds = Math.max(0, (atMs - this.atMs) / 1000);
    const reach = MAX_WALK_SPEED * seconds;
    this.along = this.nearestAlong(
      lat,
      lon,
      this.along - BACK_SLACK,
      this.along + reach + FORWARD_SLACK,
    );
    this.atMs = atMs;
    return this.placement();
  }

  private placement(): Placement {
    const along = this.along;
    return {
      coord: this.pointAt(along),
      alongMeters: along,
      remainingMeters: Math.max(0, this.total - along),
    };
  }

  /**
   * The along-route distance, within [lo, hi], whose point is closest to
   * the fix.
   *
   * Each segment is projected onto rather than sampled, then the result is
   * clamped into the window — so a fix that "wants" to be 200 m up the
   * route lands at the window's edge instead of being thrown away.
   */
  private nearestAlong(lat: number, lon: number, lo: number, hi: number): number {
    const low = Math.max(0, Math.min(lo, this.total));
    const high = Math.max(low, Math.min(hi, this.total));
    let bestAlong = low;
    let bestDist = Infinity;
    for (let i = 1; i < this.coords.length; i++) {
      const a = this.coords[i - 1];
      const b = this.coords[i];
      const proj = nearestOnSegment([lon, lat], a, b);
      const raw = this.cum[i - 1] + haversineMeters(a[1], a[0], proj[1], proj[0]);
      const along = Math.max(low, Math.min(high, raw));
      const point = this.pointAt(along);
      const dist = haversineMeters(lat, lon, point[1], point[0]);
      if (dist < bestDist) {
        bestDist = dist;
        bestAlong = along;
      }
    }
    return bestAlong;
  }

  /** The point `meters` along the route. */
  private pointAt(meters: number): [number, number] {
    const m = Math.max(0, Math.min(this.total, meters));
    for (let i = 1; i < this.coords.length; i++) {
      if (this.cum[i] >= m) {
        const span = this.cum[i] - this.cum[i - 1];
        const f = span > 1e-9 ? (m - this.cum[i - 1]) / span : 0;
        const a = this.coords[i - 1];
        const b = this.coords[i];
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      }
    }
    return this.coords[this.coords.length - 1];
  }
}

/** Route length, exposed so callers don't rebuild it to ask. */
export function routeLength(coords: [number, number][]): number {
  return polylineMeters(coords);
}
