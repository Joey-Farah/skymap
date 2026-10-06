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

/** A real, monitored inbox on Joey's own domain (hello@skymap.app looked
 * more official, but that domain isn't ours, so mail would have bounced or
 * gone to a stranger). */
const FEEDBACK_EMAIL = "joey@joeyfarah.dev";

/** Git short hash baked in by vite.config.ts; "dev" under the test runner
 * (which imports this module without Vite's define step). Stamped into
 * report/feedback emails so "which version are you on?" is answerable —
 * web (SW-updated) and native (archive-frozen) builds can drift. */
const BUILD = typeof __BUILD_HASH__ === "undefined" ? "dev" : __BUILD_HASH__;

/** What the in-app feedback form already holds, for when sending it failed
 * and Mail has to carry it instead — Mail queues offline; the form can't. */
export interface TypedFeedback {
  message: string;
  email?: string;
}

function typedBody(typed: TypedFeedback): string {
  const email = typed.email?.trim();
  return `${typed.message.trim()}\n${email ? `\nReply to: ${email}\n` : ""}`;
}

/**
 * Data in this app comes entirely from OpenStreetMap, which can go stale —
 * a known weakness of every skyway map built this way. This is the cheap
 * fix: a one-tap way to flag it so the underlying data can be corrected.
 * `hours`, when given, turns the report into a pre-filled verification
 * question — every curious tester becomes a data checker for free.
 */
export function reportIssueUrl(target: { name: string; id: string }, hours?: string, typed?: TypedFeedback): string {
  // mailto: doesn't reliably decode "+" as a space the way form encoding
  // does, so encode manually rather than reach for URLSearchParams.
  const subject = encodeURIComponent(`SkyMap issue: ${target.name}`);
  const hoursLine = hours ? `Are these hours right? ${hours}\n` : "";
  const prompt = typed
    ? typedBody(typed)
    : `What's wrong? (closed, wrong hours, wrong location, doesn't exist, other)\n${hoursLine}\n`;
  const body = encodeURIComponent(`${prompt}\n—\nRef: ${target.id} · build ${BUILD}`);
  return `mailto:${encodeURIComponent(FEEDBACK_EMAIL)}?subject=${subject}&body=${body}`;
}

/** General product feedback/ideas — distinct from reportIssueUrl, which is
 * always tied to a specific building or business's data. */
export function feedbackUrl(typed?: TypedFeedback): string {
  const subject = encodeURIComponent("SkyMap feedback");
  const prompt = typed ? typedBody(typed) : "What's working, what's not, what would make this better?\n\n";
  const body = encodeURIComponent(`${prompt}\n—\nbuild ${BUILD}`);
  return `mailto:${encodeURIComponent(FEEDBACK_EMAIL)}?subject=${subject}&body=${body}`;
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
