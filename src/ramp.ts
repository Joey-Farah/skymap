import type { Building } from "./types.ts";
import { nearestApproach } from "./router.ts";

/** Minimal storage shape so this is testable without a real DOM/localStorage. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = "skymap.savedRamp";

export interface SavedRamp {
  id: string;
  name: string;
  savedAt: string;
}

export function saveRamp(store: KeyValueStore, building: { id: string; name: string }): SavedRamp {
  const ramp: SavedRamp = { id: building.id, name: building.name, savedAt: new Date().toISOString() };
  store.setItem(KEY, JSON.stringify(ramp));
  return ramp;
}

export function getSavedRamp(store: KeyValueStore): SavedRamp | null {
  const raw = store.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === "string" && typeof parsed.name === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

export function clearSavedRamp(store: KeyValueStore): void {
  store.removeItem(KEY);
}

/**
 * Close enough to a ramp to have parked in it.
 *
 * "Am I parked in this ramp?" and "where would I join the skyway?" are two
 * different questions with two different budgets — a fix 200m from a ramp
 * is a perfectly good place to start a trip and a terrible reason to offer
 * to remember where you parked. This is the tight one.
 *
 * Measured to the footprint where there is one, so the far end of a traced
 * full-block ramp still counts. A curated ramp has no footprint and is
 * measured from its street address instead (see data/parking-overlay.json),
 * so at an 880-space ramp the far corner can fall outside this — the honest
 * cost of knowing where a building is without knowing its shape.
 */
export const AT_RAMP_METERS = 60;

/**
 * The ramp you are standing in, or null.
 *
 * Asked of every parking building rather than of the routable ones. Both
 * questions used to be answered from mainNetworkBuildings(), which exists
 * to stop the app offering a trip that ends in "No route found" — a good
 * rule for choosing where to start walking and the wrong one entirely for
 * noticing where a car is. Four of downtown's ramps sit off that
 * component, so Save My Ramp was quietly unavailable at exactly the ramps
 * whose walk to the skyway is longest and least memorable.
 */
export function parkedAt(lat: number, lon: number, buildings: Building[], maxMeters = AT_RAMP_METERS): Building | null {
  const ramps = buildings.filter((b) => b.category === "parking");
  return nearestApproach(lat, lon, ramps, maxMeters)?.building ?? null;
}
