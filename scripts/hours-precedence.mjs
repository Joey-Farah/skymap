/**
 * Who wins when two sources disagree about a building's hours.
 *
 * This used to live inline in apply-hours-overlay.mjs, where it could not
 * be tested and where the policy was invisible — you had to read the
 * applier's control flow to learn what the app believes.
 *
 * **The operator wins.** A landlord publishing its own building's access
 * policy in its own tenant handbook is the primary source for its own front
 * door; OSM is a third-party map edit that may predate the current policy by
 * years. This was the reverse until 2026-08-08, on the reasoning that OSM is
 * maintained by people who can see the door — a fair argument, but the
 * evidence went the other way. Of the eight buildings with operator-sourced
 * hours, seven were STRICTER than the alternative (International Market
 * Square 42.5h/week rather than 94, the Guthrie closed Mondays, 111
 * Washington Square weekdays-only). The one looser case is a hospital that
 * really is 24/7.
 *
 * The asymmetry decides it: overstating hours sends someone to a locked
 * door, understating them costs a detour.
 *
 * The cost of the flip is that curated entries age while OSM keeps being
 * edited, so `stalenessWarnings` exists to stop the set rotting quietly into
 * being wrong in the confident direction.
 */
import { parseOpeningHours } from "../src/opening-hours.ts";

/** How long a curated entry is trusted before it wants re-checking. A year
 * is chosen to match how these were gathered — one sweep, one date — rather
 * than any claim about how often tenants change their hours. */
export const STALE_AFTER_DAYS = 365;

/**
 * The policy itself, independent of which shape is being decided. Both
 * callers below need the same three guards in the same order; only what
 * they write back differs.
 */
function decide(current, entry) {
  // Idempotence first: a re-run over already-patched data must be quiet,
  // otherwise every entry reports as a conflict with itself.
  if (current.hoursSource && current.hoursSource === entry.source) {
    return { action: "skip" };
  }
  // Beating OSM by default is only defensible for an entry that says where
  // it came from. Without this the flip would let an unsourced guess — the
  // exact thing the whole curation pass refused to ship — outrank a real
  // map edit.
  if (!entry.source) {
    return { action: "problem", reason: "no source: an entry may only outrank OSM if it says where it came from" };
  }
  const hours = parseOpeningHours(entry.openingHours);
  // Refuse syntax the app can't read: a value that fails to parse renders
  // as nothing, which on screen is indistinguishable from having no hours.
  if (!hours) {
    return { action: "problem", reason: `unparseable opening_hours ${JSON.stringify(entry.openingHours)}` };
  }
  return { action: "apply", hours };
}

/**
 * What to do with one overlay entry for one building.
 *
 * Returns `{ action: "apply", hours }`, `{ action: "skip" }` when the entry
 * is already in the data, or `{ action: "problem", reason }`.
 */
export function decideBuilding(building, entry) {
  return decide(building, entry);
}

/**
 * What to do with one overlay entry for one POI.
 *
 * Same policy as buildings — the operator wins — but a POI stores the raw
 * `opening_hours` string the app parses at render time, so `apply` carries
 * the string rather than the parsed week.
 *
 * The extra outcome is `retire`: when OSM has independently arrived at the
 * same value, the overlay entry is redundant rather than in conflict, and
 * carrying it forward means re-verifying a claim OSM already makes. That is
 * housekeeping, not a disagreement, so it is reported separately.
 */
export function decidePoi(poi, entry) {
  const decision = decide(poi, entry);
  if (decision.action !== "apply") return decision;
  if (poi.openingHours === entry.openingHours) return { action: "retire" };
  return { action: "apply", openingHours: entry.openingHours };
}

/** Curated entries that are old enough to want re-checking. An entry with no
 * `checkedOn` counts as stale — an undated claim can't be shown to be
 * current, and this policy trusts these over OSM. */
export function stalenessWarnings(entries, now = new Date()) {
  const warnings = [];
  for (const [id, entry] of Object.entries(entries)) {
    if (!entry.checkedOn) {
      warnings.push(`${id} (${entry.name}): no checkedOn date — cannot tell whether it is still true`);
      continue;
    }
    const age = Math.floor((now - new Date(entry.checkedOn)) / 86400000);
    if (age > STALE_AFTER_DAYS) {
      warnings.push(`${id} (${entry.name}): checked ${age} days ago (${entry.checkedOn}) — re-verify against ${entry.source}`);
    }
  }
  return warnings;
}
