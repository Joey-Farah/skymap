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

/**
 * Whether a trip is over: there is no further building to head into.
 *
 * Shared so the banner and the auto-dismiss timer agree by construction.
 * The alternative — the timer matching on the words "You've arrived" —
 * makes a copy edit silently stop navigation from ever ending itself.
 *
 * A single-step route is a destination you are already standing in, which
 * the app answers before navigation starts; it never becomes an arrival.
 */
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
