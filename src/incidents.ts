import type { KeyValueStore } from "./ramp.ts";

/**
 * Client-only translation of the mandated spec's "server pushes an
 * incident, the local graph recalculates instantly" requirement. There's
 * no backend to push to here (that's a real infra decision, not made
 * unilaterally — see the design doc), so this is scoped honestly: a report
 * only affects the reporting device, for a few hours, then expires. Still
 * delivers the actual behavior that matters — the router excludes a
 * reported-closed crossing immediately, same as the spec's edge-weight
 * flip to infinity.
 */

const KEY = "skymap.incidents";
const EXPIRY_MS = 4 * 60 * 60 * 1000; // 4 hours — a locked-door report shouldn't outlive the day

export interface Incident {
  /** Edge key: the two building ids, sorted and joined with "|" — matches
   * the extraction script's own edge-key convention. */
  edgeKey: string;
  reportedAt: number;
}

function edgeKey(fromId: string, toId: string): string {
  return [fromId, toId].sort().join("|");
}

function readAll(store: KeyValueStore): Incident[] {
  const raw = store.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(store: KeyValueStore, incidents: Incident[]): void {
  store.setItem(KEY, JSON.stringify(incidents));
}

export function reportClosedCrossing(store: KeyValueStore, fromId: string, toId: string, now = Date.now()): void {
  const key = edgeKey(fromId, toId);
  const active = readAll(store).filter((i) => i.edgeKey !== key);
  active.push({ edgeKey: key, reportedAt: now });
  writeAll(store, active);
}

/** Currently-active (unexpired) closed-edge keys, for feeding into router.route(). */
export function activeClosedEdges(store: KeyValueStore, now = Date.now()): Set<string> {
  const fresh = readAll(store).filter((i) => now - i.reportedAt < EXPIRY_MS);
  if (fresh.length !== readAll(store).length) writeAll(store, fresh); // sweep expired on read
  return new Set(fresh.map((i) => i.edgeKey));
}

export function isCrossingReportedClosed(store: KeyValueStore, fromId: string, toId: string, now = Date.now()): boolean {
  return activeClosedEdges(store, now).has(edgeKey(fromId, toId));
}
