#!/usr/bin/env node
/**
 * Skymap OSM extraction pipeline.
 *
 * Pulls the real Minneapolis skyway network from OpenStreetMap via the
 * Overpass API and converts it into the app's data schema
 * (public/data/skymap-data.json). Run this on a machine with open internet
 * access — some sandboxed environments block overpass-api.de.
 *
 *   npm run data:osm             # writes public/data/skymap-data.osm.json
 *   npm run data:osm -- --apply  # overwrites public/data/skymap-data.json
 *
 * Method:
 *   1. Fetch skyway-ish footways (footway/corridor ways that are bridges,
 *      elevated, covered, or indoor) in the downtown bounding box, plus all
 *      named building polygons there.
 *   2. Build a node graph from the ways (shared OSM node ids join ways).
 *   3. Assign each graph node to a building (point-in-polygon, else nearest
 *      centroid within 80 m).
 *   4. Collapse the node graph into a building-to-building graph, keeping
 *      real polyline geometry for each collapsed connection.
 *
 * Hours: OSM rarely has reliable skyway hours, so extracted buildings get
 * the standard historical skyway schedule (Mon–Fri 6:30am–10pm, Sat
 * 9:30am–8pm, Sun noon–6pm) flagged as unverified. Curated hours can be
 * merged from the seed dataset by matching names.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");

const BBOX = "44.9660,-93.2950,44.9865,-93.2510"; // downtown Minneapolis
const OVERPASS = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";

const QUERY = `
[out:json][timeout:90];
(
  way["highway"~"footway|corridor|steps"]["layer"~"^[1-9]"](${BBOX});
  way["highway"~"footway|corridor|steps"]["bridge"="yes"](${BBOX});
  way["highway"~"footway|corridor|steps"]["covered"="yes"](${BBOX});
  way["highway"~"footway|corridor|steps"]["indoor"="yes"](${BBOX});
  way["highway"="corridor"](${BBOX});
);
out body;
>;
out skel qt;
way["building"]["name"](${BBOX});
out body;
>;
out skel qt;
`;

const DEFAULT_HOURS = [
  [720, 1080],
  [390, 1320],
  [390, 1320],
  [390, 1320],
  [390, 1320],
  [390, 1320],
  [570, 1200],
];

async function fetchOverpass() {
  console.log(`Querying Overpass (${OVERPASS})…`);
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(QUERY),
  });
  if (!res.ok) throw new Error(`Overpass returned HTTP ${res.status}`);
  return res.json();
}

function centroid(ring) {
  let lat = 0;
  let lon = 0;
  for (const [x, y] of ring) {
    lon += x;
    lat += y;
  }
  return { lat: lat / ring.length, lon: lon / ring.length };
}

function haversine(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function main(osm) {
  const nodes = new Map(); // id -> {lat, lon}
  const ways = [];
  const buildingsRaw = [];

  for (const el of osm.elements) {
    if (el.type === "node") nodes.set(el.id, { lat: el.lat, lon: el.lon });
    else if (el.type === "way" && el.tags?.building && el.tags?.name) buildingsRaw.push(el);
    else if (el.type === "way" && el.tags?.highway) ways.push(el);
  }
  console.log(`OSM: ${ways.length} skyway ways, ${buildingsRaw.length} named buildings.`);

  // Building records with footprints.
  const buildings = buildingsRaw
    .map((w) => {
      const ring = w.nodes.map((id) => nodes.get(id)).filter(Boolean);
      if (ring.length < 3) return null;
      const fp = ring.map((n) => [+n.lon.toFixed(6), +n.lat.toFixed(6)]);
      const c = centroid(fp);
      return {
        id: `${slugify(w.tags.name)}-${w.id}`,
        name: w.tags.name,
        address: [w.tags["addr:housenumber"], w.tags["addr:street"]].filter(Boolean).join(" ") || "Minneapolis",
        category: "office",
        lat: +c.lat.toFixed(6),
        lon: +c.lon.toFixed(6),
        footprint: fp,
        hours: DEFAULT_HOURS,
        hoursNote: "Default skyway hours — unverified, from OSM extraction.",
      };
    })
    .filter(Boolean);

  // Assign each way node to a building.
  const nodeBuilding = new Map();
  function buildingFor(nodeId) {
    if (nodeBuilding.has(nodeId)) return nodeBuilding.get(nodeId);
    const n = nodes.get(nodeId);
    let found = null;
    if (n) {
      found = buildings.find((b) => pointInRing(n.lon, n.lat, b.footprint)) ?? null;
      if (!found) {
        let best = 80; // meters
        for (const b of buildings) {
          const d = haversine(n.lat, n.lon, b.lat, b.lon);
          if (d < best) {
            best = d;
            found = b;
          }
        }
      }
    }
    nodeBuilding.set(nodeId, found);
    return found;
  }

  // Walk each way, emitting an edge whenever consecutive nodes belong to
  // different buildings; accumulate geometry between them.
  const edgeMap = new Map(); // "a|b" -> {from,to,geometry}
  for (const w of ways) {
    let prevBuilding = null;
    let pending = [];
    for (const nodeId of w.nodes) {
      const n = nodes.get(nodeId);
      if (!n) continue;
      const b = buildingFor(nodeId);
      pending.push([+n.lon.toFixed(6), +n.lat.toFixed(6)]);
      if (b && prevBuilding && b.id !== prevBuilding.id) {
        const key = [prevBuilding.id, b.id].sort().join("|");
        if (!edgeMap.has(key)) {
          edgeMap.set(key, {
            from: prevBuilding.id,
            to: b.id,
            crossing: w.tags?.name || "skyway",
            geometry: pending,
          });
        }
        pending = [pending[pending.length - 1]];
      }
      if (b) prevBuilding = b;
    }
  }

  // Keep only buildings that participate in the network.
  const connected = new Set();
  for (const e of edgeMap.values()) {
    connected.add(e.from);
    connected.add(e.to);
  }
  const finalBuildings = buildings.filter((b) => connected.has(b.id));

  const data = {
    meta: {
      name: "Minneapolis Skyway (OSM extraction)",
      source: "OpenStreetMap via Overpass API — © OpenStreetMap contributors, ODbL",
      disclaimer:
        "Geometry from OSM. Hours are defaults and must be verified per building. Review before shipping.",
      generated: new Date().toISOString(),
    },
    buildings: finalBuildings,
    edges: [...edgeMap.values()],
  };

  const outPath = join(
    ROOT,
    "public",
    "data",
    APPLY ? "skymap-data.json" : "skymap-data.osm.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(data, null, 1));
  console.log(`Wrote ${outPath}: ${finalBuildings.length} buildings, ${edgeMap.size} links.`);
  if (!APPLY) console.log("Review the output, then re-run with --apply to make it live.");
}

fetchOverpass()
  .then(main)
  .catch((err) => {
    console.error(`OSM extraction failed: ${err.message}`);
    console.error("If the network blocks Overpass, run this script from a normal connection,");
    console.error("or set OVERPASS_URL to a reachable mirror.");
    process.exit(1);
  });
