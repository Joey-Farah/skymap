import test from "node:test";
import assert from "node:assert/strict";

// Just enough page for the form: elements that hold values and fire clicks.
// Not a browser test on purpose — a failed send there opens the real Mail app.
const elements = new Map();
const element = () => ({
  hidden: true,
  disabled: false,
  textContent: "",
  value: "",
  listeners: {},
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  },
  focus() {},
  click() {
    for (const fn of this.listeners.click ?? []) fn();
  },
});
const byId = (id) => elements.get(id) ?? elements.set(id, element()).get(id);
globalThis.document = { getElementById: byId, addEventListener() {}, activeElement: null };
globalThis.window = { location: { href: "" } };

const { FeedbackForm } = await import("../src/feedback-form.ts");

test("cancelling a send that hangs doesn't open Mail when it gives up", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  // One bar of signal: the post neither answers nor fails until it's abandoned.
  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const toasts = [];
  const form = new FeedbackForm((text) => toasts.push(text));
  form.open();
  byId("feedback-message").value = "The Hyatt is missing";
  byId("feedback-email").value = "jeb@example.com";
  byId("feedback-send").click();
  byId("feedback-cancel").click(); // gave up waiting, and closed it
  t.mock.timers.tick(15_000);
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  assert.equal(window.location.href, "", "Mail opened 15 s after the form was closed");
  assert.deepEqual(toasts, []);
});
