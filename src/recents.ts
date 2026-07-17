import type { KeyValueStore } from "./ramp.ts";

const KEY = "skymap.recents";
const MAX_RECENTS = 5;

export interface RecentEntry {
  id: string;
  name: string;
}

export function recordRecent(store: KeyValueStore, building: RecentEntry): void {
  const existing = getRecents(store).filter((r) => r.id !== building.id);
  const next = [{ id: building.id, name: building.name }, ...existing].slice(0, MAX_RECENTS);
  store.setItem(KEY, JSON.stringify(next));
}

export function getRecents(store: KeyValueStore): RecentEntry[] {
  const raw = store.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r) => r && typeof r.id === "string" && typeof r.name === "string");
  } catch {
    return [];
  }
}
