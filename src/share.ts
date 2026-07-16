/** Route state <-> URL query string, so a route can be sent as a link. */

export interface RouteState {
  fromId: string | null;
  toId: string | null;
  /** Departure time, or null for "leave now". */
  when: Date | null;
}

/** Local-time ISO without seconds (matches datetime-local), kept off UTC on purpose: skyway hours are local. */
export function toLocalIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function encodeRouteState(state: { fromId: string; toId: string; when: Date | null }): string {
  const params = new URLSearchParams({ from: state.fromId, to: state.toId });
  if (state.when) params.set("at", toLocalIso(state.when));
  return `?${params.toString()}`;
}

/**
 * Deep link to the business's card on Google Maps (ratings, photos, hours
 * live there — Google's ToS doesn't allow rendering Places data on our map).
 */
export function googleMapsUrl(poi: { name: string; lat: number; lon: number }): string {
  const params = new URLSearchParams({ api: "1", query: `${poi.name} Minneapolis` });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

/**
 * Data in this app comes entirely from OpenStreetMap, which can go stale —
 * a known weakness of every skyway map built this way. This is the cheap
 * fix: a one-tap way to flag it so the underlying data can be corrected.
 */
export function reportIssueUrl(target: { name: string; id: string }): string {
  // mailto: doesn't reliably decode "+" as a space the way form encoding
  // does, so encode manually rather than reach for URLSearchParams.
  const subject = encodeURIComponent(`Skymap issue: ${target.name}`);
  const body = encodeURIComponent(
    `What's wrong? (closed, wrong hours, wrong location, doesn't exist, other)\n\n\n—\nRef: ${target.id}`,
  );
  return `mailto:hello@skymap.app?subject=${subject}&body=${body}`;
}

/** General product feedback/ideas — distinct from reportIssueUrl, which is
 * always tied to a specific building or business's data. */
export function feedbackUrl(): string {
  const subject = encodeURIComponent("Skymap feedback");
  const body = encodeURIComponent("What's working, what's not, what would make this better?\n\n\n");
  return `mailto:hello@skymap.app?subject=${subject}&body=${body}`;
}

export function parseRouteState(search: string): RouteState {
  const params = new URLSearchParams(search);
  const at = params.get("at");
  const when = at ? new Date(at) : null;
  return {
    fromId: params.get("from"),
    toId: params.get("to"),
    when: when && !isNaN(when.getTime()) ? when : null,
  };
}
