import test from "node:test";
import assert from "node:assert/strict";
import { compareVersions, updateGate } from "../src/app-version.ts";

test("versions compare by number, not by string", () => {
  // The whole reason this isn't a string compare: "1.9" > "1.10" lexically,
  // and 1.9 is the version the gate would most likely be pointed at.
  assert.ok(compareVersions("1.10", "1.9") > 0);
  assert.ok(compareVersions("1.9", "1.10") < 0);
  assert.equal(compareVersions("1.11", "1.11"), 0);
  assert.ok(compareVersions("2.0", "1.99") > 0);
  assert.ok(compareVersions("1.2.3", "1.2") > 0, "a longer version is later than its own prefix");
});

test("no manifest means no gate — offline must never lock anyone out", () => {
  // The app's promise is that it works in a skyway with no signal. A gate
  // that fails closed would break it exactly where it is needed most.
  assert.deepEqual(updateGate("1.11", null), { kind: "none" });
  assert.deepEqual(updateGate("1.11", {}), { kind: "none" });
});

test("a version below the floor is blocked", () => {
  const gate = updateGate("1.9", { minVersion: "1.11", message: "Old versions get stuck." });
  assert.equal(gate.kind, "block");
  assert.equal(gate.message, "Old versions get stuck.");
});

test("the floor version itself is allowed through", () => {
  assert.equal(updateGate("1.11", { minVersion: "1.11" }).kind, "none");
  assert.equal(updateGate("1.12", { minVersion: "1.11" }).kind, "none");
});

test("a newer release is suggested, never forced", () => {
  const gate = updateGate("1.11", { latestVersion: "1.12" });
  assert.equal(gate.kind, "suggest");
  assert.equal(gate.version, "1.12");
});

test("blocking outranks suggesting", () => {
  const gate = updateGate("1.8", { minVersion: "1.10", latestVersion: "1.12" });
  assert.equal(gate.kind, "block");
});

test("a malformed manifest is treated as no manifest", () => {
  // A typo in a hand-edited JSON file must not brick every install.
  assert.equal(updateGate("1.11", { minVersion: 11 }).kind, "none");
  assert.equal(updateGate("1.11", { minVersion: "banana" }).kind, "none");
  assert.equal(updateGate("dev", { minVersion: "1.11" }).kind, "none", "an unbuilt dev version is exempt");
});

test("a stale manifest may suggest, and may never wall someone in", async () => {
  const { gateFromSources } = await import("../src/app-version.ts");
  const blocking = { minVersion: "9.9", message: "broken" };

  // Fetched just now: the wall is allowed.
  assert.equal(gateFromSources("1.11", blocking, null).kind, "block");
  // The same file, remembered rather than confirmed: it isn't. Someone in a
  // skyway with no signal keeps their map.
  assert.equal(gateFromSources("1.11", null, blocking).kind, "none");
  // A cached suggestion is still fine — nothing is taken away by it.
  assert.equal(gateFromSources("1.11", null, { latestVersion: "9.9" }).kind, "suggest");
  // Fresh wins outright: a floor that has been lowered takes effect now.
  assert.equal(gateFromSources("1.11", { latestVersion: "1.11" }, blocking).kind, "none");
});
