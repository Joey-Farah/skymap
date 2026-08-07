import test from "node:test";
import assert from "node:assert/strict";
import { buildComboEntries, searchEntries } from "../src/combo.ts";

test("accented names are found by typing them without accents", () => {
  // Twelve real downtown places were unreachable: Pizza Lucé, Fogo de Chão,
  // Jalapeño Mexican Grill, Bép Eatery, Los 3 Costeños, Engel & Völkers and
  // others. Nothing failed loudly — the dropdown just stayed empty, exactly
  // as if the restaurant weren't in the app at all.
  const entries = [
    { id: "a", label: "Pizza Lucé", sublabel: "in City Center", lat: 44.97, lon: -93.27 },
    { id: "b", label: "Fogo de Chão", sublabel: "in City Center", lat: 44.97, lon: -93.27 },
    { id: "c", label: "Jalapeño Mexican Grill", sublabel: "", lat: 44.97, lon: -93.27 },
  ];
  assert.equal(searchEntries(entries, "pizza luce")[0]?.id, "a");
  assert.equal(searchEntries(entries, "fogo de chao")[0]?.id, "b");
  assert.equal(searchEntries(entries, "jalapeno")[0]?.id, "c");
  // Typing the accent still works — folding must not break the exact spelling.
  assert.equal(searchEntries(entries, "Pizza Lucé")[0]?.id, "a");
});

test("curly and straight apostrophes find each other", () => {
  // Two names are stored with U+2019 and 36 with a straight quote, and
  // neither spelling found the other. iOS smart punctuation rewrites what
  // you type, so which direction breaks depends on the keyboard.
  const entries = [
    { id: "curly", label: "Tom’s Watch Bar", sublabel: "", lat: 44.97, lon: -93.27 },
    { id: "straight", label: "Brit's Pub", sublabel: "", lat: 44.97, lon: -93.27 },
  ];
  assert.equal(searchEntries(entries, "Tom's Watch Bar")[0]?.id, "curly", "straight query finds curly name");
  assert.equal(searchEntries(entries, "Tom’s Watch Bar")[0]?.id, "curly", "curly query still works");
  assert.equal(searchEntries(entries, "Brit’s Pub")[0]?.id, "straight", "curly query finds straight name");
  assert.equal(searchEntries(entries, "Brit's Pub")[0]?.id, "straight", "straight query still works");
});

test("a name is found whether or not you type the apostrophe at all", () => {
  const entries = [{ id: "t", label: "Tom’s Watch Bar", sublabel: "", lat: 44.97, lon: -93.27 }];
  for (const q of ["Toms Watch Bar", "Tom's Watch Bar", "Tom’s Watch Bar"]) {
    assert.equal(searchEntries(entries, q)[0]?.id, "t", `query ${JSON.stringify(q)}`);
  }
});

test("named light-rail stations are searchable, ordinary bus stops are not", () => {
  // Exterior POIs are excluded because a bus stop isn't a destination you
  // route to. But Government Plaza and Warehouse District are major Metro
  // stations with no other record carrying their name, so searching for
  // them returned nothing at all. Target Field and US Bank Stadium only
  // seemed fine because separate landmark POIs share those names.
  const buildings = [{ id: "h", name: "Host", address: "1 St", lat: 44.97, lon: -93.27 }];
  const pois = [
    { id: "s", name: "Government Plaza", buildingId: "h", group: "transit", category: "station", exterior: true, lat: 44.97, lon: -93.27 },
    { id: "b", name: "7th St & Nicollet", buildingId: "h", group: "transit", category: "bus_stop", exterior: true, lat: 44.97, lon: -93.27 },
  ];
  const entries = buildComboEntries(buildings, pois);
  assert.equal(searchEntries(entries, "Government Plaza")[0]?.label, "Government Plaza");
  assert.equal(searchEntries(entries, "7th St & Nicollet").length, 0, "bus stops stay out");
});
