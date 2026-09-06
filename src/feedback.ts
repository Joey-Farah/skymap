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
export function feedbackProblem(draft: FeedbackDraft): string | null {
  if (!draft.message.trim()) return "Tell us what's up first.";
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

/**
 * Post a report. Returns false rather than throwing on any failure —
 * network, server, anything. The caller's fallback is the old `mailto:`,
 * so an exception escaping here would lose the message outright, which is
 * the exact bug this whole path exists to fix.
 */
export async function sendFeedback(
  endpoint: string,
  payload: FeedbackPayload,
  fetchImpl: FetchLike,
): Promise<boolean> {
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}
