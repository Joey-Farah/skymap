import test from "node:test";
import assert from "node:assert/strict";

import { nativeGeolocationShim } from "../src/native-geolocation.ts";

/** Stands in for @capacitor/geolocation: records watches, and lets the test
 * deliver positions and errors to them. */
function fakePlugin() {
  let next = 1;
  const watches = new Map();
  return {
    watches,
    started: 0,
    cleared: [],
    async watchPosition(_options, cb) {
      this.started++;
      const id = `native-${next++}`;
      watches.set(id, cb);
      return id;
    },
    async clearWatch({ id }) {
      this.cleared.push(id);
      watches.delete(id);
    },
    async getCurrentPosition() {
      throw new Error("not used");
    },
    deliver(cbArgs) {
      for (const cb of [...watches.values()]) cb(...cbArgs);
    },
  };
}

const fix = (lat) => ({ timestamp: 1, coords: { latitude: lat, longitude: -93.27, accuracy: 10 } });
const tick = () => new Promise((r) => setTimeout(r, 0));

test("a watch keeps delivering after the native first-fix timeout", async () => {
  // @capacitor/geolocation stops a watch for good when its first fix takes
  // longer than the timeout (it stops updating and ignores later fixes), so
  // opening the app deep indoors left GPS dead until a relaunch. The web API
  // MapLibre is written against keeps a watch alive through a timeout.
  const plugin = fakePlugin();
  const geo = nativeGeolocationShim(plugin);
  const seen = [];
  const errors = [];
  geo.watchPosition((p) => seen.push(p.coords.latitude), (e) => errors.push(e.code), { timeout: 15000 });
  await tick();
  assert.equal(plugin.started, 1);

  plugin.deliver([null, { message: "Could not obtain location in time. Try with a higher timeout." }]);
  await tick();
  await tick();
  assert.equal(errors.length, 1, "MapLibre still hears about the timeout");
  assert.equal(plugin.started, 2, "and a fresh native watch takes over");
  assert.deepEqual(plugin.cleared, ["native-1"], "the dead one is cleared");

  plugin.deliver([fix(44.97), undefined]);
  assert.deepEqual(seen, [44.97]);
});

test("other errors leave the native watch alone", async () => {
  const plugin = fakePlugin();
  const geo = nativeGeolocationShim(plugin);
  const errors = [];
  geo.watchPosition(() => {}, (e) => errors.push(e.code), {});
  await tick();
  plugin.deliver([null, { message: "There was an error trying to obtain the location." }]);
  plugin.deliver([null, { message: "Location permission request was denied." }]);
  await tick();
  assert.deepEqual(errors, [2, 1]);
  assert.equal(plugin.started, 1);
});

test("clearWatch stops whichever native watch is current", async () => {
  const plugin = fakePlugin();
  const geo = nativeGeolocationShim(plugin);
  const id = geo.watchPosition(() => {}, () => {}, {});
  await tick();
  plugin.deliver([null, { message: "Could not obtain location in time. Try with a higher timeout." }]);
  await tick();
  await tick();
  geo.clearWatch(id);
  await tick();
  await tick();
  assert.equal(plugin.watches.size, 0, "no native watch outlives the web one");
  // A late timeout from the cleared watch must not resurrect it.
  assert.equal(plugin.started, 2);
});
