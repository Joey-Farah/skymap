import test from "node:test";
import assert from "node:assert/strict";
import { parseOpeningHours } from "../src/opening-hours.ts";

test("24/7 opens every day all day", () => {
  const h = parseOpeningHours("24/7");
  for (const day of h) assert.deepEqual(day, [0, 1440]);
});

test("bare off is treated as unparseable (fall back to caller's default)", () => {
  assert.equal(parseOpeningHours("off"), null);
  assert.equal(parseOpeningHours(undefined), null);
  assert.equal(parseOpeningHours("garbage nonsense"), null);
});

test("simple weekday range leaves weekend closed", () => {
  const h = parseOpeningHours("Mo-Fr 06:00-20:00");
  assert.deepEqual(h[1], [360, 1200]); // Mon
  assert.deepEqual(h[5], [360, 1200]); // Fri
  assert.equal(h[0], null); // Sun
  assert.equal(h[6], null); // Sat
});

test("multiple semicolon rules cover the full week distinctly", () => {
  const h = parseOpeningHours("Mo-Fr 06:00-20:00; Sa 08:00-18:00; Su 10:00-18:00");
  assert.deepEqual(h[1], [360, 1200]);
  assert.deepEqual(h[6], [480, 1080]); // Sat
  assert.deepEqual(h[0], [600, 1080]); // Sun
});

test("comma-separated day list applies one window to just those days", () => {
  const h = parseOpeningHours("Mo,We,Fr 09:00-11:30");
  assert.deepEqual(h[1], [540, 690]); // Mon
  assert.equal(h[2], null); // Tue
  assert.deepEqual(h[3], [540, 690]); // Wed
  assert.equal(h[4], null); // Thu
  assert.deepEqual(h[5], [540, 690]); // Fri
});

test("Su-Sa wraps to cover the entire week", () => {
  const h = parseOpeningHours("Su-Sa 11:00-23:00");
  for (const day of h) assert.deepEqual(day, [660, 1380]);
});

test("PH (public holiday) clauses are ignored, not modeled", () => {
  const h = parseOpeningHours("Mo-Fr 06:00-20:00; PH off");
  assert.deepEqual(h[1], [360, 1200]);
  assert.equal(h[0], null);
  assert.equal(h[6], null);
});

test("an overnight wrap on even one clause discards the whole value", () => {
  // Fr and Sa/Su close after midnight (close <= open) — a day the model
  // can't represent. Rather than keep the good Mo-Th data and silently
  // mark Fri/Sat/Sun "closed" (they're actually open into the small
  // hours), the whole tag is discarded so the caller falls back to a
  // less specific but honest source instead of a partial guess.
  assert.equal(parseOpeningHours("Mo-Th 05:00-23:30; Fr 05:00-01:00; Sa,Su 05:00-00:30; PH off"), null);
});

test("comma used as a rule separator (non-standard but seen in real data)", () => {
  const h = parseOpeningHours("Mo-Fr 08:30-17:00, Sa 09:00-13:00");
  assert.deepEqual(h[1], [510, 1020]);
  assert.deepEqual(h[6], [540, 780]);
  assert.equal(h[0], null);
});

test("trailing quoted annotations after a time range are ignored", () => {
  const h = parseOpeningHours('Mo-We 19:00-22:00 open "skyway only"');
  assert.deepEqual(h[1], [1140, 1320]);
});

test("split hours (a lunch closure) are not collapsed into a false 'open all day'", () => {
  // "06:00-12:00,13:00-20:00" is closed 12:00-13:00 — a gap the DayHours
  // model has no way to represent. Unioning to [360, 1200] would wrongly
  // report the building open during the closure, so this value is
  // discarded entirely instead.
  assert.equal(parseOpeningHours("Mo-Fr 06:00-12:00,13:00-20:00"), null);
});

test("a day-scoped 24/7 clause is recognized like the bare whole-value form", () => {
  const h = parseOpeningHours("Fr 24/7");
  assert.deepEqual(h[5], [0, 1440]);
  assert.equal(h[1], null);
});

test("all-off week returns null rather than an all-closed array", () => {
  assert.equal(parseOpeningHours("Mo off; Tu off; We off; Th off; Fr off; Sa off; Su off"), null);
});
