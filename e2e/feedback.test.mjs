import test from "node:test";
import assert from "node:assert/strict";

import { launch, openApp } from "./harness.mjs";

// The harness answers the feedback POST at once. These tests only ever slow
// it down or count it; never make it fail, since the form's fallback for a
// failed send is a mailto: navigation that would open real Mail.

async function openForm(page) {
  await page.click("#feedback-link");
  await page.waitForSelector("#feedback-form:not([hidden])");
}

test("a message over 4,000 characters is refused up front, not sent to Mail (QA 002)", async (t) => {
  const { browser, page, feedbackPosts } = await launch();
  t.after(() => browser.close());
  await openApp(page);
  await openForm(page);
  await page.fill("#feedback-message", "x".repeat(4001));
  await page.fill("#feedback-email", "rider@example.com");
  await page.click("#feedback-send");
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    error: document.getElementById("feedback-error").hidden ? null : document.getElementById("feedback-error").textContent,
    open: !document.getElementById("feedback-form").hidden,
    external: window.__blockedExternal,
  }));
  assert.match(r.error ?? "", /too long/i);
  assert.ok(r.open, "the text stays in the form to be shortened");
  assert.equal(feedbackPosts.length, 0);
  assert.deepEqual(r.external, []);
});

test("a slow send that was cancelled doesn't close the next draft (QA 003)", async (t) => {
  const { browser, context, page, feedbackPosts } = await launch();
  t.after(() => browser.close());
  await context.route("**/api/feedback**", async (route) => {
    feedbackPosts.push(route.request().postData());
    await new Promise((r) => setTimeout(r, 1500)); // one bar of signal
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  await openApp(page);
  await openForm(page);
  await page.fill("#feedback-message", "first report");
  await page.fill("#feedback-email", "rider@example.com");
  await page.click("#feedback-send");
  await page.click("#feedback-cancel");
  await openForm(page);
  await page.fill("#feedback-message", "a second thought");
  await page.waitForTimeout(2200); // the first send lands
  const r = await page.evaluate(() => ({
    open: !document.getElementById("feedback-form").hidden,
    text: document.getElementById("feedback-message").value,
  }));
  assert.deepEqual(r, { open: true, text: "a second thought" });
});
