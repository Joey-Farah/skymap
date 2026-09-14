import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SkywayRouter } from "../src/router.ts";

// A reader's 1.12 screenshot: the bridge from Mayo Clinic Square stopped
// dead at the Marriott's door, with OSM's own grey corridor carrying on
// underneath to City Center. OSM maps that corridor as one "Minneapolis
// Skyway" way. The extractor kept one link per pair of buildings, and the
// Marriott meets City Center twice — so the second meeting, and every other
// building pair's second crossing, was thrown away.
const data = JSON.parse(readFileSync("public/data/skymap-data.json", "utf8"));

const key = (c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`;
const between = (a, b) => data.edges.filter((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));

test("two buildings that meet twice keep both crossings", () => {
  const crossings = between("city-center-27346720", "minneapolis-marriott-city-center-27346715");
  assert.equal(crossings.length, 2);
  // The one from the screenshot, OSM way 156912833: City Center's junction
  // into the Marriott, joined indoors to the Marriott's door on the Mayo side.
  const touches = (c) => crossings.some((e) => e.geometry?.some((g) => key(g) === key(c)));
  assert.ok(touches([-93.273451, 44.978034]), "the corridor from City Center's junction is still missing");
});

// Line ends that go nowhere, in buildings with more than one door. These
// remain after recovering the dropped crossings: each needs looking at on
// its own (an unmapped corridor, or a stray footway the extractor took for a
// crossing). The list may shrink; a new entry is a new gap on the map.
const KNOWN_DEAD_ENDS = {
  "365-nicollet-827426569": 1,
  "4th-street-ramp-c-27346543": 1,
  "butler-square-29060521": 2,
  "clark-danielson-college-life-center-39239951": 2,
  "depot-office-center-81049079": 2,
  "ford-center-29060527": 2,
  "nicollet-island-inn-80313504": 2,
  "north-loop-green-360-1281792415": 2,
  "rbc-gateway-733105254": 2,
  "rsm-plaza-357019983": 1,
  "target-center-23125943": 1,
  "technical-building-89061902": 2,
  "the-nic-on-fifth-827452015": 1,
  "young-quinlan-building-44684854": 1,
};

test("no skyway line ends in a dead end beyond the known ones", () => {
  const degree = new Map();
  const owner = new Map();
  const doors = new Map();
  const bump = (c, n) => degree.set(key(c), (degree.get(key(c)) ?? 0) + n);
  for (const e of data.edges) {
    if (!e.geometry) continue;
    for (const [c, id] of [[e.geometry[0], e.from], [e.geometry.at(-1), e.to]]) {
      bump(c, 1);
      owner.set(key(c), id);
      doors.set(id, (doors.get(id) ?? new Set()).add(key(c)));
    }
    e.geometry.slice(1, -1).forEach((c) => bump(c, 2));
  }
  for (const l of data.indoorLinks) {
    for (const c of [l.geometry[0], l.geometry.at(-1)]) {
      bump(c, 1);
      if (!owner.has(key(c))) owner.set(key(c), l.buildingId);
    }
    l.geometry.slice(1, -1).forEach((c) => bump(c, 2));
  }
  const deadEnds = {};
  for (const [c, d] of degree) {
    const id = owner.get(c);
    if (d === 1 && (doors.get(id)?.size ?? 0) > 1) deadEnds[id] = (deadEnds[id] ?? 0) + 1;
  }
  assert.deepEqual(Object.fromEntries(Object.entries(deadEnds).sort()), KNOWN_DEAD_ENDS);
});

test("more crossings never make a route slower", () => {
  // The recovered crossings exposed a router that kept one arrival per
  // building: with more of the network it returned 2,979 slower routes.
  // Every pair was checked when that was fixed; this samples every seventh
  // origin to keep the suite quick.
  const seen = new Set();
  const firstOnly = {
    ...data,
    edges: data.edges.filter((e) => {
      const pair = [e.from, e.to].sort().join("|");
      return !seen.has(pair) && seen.add(pair);
    }),
  };
  const full = new SkywayRouter(data);
  const fewer = new SkywayRouter(firstOnly);
  const ids = data.buildings.map((b) => b.id);
  const slower = [];
  for (const a of ids.filter((_, i) => i % 7 === 0)) {
    for (const b of ids) {
      if (a === b) continue;
      const x = full.route(a, b, null);
      const y = fewer.route(a, b, null);
      if (x && y && x.totalMinutes > y.totalMinutes + 1e-9) slower.push(`${a} -> ${b}`);
    }
  }
  assert.deepEqual(slower.slice(0, 5), []);
});
