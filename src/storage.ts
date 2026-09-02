/** Minimal storage shape so callers are testable without a real DOM/localStorage. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Keys written by features that no longer exist.
 *
 * A native app update replaces the bundle and leaves the WebView's
 * localStorage exactly as it was, so state outlives the code that wrote it
 * — and with the UI gone there is nothing left to clear it with. Save My
 * Ramp proved the cost: a saved ramp redrew its "← Back to X" button on
 * every boot, with nothing on screen that could dismiss it, so deleting
 * and reinstalling the app was the only cure anyone found.
 */
export const RETIRED_KEYS = [
  // Save My Ramp: the parked-ramp prompt and its way back, removed whole.
  "skymap.savedRamp",
  // The per-step "report crossing closed" UI is gone, but reports it filed
  // live for 4 hours and used to silently detour routing — with no UI left
  // to see or clear them, a stray old tap just looked like the router
  // picking a bizarre path. (incidents.ts is kept and tested for the day
  // closure reporting returns as a deliberate feature.)
  "skymap.incidents",
];

/** Drop every retired key. Safe to call on any store, every boot. */
export function clearRetiredKeys(store: KeyValueStore): void {
  for (const key of RETIRED_KEYS) store.removeItem(key);
}
