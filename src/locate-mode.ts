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

export function locateTransition(mode: LocateMode, event: LocateEvent): LocateTransition {
  const t = (mode: LocateMode, intercept = false, heading = false, resetBearing = false) => ({
    mode,
    intercept,
    heading,
    resetBearing,
  });
  switch (event) {
    case "tap":
      if (mode === "lock") return t("heading", true, true);
      if (mode === "heading") return t("off", false, false, true);
      return t("lock"); // off or background: let MapLibre start/re-center
    case "focus":
      return t("lock", false, mode === "heading", false);
    case "blur":
      return t("background");
    case "end":
      return t("off", false, false, mode === "heading");
  }
}
