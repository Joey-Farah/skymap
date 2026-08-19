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

/**
 * How far below the furthest point reached a fix may pull the estimate.
 *
 * A walker standing still still produces fixes that wander, and their
 * along-route component is as often backwards as forwards. Without slack in
 * both directions a stationary walker either creeps forward or gets pinned,
 * and a fix that lands behind a drifted estimate can't correct it.
 *
 * Measured from the high-water mark rather than from the current estimate,
 * because those two readings differ exactly where the bug lived. Against the
 * current estimate the allowance is spent again on every fix, so a patch of
 * fixes biased the same way — indoor reception lagging behind the walker,
 * which is what a recorded 1.6 walk shows at 2:57 — marches the dot down the
 * route 8 m at a time while its owner walks forwards. Against the high-water
 * mark the same allowance is a band the estimate rattles inside: jitter
 * costs nothing, and sustained bias stalls instead of accumulating.
 *
 * Rate-limiting the retreat instead — capping it at MAX_WALK_SPEED, so the
 * dot can't go backwards faster than a walker goes forwards — was tried
 * first and measured worse: it only slowed the slide (32 m to 22 m) and cost
 * real accuracy elsewhere, taking worst placement under 90 m of drift from
 * 25 m to 34 m, because recovering from scatter genuinely needs the room.
 */
const BACK_SLACK = 8; // m

/**
 * How many consecutive fixes have to agree before the high-water mark moves.
 *
 * The mark can't be the plain maximum of what we've seen. A walker standing
 * still throws fixes both ways, the mark records the luckiest one, and since
 * the floor sits BACK_SLACK below the mark, the estimate can never come back
 * down to the truth — the dot creeps to the destination on noise alone, which
 * is the failure the stationary test exists to catch.
 *
 * So the mark advances to the *weakest* of the last few candidates instead of
 * the strongest. Scatter can't move it, because one fix reading short holds it
 * back; sustained walking does, because every candidate in the window has
 * moved up. It is the same evidence-over-magnitude reasoning the off-route
 * detector uses, applied to progress rather than departure.
 */
const CONFIRM_FIXES = 3;
const FORWARD_SLACK = 8; // m

/**
 * How far a fix must sit from where we believe the walker is before that
 * gap stops being explainable as drift.
 *
 * This can't be tight. Indoor error alone reaches 90 m in the recorded
 * walks, and a threshold inside that band would announce "you've left the
 * route" to someone standing squarely on a skyway — the exact false
 * confidence this whole change exists to remove. So the cost is asymmetric
 * and deliberate: a genuine departure takes a while to notice, and in
 * exchange nobody walking their route is ever told they aren't.
 */
const OFF_ROUTE_METERS = 100;

/** Consecutive fixes past that distance before we believe it. One wild fix
 * is a wild fix; five in a row is a walker somewhere else. */
const OFF_ROUTE_FIXES = 5;

/**
 * How much further away the fixes must have got over that run.
 *
 * Distance alone can't separate the two cases — 90 m of indoor drift and
 * 90 m of walking away are the same number. What separates them is shape:
 * drift rattles around a distance, while someone leaving gets steadily
 * further away, at walking pace, and never comes back. Requiring the gap
 * to have *grown* keeps a drifting walker on their route without needing
 * a threshold so high that leaving takes a block to notice.
 */
const OFF_ROUTE_GROWTH = 25; // m

/** How close a fix has to come back before we start trusting the route
 * again. Tighter than leaving, so recovery needs real evidence rather than
 * one lucky sample. */
const REACQUIRE_METERS = 30;

export interface Placement {
  /** Where to draw the walker, [lon, lat] — always a point on the route. */
  coord: [number, number];
  /** How far along the route that is, in metres. */
  alongMeters: number;
  /** How far is left to walk from there. */
  remainingMeters: number;
  /**
   * The fixes stopped being explainable by walking this route. The position
   * is the last one we believed, held still — it is stale by construction,
   * and the UI owes the walker that fact rather than a confident dot.
   */
  offRoute: boolean;
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
  /** The furthest along the walker has been believed to be. The backward
   * allowance is measured from here rather than from the current estimate,
   * which is what stops it accumulating — see BACK_SLACK. */
  private furthest = 0;
  /** The last few candidates, so the high-water mark can be advanced by the
   * weakest of them rather than by the luckiest — see CONFIRM_FIXES. */
  private recent: number[] = [];
  private atMs: number;
  /** Consecutive fixes too far away to explain by walking. */
  private streak = 0;
  private offRoute = false;
  private gapAtStreakStart = 0;

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
    this.atMs = atMs;

    if (this.offRoute) {
      // Already lost them. Re-acquisition is unconstrained on purpose: a
      // walker who rejoins the route may do so a long way from where they
      // left it, and making them earn it back at walking pace would keep
      // the dot wrong for the rest of the trip.
      const candidate = this.nearestAlong(lat, lon, 0, this.total);
      if (this.residual(lat, lon, candidate) <= REACQUIRE_METERS) {
        this.along = candidate;
        this.furthest = candidate;
        this.recent = [];
        this.offRoute = false;
        this.streak = 0;
      }
      return this.placement();
    }

    const reach = MAX_WALK_SPEED * seconds;
    const candidate = this.nearestAlong(
      lat,
      lon,
      Math.max(this.along, this.furthest) - BACK_SLACK,
      this.along + reach + FORWARD_SLACK,
    );

    const gap = this.residual(lat, lon, candidate);
    if (gap > OFF_ROUTE_METERS) {
      if (this.streak === 0) this.gapAtStreakStart = gap;
      this.streak++;
    } else {
      this.streak = 0;
    }

    // Suspicion alone must not stop the dot. A walker in a bad patch of
    // indoor GPS throws single fixes past the threshold routinely, and
    // holding position on each one leaves them standing still on screen
    // while they walk — the same complaint in a quieter form. Only the
    // conclusion freezes anything.
    if (this.streak >= OFF_ROUTE_FIXES && gap - this.gapAtStreakStart >= OFF_ROUTE_GROWTH) {
      this.offRoute = true;
      return this.placement();
    }

    this.along = candidate;
    this.recent.push(candidate);
    if (this.recent.length > CONFIRM_FIXES) this.recent.shift();
    if (this.recent.length === CONFIRM_FIXES) {
      this.furthest = Math.max(this.furthest, Math.min(...this.recent));
    }
    return this.placement();
  }

  /**
   * Put the walker here, no questions asked — a tap on the route.
   *
   * Someone correcting the app by hand is not another noisy sample, and
   * feeding it through the motion window would make the tap unable to fix
   * the very situation it exists for: an estimate that has settled
   * somewhere wrong and will only crawl away from there.
   */
  moveTo(lat: number, lon: number): Placement {
    this.along = this.nearestAlong(lat, lon, 0, this.total);
    this.furthest = this.along;
    this.recent = [];
    this.offRoute = false;
    this.streak = 0;
    return this.placement();
  }

  /** How far the fix sits from a candidate position on the route. */
  private residual(lat: number, lon: number, along: number): number {
    const p = this.pointAt(along);
    return haversineMeters(lat, lon, p[1], p[0]);
  }

  private placement(): Placement {
    const along = this.along;
    return {
      coord: this.pointAt(along),
      alongMeters: along,
      remainingMeters: Math.max(0, this.total - along),
      offRoute: this.offRoute,
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
