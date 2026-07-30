import test from "node:test";
import assert from "node:assert/strict";
import { skywayAccessLabel } from "../src/hours.ts";

// Monday 1pm. Building open 6am-8pm every day.
const openDaily = Array(7).fill([360, 1200]);
const monday1pm = new Date(2026, 6, 27, 13, 0);

test("while the skyway is open it says when access ends", () => {
  // Deliberately not "Open until" — the business's own status badge already
  // owns that phrasing, and two things reading "Open until" on one card is
  // how a user mistakes the building's hours for the restaurant's.
  assert.equal(skywayAccessLabel(openDaily, monday1pm), "Access until 8pm");
});

test("before the skyway opens it says when access starts", () => {
  const monday5am = new Date(2026, 6, 27, 5, 0);
  assert.equal(skywayAccessLabel(openDaily, monday5am), "Access from 6am");
});

test("after close it points at the next day that has access", () => {
  const monday10pm = new Date(2026, 6, 27, 22, 0);
  assert.equal(skywayAccessLabel(openDaily, monday10pm), "Access from 6am tomorrow");
});

test("a day with no access at all is skipped when looking ahead", () => {
  // Closed Tuesday: standing in it late Monday, the next access is Wednesday.
  const closedTuesday = [
    [360, 1200], [360, 1200], null, [360, 1200], [360, 1200], [360, 1200], [360, 1200],
  ];
  const monday10pm = new Date(2026, 6, 27, 22, 0);
  // Abbreviated day name, matching statusFromHours' existing phrasing.
  assert.equal(skywayAccessLabel(closedTuesday, monday10pm), "Access from 6am Wed");
});

test("no usable hours yields null so the row is omitted rather than guessed", () => {
  assert.equal(skywayAccessLabel(undefined, monday1pm), null);
  assert.equal(skywayAccessLabel(Array(7).fill(null), monday1pm), null);
});
