/** Finger-friendly hit testing for map taps.
 *
 * MapLibre's queryRenderedFeatures tests a single pixel, so a POI icon is
 * only tappable on its own rendered dot — miss by a couple of pixels and
 * the tap falls through to the building polygon underneath, which is
 * enormous by comparison. In practice that means someone aiming at a
 * restaurant keeps opening the building.
 *
 * The fix is to query a box around the touch point instead, then decide
 * which of the candidates the user actually meant. That decision is here,
 * separate from the map, because it's arithmetic.
 */

/** Half-width of the tap box in CSS pixels — a ~28px square, close to the
 * 44pt minimum touch target once device pixel ratio is accounted for.
 * Wider than this and taps meant for the building start opening whichever
 * business happens to be nearby. */
export const TAP_SLOP_PX = 14;

export interface TapCandidate {
  id: string;
  /** Screen position of the candidate, in the same space as the tap. */
  x: number;
  y: number;
}

/** The candidate nearest the finger, or null when there are none.
 *
 * Nearest rather than first: the renderer's order is not intent, and with
 * two businesses a few pixels apart, taking whatever came back first means
 * tapping one icon and opening its neighbour.
 */
export function nearestCandidate<T extends TapCandidate>(
  candidates: readonly T[],
  point: { x: number; y: number },
): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const dx = candidate.x - point.x;
    const dy = candidate.y - point.y;
    // Squared distance: the comparison is identical and it avoids a sqrt
    // per candidate on every tap.
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}
