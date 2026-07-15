#!/usr/bin/env node
/**
 * Skymap seed data generator.
 *
 * Produces public/data/skymap-data.json — the network the app consumes.
 *
 * IMPORTANT: This is hand-curated SEED data. Building names and the
 * bridge topology reflect the real Minneapolis Skyway system to the best
 * of our knowledge, but coordinates are approximate (placed on a model of
 * the rotated downtown street grid, accurate to roughly a block) and some
 * links are simplified. Run `npm run data:osm` on a normal network
 * connection to replace this with a real OpenStreetMap extraction.
 *
 * Downtown Minneapolis's grid is rotated relative to true north (aligned
 * with the Mississippi). We model block positions with two basis vectors
 * measured from known landmarks:
 *   - `S` = one block "south" along an avenue (e.g. 7th St -> 8th St)
 *   - `A` = one block "east" along a street  (e.g. Nicollet -> Marquette)
 * Anchor: Nicollet Mall & 7th St ~= (44.9763, -93.2715), grid (a=0, s=7).
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- Grid model -----------------------------------------------------------

const ANCHOR = { lat: 44.9763, lon: -93.2715, a: 0, s: 7 };
const SOUTH = { lat: -0.00111, lon: -0.00089 }; // one street block
const EAST = { lat: -0.00047, lon: +0.00137 }; // one avenue block

function grid(a, s) {
  return {
    lat: +(ANCHOR.lat + (s - ANCHOR.s) * SOUTH.lat + (a - ANCHOR.a) * EAST.lat).toFixed(6),
    lon: +(ANCHOR.lon + (s - ANCHOR.s) * SOUTH.lon + (a - ANCHOR.a) * EAST.lon).toFixed(6),
  };
}

/** Rotated-rectangle footprint around a center, in grid units. */
function footprint(center, aHalf, sHalf) {
  const corners = [
    [+aHalf, +sHalf],
    [+aHalf, -sHalf],
    [-aHalf, -sHalf],
    [-aHalf, +sHalf],
    [+aHalf, +sHalf],
  ];
  return corners.map(([da, ds]) => [
    +(center.lon + da * EAST.lon + ds * SOUTH.lon).toFixed(6),
    +(center.lat + da * EAST.lat + ds * SOUTH.lat).toFixed(6),
  ]);
}

// --- Hours templates -------------------------------------------------------
// hours: 7 entries, Sunday-first. Each is [openMinute, closeMinute] or null.

const H = {
  retailHub: {
    hours: [[600, 1140], [390, 1320], [390, 1320], [390, 1320], [390, 1320], [390, 1320], [480, 1320]],
    note: "Public skyway hub; long hours.",
  },
  office: {
    hours: [null, [360, 1110], [360, 1110], [360, 1110], [360, 1110], [360, 1110], null],
    note: "Office building; skyway closed weekends.",
  },
  government: {
    hours: [null, [420, 1080], [420, 1080], [420, 1080], [420, 1080], [420, 1080], null],
    note: "Government hours; closed weekends.",
  },
  hotel: {
    hours: [[360, 1320], [360, 1320], [360, 1320], [360, 1320], [360, 1320], [360, 1320], [360, 1320]],
    note: "Hotel; skyway level open daily.",
  },
  venue: {
    hours: [null, [540, 1020], [540, 1020], [540, 1020], [540, 1020], [540, 1020], null],
    note: "Venue; skyway hours vary with events.",
  },
  parking: {
    hours: [[300, 1440], [300, 1440], [300, 1440], [300, 1440], [300, 1440], [300, 1440], [300, 1440]],
    note: "Parking ramp; open early to late daily.",
  },
  hospital: {
    hours: [[300, 1320], [300, 1320], [300, 1320], [300, 1320], [300, 1320], [300, 1320], [300, 1320]],
    note: "Hospital; skyway open long hours daily.",
  },
  residential: {
    hours: [[360, 1320], [360, 1320], [360, 1320], [360, 1320], [360, 1320], [360, 1320], [360, 1320]],
    note: "Residential; resident-adjacent public corridor.",
  },
};

// --- Buildings -------------------------------------------------------------
// [id, name, address, category, a, s, {size?, latlon?}]

