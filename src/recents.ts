import type { KeyValueStore } from "./ramp.ts";

const KEY = "skymap.recents";
const MAX_RECENTS = 5;

export interface RecentEntry {
  id: string;
  name: string;
  /** Set when the deliberate choice was a specific business inside the
   * building, not the building itself — lets the recents row show and
   * reselect that exact place instead of collapsing back to its host. */
  poiId?: string;
}

export function recordRecent(store: KeyValueStore, entry: RecentEntry): void {
  const existing = getRecents(store).filter((r) => r.id !== entry.id || r.poiId !== entry.poiId);
  const next = [entry, ...existing].slice(0, MAX_RECENTS);
  store.setItem(KEY, JSON.stringify(next));
}

export function getRecents(store: KeyValueStore): RecentEntry[] {
  const raw = store.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r) =>
        r &&
        typeof r.id === "string" &&
        typeof r.name === "string" &&
        (r.poiId === undefined || typeof r.poiId === "string"),
    );
  } catch {
    return [];
  }
}
