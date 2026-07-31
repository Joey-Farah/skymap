import test from "node:test";
import assert from "node:assert/strict";
import { feedbackProblem, buildFeedbackPayload, sendFeedback } from "../src/feedback.ts";

test("an empty message is the one thing worth refusing", () => {
  assert.equal(feedbackProblem({ message: "" }), "Tell us what's up first.");
  assert.equal(feedbackProblem({ message: "   \n  " }), "Tell us what's up first.");
});

test("a message on its own is enough — the email is optional", () => {
  // Requiring an address would cost reports from people who just want to
  // flag something and move on, which is most of them.
  assert.equal(feedbackProblem({ message: "The Hyatt is missing" }), null);
});

test("an address is only checked when one was actually typed", () => {
  assert.equal(feedbackProblem({ message: "hi", email: "" }), null);
  assert.equal(feedbackProblem({ message: "hi", email: "jeb@example.com" }), null);
  // Worth catching: a typo'd address means the reply silently never arrives,
  // and the sender has no way to know that happened.
  assert.equal(
    feedbackProblem({ message: "hi", email: "jeb@" }),
    "That email address looks incomplete.",
  );
});

test("the payload carries the build so a report is answerable", () => {
  const payload = buildFeedbackPayload({ message: "  broken  ", email: " JEB@example.com " }, "9ca38c2");
  assert.equal(payload.message, "broken", "trimmed");
  assert.equal(payload.email, "JEB@example.com", "trimmed but not lowercased — it's theirs");
  assert.equal(payload.build, "9ca38c2");
});

test("a place report keeps the reference to the place it's about", () => {
  const payload = buildFeedbackPayload({ message: "closed", ref: "poi-123" }, "dev");
  assert.equal(payload.ref, "poi-123");
  assert.equal(payload.email, undefined, "no address given, no empty string sent");
});

test("sendFeedback reports failure instead of throwing", async () => {
  // The caller falls back to mailto on a false, so a thrown error here
  // would lose the message entirely — the exact failure being fixed.
  const offline = async () => {
    throw new Error("network down");
  };
  assert.equal(await sendFeedback("/api/feedback", { message: "x" }, offline), false);

  const rejecting = async () => ({ ok: false, status: 500 });
  assert.equal(await sendFeedback("/api/feedback", { message: "x" }, rejecting), false);

  const accepting = async () => ({ ok: true, status: 202 });
  assert.equal(await sendFeedback("/api/feedback", { message: "x" }, accepting), true);
});

test("sendFeedback posts JSON to the endpoint it was given", async () => {
  let seen;
  await sendFeedback("https://example.com/api/feedback", { message: "hi" }, async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 202 };
  });
  assert.equal(seen.url, "https://example.com/api/feedback");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(seen.init.body), { message: "hi" });
});
