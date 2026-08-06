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

export type LocateMode = "off" | "lock" | "background" | "heading";
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
      if (mode === "lock") return t("heading", true, true);
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
      return t("lock"); // off or background: let MapLibre start/re-center
    case "focus":
      return t("lock", false, mode === "heading", false);
    case "blur":
      return t("background");
    case "end":
      return t("off", false, false, mode === "heading");
  }
}
