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

/** A voice the walker has already turned on. */
function onVoice(engine, store = memoryStore()) {
  const voice = createVoice(engine, store);
  voice.setEnabled(true);
  return voice;
}

test("a new line is said once, however many fixes repeat it", () => {
  const engine = fakeEngine();
  const voice = onVoice(engine);
  voice.say("Head into Baker Center");
  voice.say("Head into Baker Center");
  voice.say("Head into Baker Center");
  assert.deepEqual(engine.said, ["Head into Baker Center"]);
});

test("ending a trip stops speech, and the next trip starts with its first line", () => {
  // Walking the same route twice: the second GO has to speak, even though
  // its first line is the one the first trip started with.
  const engine = fakeEngine();
  const voice = onVoice(engine);
  voice.say("Head into Baker Center");
  voice.stop();
  voice.say("Head into Baker Center");
  assert.deepEqual(engine.said, ["Head into Baker Center", "<stop>", "Head into Baker Center"]);
});

test("it is off until the walker turns it on, and stays on next launch", () => {
  // Off by default (Joey, 2026-10-27): a phone that starts talking
  // unasked in a quiet office is worse than one that has to be asked.
  const store = memoryStore();
  const engine = fakeEngine();
  const voice = createVoice(engine, store);
  assert.equal(voice.enabled(), false);
  voice.say("Head into Baker Center");
  assert.deepEqual(engine.said, []);

  voice.setEnabled(true);
  const relaunched = createVoice(fakeEngine(), store);
  assert.equal(relaunched.enabled(), true);
});

test("turning it off silences it at once, and it stays off next launch", () => {
  const store = memoryStore();
  const engine = fakeEngine();
  const voice = onVoice(engine, store);
  voice.say("Head into Baker Center");
  voice.setEnabled(false);
  voice.say("Head into City Center");
  assert.deepEqual(engine.said, ["Head into Baker Center", "<stop>"]);

  const relaunched = createVoice(fakeEngine(), store);
  assert.equal(relaunched.enabled(), false);
});

test("turning it on says the line the banner is on now", () => {
  // The button's only feedback is the voice itself: turning it on mid-walk
  // and hearing nothing until the next building reads as broken.
  const engine = fakeEngine();
  const voice = createVoice(engine, memoryStore());
  voice.say("Head into City Center");
  voice.setEnabled(true);
  assert.deepEqual(engine.said, ["Head into City Center"]);
});
