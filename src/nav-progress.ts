/**
 * Keeps the arrival time from walking backwards.
 *
 * Remaining distance is measured by projecting a live GPS fix onto the
 * route line, which is honest but noisy: indoors on a skyway a fix wanders
 * tens of metres, and every wander that lands "behind" the last one pushes
 * the projection back up the route. On a three-minute trip that is enough
 * to move the arrival clock a whole minute — a recorded walk showed
 * 11:15 -> 11:16 -> 11:15 -> 11:14 -> 11:15 while the walker never once
 * stopped or turned around. A time that jumps around is read as broken
 * long before it is read as precise.
 *
 * So remaining distance is held to non-increasing, with one exception: a
 * jump larger than any plausible jitter is a walker who genuinely left the
 * route, and pinning them to a stale figure would be the worse lie. The
 * comparison is always against the settled value rather than the previous
 * raw one, so a sustained walk in the wrong direction crosses the
 * threshold and is believed, while a fix that merely rattles is not.
 *
 * Pure logic, so the noise-handling is testable without a map or a GPS.
 */

/** How far a fix may jump backwards before it is treated as a real detour
 * rather than drift.
 *
 * This has to clear the drift band, not sit inside it: indoor skyway error
 * runs 20-50 m, and map.ts already accepts corrections out to
 * SNAP_MAX_METERS = 60 on exactly that reasoning. A threshold below that
 * would classify the very drift this exists to absorb as a genuine detour
 * and believe it. 75 clears the band with headroom and is still under a
 * downtown block (~100 m), so actually leaving the route still registers
 * before you reach the next one. */
export const DETOUR_METERS = 75;

/** How far the computed arrival instant may move before the walker is shown
 * a new time. Under a minute, so the displayed clock can't be more than one
 * minute stale; over the +/-30s sawtooth that rounding alone produces. */
export const ETA_SETTLE_MS = 45_000;

/**
 * Holds the arrival *clock* still, which is a different problem from
 * holding the remaining distance still.
 *
 * The displayed time is `now + round(minutes remaining)`. `now` advances
 * continuously while the rounded minute count steps in whole units, so the
 * result sawtooths +/-30s around the true arrival and flips across a minute
 * boundary — with a perfectly steady walk and no GPS error at all. That is
 * the 11:15 -> 11:16 -> 11:15 -> 11:14 in the recording; settling the
 * distance does not touch it, because the distance was never the noisy term.
 *
 * So the instant itself is what's held: a recomputation within
 * ETA_SETTLE_MS of what's on screen isn't worth redrawing, and anything
 * larger is a real change the walker should see.
 */
export function settleArrival(settled: number | null, raw: number): number {
  if (settled === null) return raw;
  return Math.abs(raw - settled) > ETA_SETTLE_MS ? raw : settled;
}

/**
 * @param settled the last value shown to the walker, or null to start a trip
 * @param raw     metres remaining as just measured
 */
export function settleRemaining(settled: number | null, raw: number): number {
  if (settled === null) return raw;
  if (raw <= settled) {
    // Forward jumps need policing too. A route that doubles back near
    // itself — routine in a grid of parallel skyways — lets a drifting fix
    // project onto a much later leg, and remaining distance collapses by
    // hundreds of metres in one reading. Rejecting it outright would
    // deadlock (every later fix is measured against the stale value), so
    // it's slew-limited instead: a real jump converges over a few fixes,
    // a spurious one is corrected before it ever reaches the screen.
    const jump = settled - raw;
    return jump > DETOUR_METERS ? settled - DETOUR_METERS : raw;
  }
  return raw - settled > DETOUR_METERS ? raw : settled;
}

/** Smallest turn worth spending a camera frame on. Below this is sensor
 * noise from a hand that isn't moving. */
const ROTATE_DEGREES = 3;
/** Floor between rotations. deviceorientation fires ~60Hz on iOS; this
 * puts a ceiling of ~8 rotations a second, which still reads as smooth
 * while leaving whole frames for a recentre animation to finish in. */
const ROTATE_INTERVAL_MS = 120;

/**
 * Whether a compass reading is worth turning the map for.
 *
 * MapLibre's setBearing routes through jumpTo, which calls stop() and
 * cancels any camera animation in flight — including the geolocate
 * control's own animated recentre. Feeding it every deviceorientation
 * event aborts each recentre a frame or two after it begins, so the map
 * rotates with you and quietly stops following you: exactly backwards for
 * a control that exists to keep you oriented while you walk.
 *
 * Rate-limiting and ignoring sub-degree noise leaves most frames free for
 * the recentre to complete. Walking a corridor holds a near-constant
 * heading, so in the common case this rotates almost never.
 */
