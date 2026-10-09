import test from "node:test";
import assert from "node:assert/strict";

import { POSITION_OPTIONS, nativeGeolocationShim, withPositionOptions } from "../src/native-geolocation.ts";

/** Stands in for @capacitor/geolocation: records watches, and lets the test
 * deliver positions and errors to them. */
function fakePlugin() {
  let next = 1;
  const watches = new Map();
  return {
    watches,
    started: 0,
    cleared: [],
    callbacks: [],
    async watchPosition(_options, cb) {
      this.started++;
      const id = `native-${next++}`;
      watches.set(id, cb);
      this.callbacks.push(cb);
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

const TIMEOUT = [null, { message: "Could not obtain location in time. Try with a higher timeout." }];

test("clearWatch stops whichever native watch is current", async () => {
  const plugin = fakePlugin();
  const geo = nativeGeolocationShim(plugin);
  const id = geo.watchPosition(() => {}, () => {}, { timeout: 15000 });
  await tick();
  plugin.deliver(TIMEOUT);
  await tick();
  await tick();
  geo.clearWatch(id);
  await tick();
  await tick();
  assert.equal(plugin.watches.size, 0, "no native watch outlives the web one");
  // Late timeouts from either native watch, after the web one is cleared,
  // must not bring it back.
  for (const cb of plugin.callbacks) cb(...TIMEOUT);
  await tick();
  await tick();
  assert.equal(plugin.started, 2);
  assert.equal(plugin.watches.size, 0);
});

test("a zero timeout is never restarted, so it can't spin", async () => {
  const plugin = fakePlugin();
  const geo = nativeGeolocationShim(plugin);
  geo.watchPosition(() => {}, () => {}, { timeout: 0 });
  await tick();
  plugin.deliver(TIMEOUT);
  await tick();
  await tick();
  assert.equal(plugin.started, 1);
});

test("every request carries the app's own position options (review of QA 027)", () => {
  // MapLibre asks a "second" watch for 3 km accuracy and a zero timeout.
  const seen = [];
  const geo = withPositionOptions({
    watchPosition: (_s, _e, o) => (seen.push(o), 1),
    getCurrentPosition: (_s, _e, o) => seen.push(o),
    clearWatch: () => {},
  });
  geo.watchPosition(() => {}, () => {}, { maximumAge: 600000, timeout: 0 });
  geo.getCurrentPosition(() => {}, () => {}, { enableHighAccuracy: false });
  assert.deepEqual(seen, [POSITION_OPTIONS, POSITION_OPTIONS]);
  assert.equal(POSITION_OPTIONS.enableHighAccuracy, true);
  assert.ok(POSITION_OPTIONS.timeout > 0);
});
