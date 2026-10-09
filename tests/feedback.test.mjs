import test from "node:test";
import assert from "node:assert/strict";
import { FEEDBACK_MAX_CHARS, feedbackProblem, buildFeedbackPayload, sendFeedback } from "../src/feedback.ts";
import { readFileSync } from "node:fs";

test("an empty message is the one thing worth refusing", () => {
  assert.equal(feedbackProblem({ message: "" }), "Tell us what's up first.");
  assert.equal(feedbackProblem({ message: "   \n  " }), "Tell us what's up first.");
});

test("a message with no address is refused, because a reply is the point", () => {
  // Reversed deliberately. The form was collecting anonymous key-mashing
  // that nobody could answer or ask about; an address is both the reply
  // path and the cheapest filter against a pocket-submitted report.
  const wanted = "Add your email so we can write back.";
  assert.equal(feedbackProblem({ message: "The Hyatt is missing" }), wanted);
  assert.equal(feedbackProblem({ message: "The Hyatt is missing", email: "   " }), wanted);
});

test("the message still comes first when both are missing", () => {
  // Told what to type first, not handed two complaints at once.
  assert.equal(feedbackProblem({ message: "" }), "Tell us what's up first.");
});

test("an address that was typed still has to look like one", () => {
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
  assert.equal(await sendFeedback("/api/feedback", { message: "x" }, offline), "failed");

  const rejecting = async () => ({ ok: false, status: 500 });
  assert.equal(await sendFeedback("/api/feedback", { message: "x" }, rejecting), "failed");

  const accepting = async () => ({ ok: true, status: 202 });
  assert.equal(await sendFeedback("/api/feedback", { message: "x" }, accepting), "sent");
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

test("a message over the server's limit is refused before sending, and said plainly (QA 002)", async () => {
  // The server refuses over 4,000 characters; told "couldn't send that just
  // now" and handed to Mail, the writer retried the same thing forever.
  const long = { message: "x".repeat(FEEDBACK_MAX_CHARS + 1), email: "a@b.co" };
  assert.match(feedbackProblem(long), /too long/i);
  assert.equal(feedbackProblem({ message: "x".repeat(FEEDBACK_MAX_CHARS), email: "a@b.co" }), null);
  // The same number the server uses.
  const api = readFileSync("api/feedback.js", "utf8");
  assert.equal(Number(/MAX_MESSAGE = (\d+)/.exec(api)?.[1]), FEEDBACK_MAX_CHARS);
  // And if the server still says too long, that is not a reason to try Mail.
  const tooLong = async () => ({ ok: false, status: 413 });
  assert.equal(await sendFeedback("/api/feedback", { message: "x" }, tooLong), "too-long");
});

test("a send that hangs gives up, so the Mail fallback is offered (QA 047)", async () => {
  // One bar of signal: the request neither succeeds nor fails, and the form
  // sat on "Sending…" for good.
  const hanging = (_url, init) =>
    new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const started = Date.now();
  assert.equal(await sendFeedback("/api/feedback", { message: "x" }, hanging, 50), "failed");
  assert.ok(Date.now() - started < 2000);
});
