/**
 * In-app feedback, replacing a `mailto:` that dead-ended for anyone without
 * Mail configured — the first person to send feedback had to have a working
 * mail client, which is a strange thing to require of someone doing you a
 * favour. Everything here is transport-agnostic so it can be tested without
 * a network: the caller supplies the fetch.
 */

export interface FeedbackDraft {
  message: string;
  email?: string;
  /** Building or POI id, when the report is about a specific place. */
  ref?: string;
}

export interface FeedbackPayload {
  message: string;
  email?: string;
  ref?: string;
  build?: string;
}

/** The single reason to reject a draft, or null if it's fine to send.
 *
 * The address used to be optional, on the reasoning that every required
 * field is a report that doesn't get sent. What actually arrived was
 * anonymous key-mashing — submitted by accident, unanswerable, and
 * indistinguishable from a real report nobody could follow up on. So the
 * address is required now: it is the reply path, and a pocket-submitted
 * form does not produce one.
 *
 * Message first when both are missing. Two complaints at once reads as a
 * form scolding you rather than telling you what to do next.
 */
/** The longest message the endpoint accepts (api/feedback.js MAX_MESSAGE;
 * a test keeps the two equal). Counted the way both sides count it, in
 * JavaScript string length. */
export const FEEDBACK_MAX_CHARS = 4000;
export const FEEDBACK_TOO_LONG = `That's too long to send — please keep it under ${FEEDBACK_MAX_CHARS.toLocaleString("en-US")} characters.`;

export function feedbackProblem(draft: FeedbackDraft): string | null {
  if (!draft.message.trim()) return "Tell us what's up first.";
  // Caught here, before sending: the server refuses it, and that refusal
  // read as "couldn't send that just now" and a trip to Mail, every retry
  // (QA 002).
  if (draft.message.trim().length > FEEDBACK_MAX_CHARS) return FEEDBACK_TOO_LONG;
  const email = draft.email?.trim();
  if (!email) return "Add your email so we can write back.";
  // Only a shape check — anything stricter starts rejecting valid addresses,
  // and the cost of a false reject (a lost report) beats the cost of a false
  // accept (one bounced reply).
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "That email address looks incomplete.";
  return null;
}

export function buildFeedbackPayload(draft: FeedbackDraft, build: string): FeedbackPayload {
  const email = draft.email?.trim();
  return {
    message: draft.message.trim(),
    ...(email ? { email } : {}),
    ...(draft.ref ? { ref: draft.ref } : {}),
    build,
  };
}

type FetchLike = (url: string, init: Record<string, unknown>) => Promise<{ ok: boolean; status: number }>;

/** How long a send may take before it counts as failed. */
export const FEEDBACK_TIMEOUT_MS = 15_000;

/**
 * Post a report. Never throws: "failed" on any failure — network, server,
 * a request that never finishes — because the caller's fallback is the old
 * `mailto:`, and an exception escaping here would lose the message outright,
 * which is the exact bug this whole path exists to fix.
 *
 * "too-long" is the one refusal Mail can't help with: the same text would
 * be refused again.
 *
 * A request that hangs (one bar of signal) gives up after `timeoutMs`;
 * without it the form sat on "Sending…" for good (QA 047).
 */
export async function sendFeedback(
  endpoint: string,
  payload: FeedbackPayload,
  fetchImpl: FetchLike,
  timeoutMs = FEEDBACK_TIMEOUT_MS,
): Promise<"sent" | "too-long" | "failed"> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: abort.signal,
    });
    if (res.ok) return "sent";
    return res.status === 413 ? "too-long" : "failed";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}
