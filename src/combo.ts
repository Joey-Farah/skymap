import type { Building, Poi } from "./types.ts";

/** One searchable result in the from/to picker: a building or a business inside one. */
export interface ComboEntry {
  label: string;
  sublabel: string;
  buildingId: string;
  poiId?: string;
}

/** Buildings plus their interior businesses, as one searchable, sorted list. */
export function buildComboEntries(
  buildings: Pick<Building, "id" | "name" | "address">[],
  pois: Pick<Poi, "id" | "name" | "buildingId" | "exterior">[],
): ComboEntry[] {
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const entries: ComboEntry[] = buildings.map((b) => ({
    label: b.name,
    sublabel: b.address,
    buildingId: b.id,
  }));
  for (const p of pois) {
    if (p.exterior) continue; // bus stops etc. aren't routable destinations
    const host = byId.get(p.buildingId);
    if (!host) continue;
    entries.push({ label: p.name, sublabel: host.name, buildingId: p.buildingId, poiId: p.id });
  }
  return entries.sort((a, b) => a.label.localeCompare(b.label));
}

export function searchEntries(entries: ComboEntry[], query: string): ComboEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) => e.label.toLowerCase().includes(q) || e.sublabel.toLowerCase().includes(q),
  );
}