export function shouldRotate(
  lastBearing: number | null,
  next: number,
  lastAtMs: number | null,
  nowMs: number,
): boolean {
  if (lastBearing === null || lastAtMs === null) return true;
  if (nowMs - lastAtMs < ROTATE_INTERVAL_MS) return false;
  // Shortest way round the circle: 359 -> 1 is a 2 degree turn, not 358.
  const delta = Math.abs(((next - lastBearing + 540) % 360) - 180);
  return delta >= ROTATE_DEGREES;
}

/**
 * Which building the walker is currently in, derived from how far along the
 * route they are rather than which centroid is nearest.
 *
 * routeStepIndex answers the nearest-centroid question, which is the wrong
 * question here. Downtown footprints are large and their centroids sit close
 * together: walking 33 South Sixth to the Marriott at City Center, the
 * Marriott's centroid is 44 m from City Center's and 19 m *inside* City
 * Center's own footprint, so from 60 m into a 239 m walk the destination is
 * the nearest building and the banner reads "You've arrived" with two thirds
 * of the trip left. Across the network that misfires on 2.5% of routes.
 *
 * Progress has no such artifact: a step is reached when the distance walked
 * reaches the point in the trip where it was due. It also can't go backwards
 * on its own, because the remaining figure it's fed is already settled — so
 * this needs no clamp, and the clamp was what latched the wrong answer in
 * place for the rest of the walk.
 */
export function stepIndexFromProgress(
  route: { totalMinutes: number; steps: { arrivalMinutes: number }[] },
  totalMeters: number,
  remainingMeters: number,
): number {
  const last = route.steps.length - 1;
  if (last <= 0) return 0;
  if (totalMeters <= 0) return last;
  const walkedFraction = Math.min(1, Math.max(0, 1 - remainingMeters / totalMeters));
  // Distance is what's measured; minutes are how the route describes itself.
  // Pace is constant across the trip, so the two are interchangeable here.
  const walkedMinutes = route.totalMinutes * walkedFraction;
  let index = 0;
  for (let i = 1; i <= last; i++) {
    if (route.steps[i].arrivalMinutes <= walkedMinutes + 1e-9) index = i;
    else break;
  }
  return index;
}

/**
 * Which row of the step list to mark, given where the walker is.
 *
 * The banner instructs toward the *next* building while the step index
 * tracks the *current* one, so highlighting the current row put "Head into
 * Forum" above a list pointing at Deluxe Plaza — two correct statements
 * that read as a bug side by side. The list follows the banner instead.
 *
 * Clamped at the end: once there is no next building the destination stays
 * marked, rather than the highlight running off the list at arrival.
 */
export function highlightedStep(stepIndex: number, stepCount: number): number {
  if (stepCount < 2) return 0;
  return Math.min(stepIndex + 1, stepCount - 1);
}

/**
 * Whether a trip is over: there is no further building to head into.
 *
 * Shared with the sheet so the banner and the auto-dismiss timer agree by
 * construction. The alternative — the timer matching on the words "You've
 * arrived" — makes a copy edit silently stop navigation from ever ending
 * itself.
 *
 * A single-step route is a destination you are already standing in, which
 * the app answers before navigation starts; it never becomes an arrival.
 */
export function hasArrived(stepIndex: number, stepCount: number): boolean {
  if (stepCount < 2) return false;
  return stepIndex >= stepCount - 1;
}

/** How close the destination has to be before an "arrived" step index is
 * believed enough to close the map. routeStepIndex picks the nearest
 * building centroid, so a large destination reads as arrived from its far
 * edge — in the recorded walk the banner flipped over while the walk
 * carried on. Showing the banner early is harmless; ending navigation
 * early is not. */
const ARRIVAL_METERS = 30;

/**
 * Whether an arrival is solid enough to end the trip without being asked.
 *
 * @param arrived   what hasArrived says about the step index
 * @param remaining metres still to walk, or null when there's no live fix
 */
export function canDismissArrival(arrived: boolean, remaining: number | null): boolean {
  if (!arrived) return false;
  // No fix to second-guess the step index with — trust it rather than
  // leave a finished trip on screen indefinitely, which is the bug this
  // whole path exists to fix.
  return remaining === null || remaining <= ARRIVAL_METERS;
}

/** How long "You've arrived" stays up before navigation ends itself. Long
 * enough to read and to look up at the building; short enough that the
 * screen isn't still claiming a finished trip on the walk back. In the
 * recorded walk the banner sat for ~50s until it was dismissed by hand. */
export const ARRIVAL_LINGER_MS = 10_000;
