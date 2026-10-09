import test from "node:test";
import assert from "node:assert/strict";
import { RESUME_WITHIN_MS, forgetTrip, rememberTrip, takeTripToResume } from "../src/trip-resume.ts";

const store = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test("a trip under way is there to resume after a reload (QA 051)", () => {
  const s = store();
  rememberTrip(s, { toId: "target-plaza", poiId: "poi-caribou" }, 1_000);
  assert.deepEqual(takeTripToResume(s, 1_000 + 60_000), { toId: "target-plaza", poiId: "poi-caribou" });
});

test("a trip left for half an hour is over, and forgotten", () => {
  const s = store();
  rememberTrip(s, { toId: "target-plaza" }, 0);
  assert.equal(takeTripToResume(s, RESUME_WITHIN_MS + 1), null);
  assert.equal(s.m.size, 0, "not offered again later");
});

test("walking keeps a trip fresh: the half hour runs from the last sign of it", () => {
  const s = store();
  rememberTrip(s, { toId: "t" }, 0);
  rememberTrip(s, { toId: "t" }, 20 * 60_000); // still walking 20 min in
  assert.ok(takeTripToResume(s, 45 * 60_000));
});

test("an ended trip isn't resumed", () => {
  const s = store();
  rememberTrip(s, { toId: "t" }, 0);
  forgetTrip(s);
  assert.equal(takeTripToResume(s, 1), null);
});

test("junk or a storage that refuses never breaks a launch", () => {
  const s = store();
  s.setItem("skymap.trip", "{not json");
  assert.equal(takeTripToResume(s, 0), null);
  const refusing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } };
  assert.equal(takeTripToResume(refusing, 0), null);
  assert.doesNotThrow(() => rememberTrip(refusing, { toId: "t" }, 0));
  assert.doesNotThrow(() => forgetTrip(refusing));
});

test("a trip is offered back once: leaving it unstarted doesn't bring it back again", () => {
  const s = store();
  rememberTrip(s, { toId: "t" }, 0);
  assert.ok(takeTripToResume(s, 1000));
  assert.equal(takeTripToResume(s, 2000), null, "GO remembers it again; nothing else does");
});
