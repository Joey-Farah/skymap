/** Where the bottom sheet lands when you let go.
 *
 * Position alone isn't enough. Deciding purely on "is it past the midpoint"
 * means a quick flick up from the peek height — the natural gesture for
 * "show me the rest of the steps" — travels a fraction of the way and then
 * falls back down, because the finger left before the sheet got halfway.
 * That reads as the sheet fighting you.
 *
 * So: a deliberate flick commits in its own direction regardless of how far
 * it got, and anything slower falls back to nearest-end. Pure so the rule
 * can be tested without a pointer.
 */

/** px/ms. Below this a movement is a drag being placed, not a flick — set
 * from what a casual flick actually produces (~0.5–1.5 px/ms) versus the
 * drift at the end of a slow, aimed drag (well under 0.1). */
const FLICK_VELOCITY = 0.35;

export function shouldExpand(opts: {
  /** Sheet height at the moment of release. */
  height: number;
  /** px/ms, positive when the sheet is growing (finger moving up). */
  velocity: number;
  peekHeight: number;
  expandedHeight: number;
}): boolean {
  if (Math.abs(opts.velocity) >= FLICK_VELOCITY) return opts.velocity > 0;
  return opts.height > (opts.peekHeight + opts.expandedHeight) / 2;
}
