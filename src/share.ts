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
