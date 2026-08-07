import test from "node:test";
import assert from "node:assert/strict";
import { closingSoonWarnings, skywayAccessLabel, statusFromHours, weeklyHoursRows } from "../src/hours.ts";

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

// --- weeklyHoursRows: one row per day, for a real table -------------------

// Mon-Fri 7am-4pm, closed weekends — the exact shape of Vitality Roasting.
const weekdayCafe = [null, [420, 960], [420, 960], [420, 960], [420, 960], [420, 960], null];

test("returns all seven days by full name, Monday first", () => {
  const rows = weeklyHoursRows(weekdayCafe, monday1pm);
  assert.equal(rows.length, 7);
  assert.deepEqual(
    rows.map((r) => r.day),
    ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  );
});

test("open days carry a time range, closed days say Closed", () => {
  const rows = weeklyHoursRows(weekdayCafe, monday1pm);
  assert.equal(rows[0].value, "7am–4pm");
  assert.equal(rows[0].closed, false);
  assert.equal(rows[5].value, "Closed");
  assert.equal(rows[5].closed, true);
});

test("exactly one row is flagged as today", () => {
  const rows = weeklyHoursRows(weekdayCafe, monday1pm);
  assert.deepEqual(
    rows.filter((r) => r.today).map((r) => r.day),
    ["Monday"],
  );
});

test("today tracks the real weekday, including a closed one", () => {
  const sunday = new Date(2026, 6, 26, 13, 0);
  const rows = weeklyHoursRows(weekdayCafe, sunday);
  const today = rows.find((r) => r.today);
  assert.equal(today.day, "Sunday");
  assert.equal(today.closed, true);
});

test("a place that never closes doesn't claim to shut at midnight", () => {
  // [0,1440] is this app's own encoding for "never closes" — parseOpeningHours
  // maps 24/7 to exactly that. But formatMinute wraps 1440 to "12am", so five
  // 24-hour parking garages and The Nicollet Diner all read "Open until 12am",
  // which at 11:45pm looks like fifteen minutes' warning.
  const allDay = Array(7).fill([0, 1440]);
  for (const at of [new Date(2026, 7, 6, 23, 40), new Date(2026, 7, 6, 3, 0), new Date(2026, 7, 6, 12, 0)]) {
    const s = statusFromHours(allDay, at);
    assert.equal(s.open, true, `should be open at ${at.getHours()}:00`);
    assert.match(s.label, /24 hours/i, `got ${JSON.stringify(s.label)}`);
    assert.doesNotMatch(s.label, /12am/, "must not read as a midnight close");
  }
});

test("a 24-hour building never triggers a closing-soon warning", () => {
  // The route preview said "Midtown Parking Ramp closes at 12am — 15 min
  // after you'd arrive" about a garage that never shuts.
  const b = { id: "ramp", name: "Midtown Parking Ramp", hours: Array(7).fill([0, 1440]) };
  const route = { steps: [{ building: b, arrivalMinutes: 5 }], totalMinutes: 5, totalMeters: 100 };
  assert.deepEqual(closingSoonWarnings(route, new Date(2026, 7, 6, 23, 40)), []);
});

test("a real late close still warns", () => {
  const b = { id: "tower", name: "Some Tower", hours: Array(7).fill([390, 1320]) }; // 06:30-22:00
  const w = closingSoonWarnings({ steps: [{ building: b, arrivalMinutes: 5 }], totalMinutes: 5, totalMeters: 100 },
    new Date(2026, 7, 6, 21, 40));
  assert.equal(w.length, 1);
  assert.match(w[0].label, /closes at 10pm/);
});
