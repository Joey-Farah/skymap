/**
 * Whether this install is too old to keep using, decided from a file we
 * host rather than from anything baked into the app.
 *
 * The obvious version of this — "the app refuses to run unless it is the
 * latest" — has to be compiled in, which means it can only be relaxed by
 * shipping another release and waiting on review, and it locks people out
 * for a typo fix as readily as for a broken build. So the floor lives in
 * a small JSON file instead: raising it is an edit, lowering it is an
 * edit, and the app itself never has an opinion about which version is
 * current.
 *
 * Everything here is pure. The fetch, the caching and the screen live with
 * the caller, so the decision can be tested without a network or a DOM.
 */

/** What the hosted file may say. Every field is optional on purpose: an
 * empty object is a valid manifest that gates nothing. */
export interface UpdateManifest {
  /** Below this, the app stops. For versions that are actually broken. */
  minVersion?: string;
  /** Newer than this install, and worth mentioning once. */
  latestVersion?: string;
  /** Shown on the blocking screen, so the reason can change without a release. */
  message?: string;
}

export type UpdateGate =
  | { kind: "none" }
  | { kind: "suggest"; version: string; message?: string }
  | { kind: "block"; version: string; message?: string };

const NONE: UpdateGate = { kind: "none" };

/** A version string we can actually reason about: 1.11, 1.2.3, 2.0. */
function parse(version: unknown): number[] | null {
  if (typeof version !== "string") return null;
  const parts = version.trim().split(".");
  if (parts.length === 0 || parts.some((p) => p === "" || !/^\d+$/.test(p))) return null;
  return parts.map(Number);
}

/**
 * Negative, zero or positive, the way a comparator is expected to read.
 *
 * Not a string compare, and this is the whole reason the function exists:
 * lexically "1.9" sorts above "1.10", and 1.9 is precisely the sort of
 * floor this gate would be pointed at.
 */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parse(a) ?? [], parse(b) ?? []];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * What to do about this install, given what we last heard from the server.
 *
 * `null` — no manifest, because the fetch failed or has not happened yet —
 * is a full pass. SkyMap's promise is that it works in a skyway with no
 * signal; a gate that failed closed would break the app in exactly the
 * place it exists for. A malformed manifest is treated the same way: a
 * typo in a hand-edited file must not brick every install on the street.
 */
export function updateGate(current: string, manifest: UpdateManifest | null): UpdateGate {
  if (!manifest || !parse(current)) return NONE;

  const floor = parse(manifest.minVersion) ? manifest.minVersion! : null;
  if (floor && compareVersions(current, floor) < 0) {
    return { kind: "block", version: floor, message: manifest.message };
  }

  const latest = parse(manifest.latestVersion) ? manifest.latestVersion! : null;
  if (latest && compareVersions(current, latest) < 0) {
    return { kind: "suggest", version: latest, message: manifest.message };
  }

  return NONE;
}

/**
 * The gate, given both of what we might know: the manifest just fetched,
 * and the last one we stored.
 *
 * A stale manifest may raise the banner and may never raise the wall. The
 * wall stops the app dead, and the app's promise is that it works in a
 * skyway with no signal — shutting someone out down there on the strength
 * of a file read last week would break it exactly where it exists to work.
 * A block we can't confirm right now is no block at all.
 */
export function gateFromSources(
  current: string,
  fresh: UpdateManifest | null,
  cached: UpdateManifest | null,
): UpdateGate {
  if (fresh) return updateGate(current, fresh);
  const gate = updateGate(current, cached);
  return gate.kind === "block" ? NONE : gate;
}
