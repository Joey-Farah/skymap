import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { clearRetiredKeys, RETIRED_KEYS } from "../src/storage.ts";

function memoryStore(seed = {}) {
  const mem = new Map(Object.entries(seed));
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
    removeItem: (k) => mem.delete(k),
    keys: () => [...mem.keys()],
  };
}

// A ramp saved by the retired Save My Ramp feature outlives the feature:
// it sits in the WebView's localStorage, which a native app update does not
// touch. Reinstalling the app was the only way to clear it, and that is not
// something to ask of anyone.
test("a ramp saved by the retired feature is dropped on boot", () => {
  const store = memoryStore({
    "skymap.savedRamp": JSON.stringify({ id: "ramp-1", name: "Minneapolis Club Parking Ramp" }),
    "skymap.recents": '["forum"]',
  });
  clearRetiredKeys(store);
  assert.equal(store.getItem("skymap.savedRamp"), null);
  assert.equal(store.getItem("skymap.recents"), '["forum"]', "a live key was purged too");
});

test("clearing is safe when there is nothing to clear", () => {
  const store = memoryStore();
  clearRetiredKeys(store);
  assert.deepEqual(store.keys(), []);
});

test("boot actually clears the retired keys", () => {
  // The list is only worth having if main.ts calls it -- the old inline
  // removeItem it replaces was easy to forget when a feature was retired.
  const main = readFileSync("src/main.ts", "utf8");
  assert.match(main, /clearRetiredKeys\(localStorage\)/);
  assert.ok(RETIRED_KEYS.includes("skymap.savedRamp"));
  assert.ok(RETIRED_KEYS.includes("skymap.incidents"));
});

// The prompt was un-dismissable on device and the button under it redrew
// itself every boot. Neither can come back by half: markup restored without
// handlers is a dead panel over the map, handlers without markup throw on
// boot. This asserts the whole feature stays gone.
test("no part of Save My Ramp is left in the shipped app", () => {
  const surfaces = {
    "index.html": readFileSync("index.html", "utf8"),
    "src/main.ts": readFileSync("src/main.ts", "utf8"),
    "src/styles.css": readFileSync("src/styles.css", "utf8"),
  };
  for (const [file, text] of Object.entries(surfaces)) {
    for (const token of ["ramp-prompt", "ramp-return", "Parked at"]) {
      assert.ok(!text.includes(token), `${file} still carries ${token}`);
    }
  }
  assert.ok(!existsSync("src/ramp.ts"), "src/ramp.ts is back");
});
