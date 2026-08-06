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
 * rather than drift. Comfortably above the ~45 m error seen indoors on the
 * skyway, and well under a downtown block (~100 m), so leaving the route
 * still registers before you reach the next one. */
export const DETOUR_METERS = 40;

/**
 * @param settled the last value shown to the walker, or null to start a trip
 * @param raw     metres remaining as just measured
 */
export function settleRemaining(settled: number | null, raw: number): number {
  if (settled === null) return raw;
  if (raw <= settled) return raw;
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
