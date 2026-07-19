import test from "node:test";
import assert from "node:assert/strict";
import { recordRecent, getRecents } from "../src/recents.ts";

function memoryStore() {
  const mem = new Map();
  return {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => mem.set(k, v),
    removeItem: (k) => mem.delete(k),
  };
}

test("empty store has no recents", () => {
  assert.deepEqual(getRecents(memoryStore()), []);
});

test("recording a selection makes it the most recent", () => {
  const store = memoryStore();
  recordRecent(store, { id: "a", name: "Forum" });
  const recents = getRecents(store);
  assert.equal(recents.length, 1);
  assert.equal(recents[0].id, "a");
  assert.equal(recents[0].name, "Forum");
});

test("most recently selected building sorts first", () => {
  const store = memoryStore();
  recordRecent(store, { id: "a", name: "Forum" });
  recordRecent(store, { id: "b", name: "IDS Center" });
  const recents = getRecents(store);
  assert.deepEqual(recents.map((r) => r.id), ["b", "a"]);
});

test("re-selecting an existing recent moves it to the front, no duplicate", () => {
  const store = memoryStore();
  recordRecent(store, { id: "a", name: "Forum" });
  recordRecent(store, { id: "b", name: "IDS Center" });
  recordRecent(store, { id: "a", name: "Forum" });
  const recents = getRecents(store);
  assert.deepEqual(recents.map((r) => r.id), ["a", "b"]);
  assert.equal(recents.length, 2);
});

test("caps at 5 most recent", () => {
  const store = memoryStore();
  for (const id of ["a", "b", "c", "d", "e", "f"]) {
    recordRecent(store, { id, name: id });
  }
  const recents = getRecents(store);
  assert.equal(recents.length, 5);
  assert.deepEqual(recents.map((r) => r.id), ["f", "e", "d", "c", "b"]);
});

test("corrupt data doesn't throw, just reads as empty", () => {
  const store = memoryStore();
  store.setItem("skymap.recents", "{not json");
  assert.deepEqual(getRecents(store), []);
});

test("a selected business is recorded as itself, not just its host building", () => {
  const store = memoryStore();
  recordRecent(store, { id: "six-quebec", name: "Vitality Roasting", poiId: "poi-vitality" });
  const recents = getRecents(store);
  assert.equal(recents.length, 1);
  assert.equal(recents[0].name, "Vitality Roasting");
  assert.equal(recents[0].poiId, "poi-vitality");
});

test("the building itself and a business inside it are distinct recents", () => {
  const store = memoryStore();
  recordRecent(store, { id: "six-quebec", name: "Six Quebec" });
  recordRecent(store, { id: "six-quebec", name: "Vitality Roasting", poiId: "poi-vitality" });
  const recents = getRecents(store);
  assert.equal(recents.length, 2);
  assert.deepEqual(
    recents.map((r) => r.name),
    ["Vitality Roasting", "Six Quebec"],
  );
});
