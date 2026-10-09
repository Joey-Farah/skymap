/**
 * State machine for the Apple-Maps-style locate button: first tap centers
 * and tracks, second tap rotates the map to your device heading, third tap
 * turns tracking off. Panning away ("blur") drops heading mode but keeps
 * whatever rotation is on screen — snapping north mid-pan is jarring; the
 * nav control's compass offers the explicit reset.
 *
 * Pure logic so the cycle is unit-testable; MapLibre event wiring lives in
 * main.ts. `intercept` tells the caller to stop the tap before MapLibre's
 * own handler (which would otherwise toggle tracking off on second tap).
 */

/** Where in the cycle the button is. "waiting" (searching for a first fix)
 * and "error" (lost the fix, routine indoors) come only from tapPosition. */
export type LocateMode = "off" | "lock" | "background" | "heading" | "waiting" | "error";
export type LocateEvent = "tap" | "focus" | "blur" | "end";

export interface LocateTransition {
  mode: LocateMode;
  intercept: boolean;
  heading: boolean;
  resetBearing: boolean;
}

export interface LocateContext {
  /** True while a trip is under way. Shortens the tap cycle — see below. */
  navigating?: boolean;
  /** Motion access was refused, so there is no heading-up step. */
  compassUnavailable?: boolean;
}

/** MapLibre GeolocateControl's `_watchState`: the truth about whether
 * tracking is on. */
export type WatchState = "OFF" | "WAITING_ACTIVE" | "ACTIVE_LOCK" | "ACTIVE_ERROR" | "BACKGROUND" | "BACKGROUND_ERROR";

/**
 * Where in the cycle a tap lands, read from the control itself.
 *
 * main.ts used to keep its own copy of this, updated from the control's
 * focus and end events. MapLibre fires no "focus" when the first fix locks
 * the map on (WAITING_ACTIVE -> ACTIVE_LOCK), so after the launch-time
 * trigger the copy said "off" over a locked map, and the next tap — read as
 * "off -> lock" and passed through to MapLibre — turned tracking off
 * (QA 037). Heading-up is ours alone, so it's the one thing the caller adds.
 */
export function tapPosition(watch: WatchState | string | undefined, headingOn: boolean): LocateMode {
  switch (watch) {
    case "ACTIVE_LOCK":
      return headingOn ? "heading" : "lock";
    case "BACKGROUND":
      return "background";
    case "WAITING_ACTIVE":
      return "waiting";
    case "ACTIVE_ERROR":
    case "BACKGROUND_ERROR":
      return "error";
    default:
      return "off";
  }
}

export function locateTransition(
  mode: LocateMode,
  event: LocateEvent,
  ctx: LocateContext = {},
): LocateTransition {
  const t = (mode: LocateMode, intercept = false, heading = false, resetBearing = false) => ({
    mode,
    intercept,
    heading,
    resetBearing,
  });
  switch (event) {
    case "tap":
      if (mode === "lock") {
        if (!ctx.compassUnavailable) return t("heading", true, true);
        // No compass, so the cycle is plain on/off — except mid-trip, where
        // "off" is never one tap away (see "heading" below).
        return ctx.navigating ? t("lock", true) : t("off");
      }
      if (mode === "heading") {
        // Mid-trip the cycle is lock <-> heading, never off. The control is
        // on screen during navigation so the map can be turned heading-up
        // in a corridor, which also puts "tracking off" one tap from the
        // thing people will actually tap. Turning tracking off mid-trip
        // stops every position callback: the banner goes on naming a
        // building, the arrival clock freezes, the walker and the walked
        // line disappear, and nothing says the trip stopped being live.
        // Ending a trip is what End is for. Intercepted, so MapLibre's own
        // handler doesn't stop tracking underneath us.
        if (ctx.navigating) return t("lock", true, false, true);
        return t("off", false, false, true);
      }
      if (mode === "waiting" || mode === "error") {
        // MapLibre's own tap turns tracking off from here, which is the
        // opposite of what the tap means: it's "find me". Mid-trip, the dot
        // stopped moving deep indoors, the walker tapped to get found, and
        // location went off for the rest of the trip with the banner frozen
        // on one building (QA 038). On any screen, someone who has just
        // allowed location in Settings taps it while the first fix is still
        // coming, and cancelled the search they'd just restarted (QA 027).
        // Intercepted, so tracking carries on; "off" stays reachable from a
        // locked map.
        return t("lock", true);
      }
      return t("lock"); // off or background: let MapLibre start/re-center
    case "focus":
      return t("lock", false, mode === "heading", false);
    case "blur":
      return t("background");
    case "end":
      return t("off", false, false, mode === "heading");
  }
}
