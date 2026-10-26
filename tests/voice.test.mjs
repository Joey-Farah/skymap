import test from "node:test";
import assert from "node:assert/strict";
import { createVoice } from "../src/voice.ts";

// The voice says what the nav banner says, once per new line. The banner is
// redrawn on every GPS fix, so most calls repeat the line already spoken.

function fakeEngine() {
  const said = [];
  return { said, speak: (text) => said.push(text), stop: () => said.push("<stop>") };
}

function memoryStore() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}

test("a new line is said once, however many fixes repeat it", () => {
  const engine = fakeEngine();
  const voice = createVoice(engine, memoryStore());
  voice.say("Head into Baker Center");
  voice.say("Head into Baker Center");
  voice.say("Head into Baker Center");
  assert.deepEqual(engine.said, ["Head into Baker Center"]);
});

test("ending a trip stops speech, and the next trip starts with its first line", () => {
  // Walking the same route twice: the second GO has to speak, even though
  // its first line is the one the first trip started with.
  const engine = fakeEngine();
  const voice = createVoice(engine, memoryStore());
  voice.say("Head into Baker Center");
  voice.stop();
  voice.say("Head into Baker Center");
  assert.deepEqual(engine.said, ["Head into Baker Center", "<stop>", "Head into Baker Center"]);
});

test("muting silences it at once, and it stays muted next launch", () => {
  const store = memoryStore();
  const engine = fakeEngine();
  const voice = createVoice(engine, store);
  assert.equal(voice.enabled(), true, "on until the walker turns it off");
  voice.say("Head into Baker Center");
  voice.setEnabled(false);
  voice.say("Head into City Center");
  assert.deepEqual(engine.said, ["Head into Baker Center", "<stop>"]);

  const relaunched = createVoice(fakeEngine(), store);
  assert.equal(relaunched.enabled(), false);
});

test("unmuting says the line the banner is on now", () => {
  // The button's only feedback is the voice itself: turning it on mid-walk
  // and hearing nothing until the next building reads as broken.
  const engine = fakeEngine();
  const voice = createVoice(engine, memoryStore());
  voice.setEnabled(false);
  voice.say("Head into City Center");
  voice.setEnabled(true);
  assert.deepEqual(engine.said, ["<stop>", "Head into City Center"]);
});
