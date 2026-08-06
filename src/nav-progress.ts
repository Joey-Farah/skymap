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
