import test from "node:test";
import assert from "node:assert/strict";
import { activeSupporters } from "../src/supporters.ts";

// SkyMap Supporters (docs/business-listings-plan.md): a business pays for a
// fixed term, and its pin glows from the first day of the term to the last.
// The list ships in the app, so a term has to end on the phone's own date,
// with no release. Dates are the phone's local day, the same clock the
// opening hours use.

const entry = (over = {}) => ({
  id: "poi-1", name: "Somewhere", from: "2026-11-01", until: "2027-01-31", ...over,
});

test("a term is active from its first day to its last, inclusive", () => {
  const list = [entry()];
  assert.deepEqual(activeSupporters(list, new Date(2026, 9, 31, 23, 59)), [], "the evening before");
  assert.equal(activeSupporters(list, new Date(2026, 10, 1, 0, 1)).length, 1, "just after midnight on day one");
  assert.equal(activeSupporters(list, new Date(2027, 0, 31, 23, 59)).length, 1, "late on the last day");
  assert.deepEqual(activeSupporters(list, new Date(2027, 1, 1, 0, 1)), [], "the morning after");
});

test("only the entries whose term covers today come back", () => {
  const list = [
    entry({ id: "past", from: "2026-01-01", until: "2026-03-31" }),
    entry({ id: "now", from: "2026-10-01", until: "2026-12-31" }),
    entry({ id: "later", from: "2027-01-01", until: "2027-03-31" }),
  ];
  assert.deepEqual(activeSupporters(list, new Date(2026, 9, 14, 12)).map((s) => s.id), ["now"]);
});

test("an empty list has nobody to highlight", () => {
  assert.deepEqual(activeSupporters([], new Date(2026, 9, 14, 12)), []);
});
