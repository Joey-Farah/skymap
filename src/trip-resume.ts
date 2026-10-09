import type { KeyValueStore } from "./storage.ts";

/**
 * The trip under way, kept so a reload doesn't lose it.
 *
 * iOS ends the web view's process when it wants the memory back — routinely
 * while the app sits in the background — and Capacitor reloads the page.
 * Everything in memory goes: halfway to Caribou Coffee, you came back to the
 * map, or worse, to the link the preview had written, which re-opened the
 * whole trip from the building you'd left with the coffee shop renamed to
 * its building (QA 051).
 *
 * Only the destination is kept. A resumed trip starts from where you are
 * now, which is the one start that is right after a walk of unknown length.
 */
const KEY = "skymap.trip";

/** Past this since the last sign of the trip — GO, or a fix along it — it
 * is over, and a reload opens a clean map. */
export const RESUME_WITHIN_MS = 30 * 60_000;

export interface TripToResume {
  toId: string;
  /** The business the trip was to, when it was one rather than its building. */
  poiId?: string;
}

/** At GO, and again as the trip goes on: each call restarts the half hour. */
export function rememberTrip(store: KeyValueStore, trip: TripToResume, now = Date.now()): void {
  try {
    store.setItem(KEY, JSON.stringify({ ...trip, savedAt: now }));
  } catch {
    // Private mode or a full quota: the trip simply won't survive a reload.
  }
}

export function forgetTrip(store: KeyValueStore): void {
  try {
    store.removeItem(KEY);
  } catch {
    // As above.
  }
}

/** The trip to pick back up at launch, or null — forgetting one too old. */
export function tripToResume(store: KeyValueStore, now = Date.now()): TripToResume | null {
  let saved: unknown;
  try {
    saved = JSON.parse(store.getItem(KEY) ?? "null");
  } catch {
    saved = null;
  }
  const s = saved as { toId?: unknown; poiId?: unknown; savedAt?: unknown } | null;
  const valid =
    !!s &&
    typeof s.toId === "string" &&
    typeof s.savedAt === "number" &&
    (s.poiId === undefined || typeof s.poiId === "string");
  if (!valid || now - (s.savedAt as number) > RESUME_WITHIN_MS) {
    forgetTrip(store);
    return null;
  }
  return { toId: s.toId as string, ...(s.poiId ? { poiId: s.poiId as string } : {}) };
}
