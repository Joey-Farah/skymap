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
