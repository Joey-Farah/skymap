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

test("a later 'off' clause overrides an earlier day span", () => {
  // "open all week except one day" is a normal OSM pattern, and the later
  // rule has to win — same as a later span overrides an earlier one. A
  // building that reports itself open on its closed day gets routed
  // through, which is the one thing the network map must never do.
  const h = parseOpeningHours("Mo-Fr 08:00-17:00; Tu off");
  assert.equal(h[2], null, "Tuesday should be closed");
  assert.deepEqual(h[1], [480, 1020], "Monday keeps the earlier span");
  assert.deepEqual(h[3], [480, 1020], "Wednesday keeps the earlier span");
});

test("an earlier 'off' clause is still overridden by a later span", () => {
  // The mirror case — later-rule-wins has to hold in both directions.
  const h = parseOpeningHours("Mo-Su off; Sa 10:00-18:00");
  assert.deepEqual(h[6], [600, 1080], "Saturday reopened by the later rule");
  assert.equal(h[1], null, "Monday stays closed");
});

test("a close after midnight runs on into the next morning", () => {
  // Written as a wrap (close <= open), the way 23 downtown bars are. These
  // were discarded whole, so every one of them read "Hours unknown".
  const h = parseOpeningHours("Mo-Th 05:00-23:30; Fr 05:00-01:00; Sa,Su 05:00-00:30; PH off");
  assert.deepEqual(h[1], [300, 1410]);
  assert.deepEqual(h[5], [300, 1500], "Friday until 1am");
  assert.deepEqual(h[0], [300, 1470], "Sunday until 12:30am");
  assert.deepEqual(parseOpeningHours("Mo-Th 15:00-00:00")[1], [900, 1440], "until midnight");
  assert.deepEqual(parseOpeningHours("Mo-Su 16:00-26:00")[6], [960, 1560], "the extended-time spelling");
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

test("split hours keep their gap", () => {
  // Closed 12:00-13:00. Unioning to [360, 1200] would report it open
  // through the closure; two windows say what the sign says.
  assert.deepEqual(parseOpeningHours("Mo-Fr 06:00-12:00,13:00-20:00")[1], [360, 720, 780, 1200]);
});

test("a rule after a comma adds to the days it names (QA 034)", () => {
  // OUIBar + KTCHN: breakfast and dinner on weekdays. Read as an override,
  // breakfast vanished and 7:30am said "Closed · opens 5pm".
  const h = parseOpeningHours("Mo-Fr 06:30-09:30, Mo-Fr 17:00-22:00; Sa-Su 07:00-11:00; Sa 17:00-23:00");
  assert.deepEqual(h[3], [390, 570, 1020, 1320]);
  // A semicolon still replaces: by the letter of the syntax Saturday is
  // dinner only, whatever the mapper meant.
  assert.deepEqual(h[6], [1020, 1380]);
  assert.deepEqual(h[0], [420, 660]);
});

test("a day-scoped 24/7 clause is recognized like the bare whole-value form", () => {
  const h = parseOpeningHours("Fr 24/7");
  assert.deepEqual(h[5], [0, 1440]);
  assert.equal(h[1], null);
});

test("all-off week returns null rather than an all-closed array", () => {
  assert.equal(parseOpeningHours("Mo off; Tu off; We off; Th off; Fr off; Sa off; Su off"), null);
});

test("a space after the comma doesn't discard the whole tag", () => {
  // Two Naf Naf Grill branches differ by exactly one space. The spaced one
  // had its entire value thrown away, so its card read "Hours unknown"
  // while its twin showed a full Mon-Fri table.
  const spaced = parseOpeningHours("Mo-Fr 10:00-19:00; Sa, Su off");
  const tight = parseOpeningHours("Mo-Fr 08:00-16:00; Sa,Su off");
  assert.ok(spaced, "spaced day list must parse");
  assert.deepEqual(spaced[1], [600, 1140], "Monday open");
  assert.equal(spaced[6], null, "Saturday closed");
  assert.equal(spaced[0], null, "Sunday closed");
  assert.ok(tight, "unspaced still parses");
});

test("'closed' is accepted as a synonym for 'off'", () => {
  const r = parseOpeningHours("Mo-Fr 08:30-17:00; Sa-Su closed");
  assert.ok(r, "closed keyword must not discard the tag");
  assert.deepEqual(r[1], [510, 1020]);
  assert.equal(r[6], null);
  assert.equal(r[0], null);
});

test("a month-scoped rule is rejected rather than silently applied to every day", () => {
  // "Sep-May Mo-Fr 09:00-21:00" used to come back as all seven days open
  // 9am-9pm: the month range matched no day-spec, so the clause fell
  // through to "applies to every day", and Mo-Fr was discarded with it.
  // Seasonal hours are real (MacPhail publishes an academic-year and a
  // summer schedule), so this has to fail loudly rather than invent a
  // Sunday. Returning null makes the whole value unusable, which is what
  // the applier already refuses to ship.
  assert.equal(parseOpeningHours("Sep-May Mo-Fr 09:00-21:00"), null);
  assert.equal(parseOpeningHours("Jun-Aug Mo-Th 09:00-21:00"), null);
});

test("a leading day-spec is still optional for a plain daily range", () => {
  // The fix must not break the ordinary "same every day" form.
  assert.deepEqual(parseOpeningHours("09:00-21:00"), Array(7).fill([540, 1260]));
});

test("every day in a spaced day list is kept, not just the first (QA 033)", () => {
  // The News Room. The spaced list matched, but " Su" (with its space)
  // then failed the day pattern and silently dropped out, so the card read
  // "Closed" all weekend.
  const days = parseOpeningHours("Mo-Th, Su 11:00-22:00; Fr, Sa 11:00-23:00");
  assert.deepEqual(days, [
    [660, 1320], // Su
    [660, 1320],
    [660, 1320],
    [660, 1320],
    [660, 1320], // Th
    [660, 1380], // Fr
    [660, 1380], // Sa
  ]);
});

test("an nth-weekday rule is unknown, not read as every week (QA 008)", () => {
  // "4th Sunday" is a monthly event; read as weekly, the free meal showed
  // "Open until 6pm" on three Sundays out of four.
  assert.equal(parseOpeningHours("Su[4] 17:00-18:00"), null);
  assert.equal(parseOpeningHours("Sa[3] 15:30-17:00"), null);
  // A time range with a note after it is still read as before.
  assert.ok(parseOpeningHours('Mo-Fr 09:00-17:00 "by appointment"'));
});