const BUILDINGS = [
  // West side / Hennepin & entertainment district
  ["target-field", "Target Field", "1 Twins Way", "venue", -3.4, 5.2, { latlon: [44.9817, -93.2776], size: [1.2, 0.9] }],
  ["ramp-b", "Ramp B / 5th Street Garage", "516 2nd Ave N", "parking", -3.1, 6.1, {}],
  ["target-center", "Target Center", "600 1st Ave N", "venue", -2.4, 6.4, { size: [0.8, 0.8] }],
  ["mayo-clinic-square", "Mayo Clinic Square", "600 Hennepin Ave", "retailHub", -1.5, 6.5, {}],
  ["city-center", "City Center", "33 S 6th St", "retailHub", -0.5, 6.5, { size: [0.8, 0.8] }],
  ["daytons-project", "The Dayton's Project", "700 Nicollet Mall", "retailHub", -0.5, 7.5, { size: [0.8, 0.8] }],
  ["lasalle-plaza", "LaSalle Plaza", "800 LaSalle Ave", "office", -1.2, 7.6, {}],

  // Nicollet spine
  ["ids-center", "IDS Center / Crystal Court", "80 S 8th St", "retailHub", 0.5, 7.5, { size: [0.8, 0.8] }],
  ["gaviidae-common", "Gaviidae Common", "651 Nicollet Mall", "retailHub", 0.5, 6.5, {}],
  ["rbc-plaza", "RBC Plaza / Gaviidae II", "60 S 6th St", "office", 0.5, 5.5, {}],
  ["us-bancorp-center", "U.S. Bancorp Center", "800 Nicollet Mall", "office", 0.5, 8.5, {}],
  ["medical-arts", "Medical Arts Building", "825 Nicollet Mall", "office", -0.5, 8.5, {}],
  ["target-hq", "Target Corporation HQ", "1000 Nicollet Mall", "office", -0.5, 9.7, {}],
  ["target-plaza-south", "Target Plaza South", "1001 Nicollet Mall", "office", 0.4, 9.8, {}],

  // Marquette / 2nd Ave core
  ["wells-fargo-center", "Wells Fargo Center", "90 S 7th St", "office", 1.5, 6.5, {}],
  ["baker-center", "Baker Center", "733 Marquette Ave", "office", 1.5, 7.5, {}],
  ["canadian-pacific-plaza", "Canadian Pacific Plaza", "120 S 6th St", "office", 1.5, 5.5, {}],
  ["fifth-street-towers", "Fifth Street Towers", "100 S 5th St", "office", 1.5, 4.5, {}],
  ["capella-tower", "Capella Tower", "225 S 6th St", "office", 2.5, 5.5, {}],
  ["northstar-center", "Northstar Center", "608 2nd Ave S", "office", 2.5, 6.5, {}],
  ["ameriprise", "Ameriprise Financial Center", "707 2nd Ave S", "office", 2.5, 7.5, {}],
  ["accenture-tower", "Accenture Tower", "333 S 7th St", "office", 3.5, 7.5, {}],
  ["w-foshay", "W Minneapolis – The Foshay", "821 Marquette Ave", "hotel", 1.3, 8.4, {}],
  ["campbell-mithun", "Campbell Mithun Tower", "222 S 9th St", "office", 2.0, 8.6, {}],

  // South toward the Convention Center
  ["hilton", "Hilton Minneapolis", "1001 Marquette Ave", "hotel", 1.0, 10.3, {}],
  ["orchestra-hall", "Orchestra Hall", "1111 Nicollet Mall", "venue", 0.3, 11.2, {}],
  ["convention-center", "Minneapolis Convention Center", "1301 2nd Ave S", "venue", 0.6, 12.2, { latlon: [44.9698, -93.2733], size: [1.4, 0.9] }],

  // Gateway / north end
  ["rbc-gateway", "RBC Gateway Tower", "250 Nicollet Mall", "office", 0.3, 3.3, {}],
  ["marquette-plaza", "Marquette Plaza", "250 Marquette Ave", "office", 1.5, 3.5, {}],
  ["washington-square", "100 Washington Square", "100 Washington Ave S", "office", 2.5, 3.4, {}],

  // Government / east side
  ["us-courthouse", "U.S. Courthouse", "300 S 4th St", "government", 3.5, 3.7, {}],
  ["city-hall", "Minneapolis City Hall", "350 S 5th St", "government", 3.5, 4.5, { size: [0.8, 0.8] }],
  ["gov-center", "Hennepin County Government Center", "300 S 6th St", "government", 3.5, 6.0, { size: [0.7, 1.1] }],
  ["grain-exchange", "Grain Exchange Building", "400 S 4th St", "office", 4.5, 4.3, {}],
  ["wells-fargo-de", "Wells Fargo Downtown East", "550 S 4th St", "office", 5.0, 4.5, {}],
  ["downtown-east-ramp", "Downtown East Ramp", "728 S 4th St", "parking", 6.2, 4.8, {}],
  ["us-bank-stadium", "U.S. Bank Stadium", "401 Chicago Ave", "venue", 7.6, 5.0, { latlon: [44.9738, -93.258], size: [1.6, 1.2] }],

  // Toward HCMC
  ["centre-village", "Centre Village", "1415 S 4th? — 7th St corridor", "residential", 5.0, 7.6, {}],
  ["hcmc", "Hennepin Healthcare (HCMC)", "730 S 8th St", "hospital", 6.8, 7.6, { size: [0.9, 0.9] }],
];

// --- Bridges / links -------------------------------------------------------
// [fromId, toId, crossing]

const EDGES = [
  ["target-field", "ramp-b", "6th Ave N"],
  ["ramp-b", "target-center", "5th St N"],
  ["target-center", "mayo-clinic-square", "1st Ave N"],
  ["mayo-clinic-square", "city-center", "Hennepin Ave"],
  ["city-center", "daytons-project", "7th St S"],
  ["city-center", "gaviidae-common", "Nicollet Mall"],
  ["daytons-project", "ids-center", "Nicollet Mall"],
  ["daytons-project", "lasalle-plaza", "8th St S"],
  ["daytons-project", "medical-arts", "8th St S"],
  ["lasalle-plaza", "target-hq", "9th St S"],
  ["ids-center", "gaviidae-common", "7th St S"],
  ["ids-center", "wells-fargo-center", "Marquette Ave"],
  ["ids-center", "baker-center", "Marquette Ave"],
  ["ids-center", "us-bancorp-center", "8th St S"],
  ["gaviidae-common", "rbc-plaza", "6th St S"],
  ["gaviidae-common", "wells-fargo-center", "Marquette Ave"],
  ["rbc-plaza", "canadian-pacific-plaza", "Marquette Ave"],
  ["canadian-pacific-plaza", "capella-tower", "2nd Ave S"],
  ["canadian-pacific-plaza", "fifth-street-towers", "5th St S"],
  ["canadian-pacific-plaza", "wells-fargo-center", "6th St S"],
  ["capella-tower", "northstar-center", "6th St S"],
  ["wells-fargo-center", "northstar-center", "2nd Ave S"],
  ["northstar-center", "ameriprise", "7th St S"],
  ["baker-center", "ameriprise", "2nd Ave S"],
  ["baker-center", "w-foshay", "8th St S"],
  ["us-bancorp-center", "medical-arts", "Nicollet Mall"],
  ["us-bancorp-center", "w-foshay", "Marquette Ave"],
  ["w-foshay", "campbell-mithun", "2nd Ave S"],
  ["us-bancorp-center", "target-plaza-south", "9th St S"],
  ["target-hq", "target-plaza-south", "Nicollet Mall"],
  ["target-plaza-south", "hilton", "Marquette Ave"],
  ["hilton", "orchestra-hall", "Marquette Ave"],
  ["hilton", "convention-center", "Grant St (via plaza)"],
  ["fifth-street-towers", "marquette-plaza", "4th St S"],
  ["marquette-plaza", "washington-square", "2nd Ave S"],
  ["rbc-gateway", "marquette-plaza", "Marquette Ave"],
  ["washington-square", "us-courthouse", "3rd Ave S"],
  ["us-courthouse", "city-hall", "4th St S"],
  ["city-hall", "gov-center", "5th St S"],
  ["gov-center", "capella-tower", "3rd Ave S"],
  ["gov-center", "accenture-tower", "7th St S"],
  ["ameriprise", "accenture-tower", "3rd Ave S"],
  ["city-hall", "grain-exchange", "4th Ave S"],
  ["grain-exchange", "wells-fargo-de", "5th Ave S"],
  ["wells-fargo-de", "downtown-east-ramp", "Park Ave"],
  ["downtown-east-ramp", "us-bank-stadium", "Chicago Ave"],
  ["accenture-tower", "centre-village", "5th Ave S (corridor)"],
  ["centre-village", "hcmc", "Park Ave"],
];

// --- Build output ----------------------------------------------------------

const buildings = BUILDINGS.map(([id, name, address, category, a, s, opts]) => {
  const center = opts.latlon ? { lat: opts.latlon[0], lon: opts.latlon[1] } : grid(a, s);
  const [aHalf, sHalf] = (opts.size ?? [0.62, 0.62]).map((x) => x / 2);
  return {
    id,
    name,
    address,
    category,
    lat: center.lat,
    lon: center.lon,
    footprint: footprint(center, aHalf, sHalf),
    hours: H[category].hours,
    hoursNote: H[category].note,
  };
});

const ids = new Set(buildings.map((b) => b.id));
for (const [from, to] of EDGES) {
  if (!ids.has(from) || !ids.has(to)) {
    throw new Error(`Edge references unknown building: ${from} -> ${to}`);
  }
}

const data = {
  meta: {
    name: "Minneapolis Skyway (seed)",
    source: "hand-curated",
    disclaimer:
      "Approximate seed data: real building names and topology, block-level coordinate accuracy, simplified links and representative hours. Replace with `npm run data:osm`.",
    generated: new Date().toISOString(),
  },
  buildings,
  edges: EDGES.map(([from, to, crossing]) => ({ from, to, crossing })),
};

const out = join(ROOT, "public", "data", "skymap-data.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(data));
console.log(`Wrote ${out}: ${buildings.length} buildings, ${EDGES.length} bridges.`);
