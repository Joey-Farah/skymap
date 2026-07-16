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
import { buildingCategory, groupFor } from "../src/poi.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");

const BBOX = "44.9660,-93.2950,44.9865,-93.2510"; // downtown Minneapolis
// overpass-api.de returns 406 without a User-Agent; mirrors are fallbacks
// for when the primary is overloaded (504).
const USER_AGENT = "skymap-data-pipeline/0.1 (Minneapolis skyway map)";
const MIRRORS = process.env.OVERPASS_URL
  ? [process.env.OVERPASS_URL]
  : [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
    ];

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
node["amenity"~"^(cafe|restaurant|fast_food|bar|pub|ice_cream|bank|pharmacy|clinic|dentist|post_office|theatre|cinema|library|townhall|courthouse|place_of_worship)$"]["name"](${BBOX});
out body;
node["shop"]["name"](${BBOX});
out body;
node["leisure"~"^(fitness_centre|bowling_alley)$"]["name"](${BBOX});
out body;
node["amenity"="toilets"](${BBOX});
out body;
node["tourism"~"^(attraction|museum|artwork|gallery|viewpoint)$"]["name"](${BBOX});
out body;
node["highway"="bus_stop"]["name"](${BBOX});
out body;
node["railway"~"^(station|tram_stop)$"]["name"](${BBOX});
out body;
node["highway"="elevator"](${BBOX});
out body;
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
  let lastErr;
  for (const url of MIRRORS) {
    console.log(`Querying Overpass (${url})…`);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        body: "data=" + encodeURIComponent(QUERY),
      });
      if (res.ok) return res.json();
      lastErr = new Error(`Overpass returned HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    console.warn(`  ${lastErr.message} — trying next mirror.`);
  }
  throw lastErr;
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

/**
 * Landmark photos for buildings whose OSM way carries a wikidata tag —
 * only well-known buildings get one, but it's real, freely-licensed
 * imagery with proper attribution (vs. no images at all).
 */
async function fetchLandmarkImages(wikidataByBuildingId) {
  const ids = [...wikidataByBuildingId.values()];
  if (ids.length === 0) return new Map();
  const headers = { "User-Agent": USER_AGENT };

  const filenameByQid = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const res = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join("|")}&props=claims&format=json`,
      { headers },
    );
    if (!res.ok) continue;
    const data = await res.json();
    for (const [qid, entity] of Object.entries(data.entities ?? {})) {
      const file = entity.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (file) filenameByQid.set(qid, file);
    }
  }
  if (filenameByQid.size === 0) return new Map();

  const attributionByFile = new Map();
  const filenames = [...filenameByQid.values()];
  for (let i = 0; i < filenames.length; i += 50) {
    const batch = filenames.slice(i, i + 50).map((f) => `File:${f}`);
    const res = await fetch(
      `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(batch.join("|"))}&prop=imageinfo&iiprop=extmetadata&format=json`,
      { headers },
    );
    if (!res.ok) continue;
    const data = await res.json();
    for (const page of Object.values(data.query?.pages ?? {})) {
      const meta = page.imageinfo?.[0]?.extmetadata;
      if (!meta) continue;
      const artist = (meta.Artist?.value ?? "").replace(/<[^>]+>/g, "").trim() || "Unknown";
      const license = meta.LicenseShortName?.value ?? "";
      attributionByFile.set(page.title.replace(/^File:/, ""), `${artist}${license ? ` · ${license}` : ""}`);
    }
  }

  const imageByBuildingId = new Map();
  for (const [buildingId, qid] of wikidataByBuildingId) {
    const file = filenameByQid.get(qid);
    if (!file) continue;
    const attribution = attributionByFile.get(file);
    if (!attribution) continue; // no metadata = can't attribute = don't show it
    imageByBuildingId.set(buildingId, {
      url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=640`,
      attribution,
      sourceUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`,
    });
  }
  return imageByBuildingId;
}

async function main(osm) {
  const nodes = new Map(); // id -> {lat, lon}
  const ways = [];
  const buildingsRaw = [];
  const poiNodes = [];

  const transitNodes = [];
  for (const el of osm.elements) {
    if (el.type === "node") {
      nodes.set(el.id, { lat: el.lat, lon: el.lon });
      const t = el.tags ?? {};
      if (t.highway === "bus_stop" || t.railway === "station" || t.railway === "tram_stop") {
        if (t.name) transitNodes.push(el);
      } else if (
        t.amenity === "toilets" ||
        t.highway === "elevator" ||
        (t.name && (t.amenity || t.shop || t.leisure || t.tourism))
      ) {
        poiNodes.push(el);
      }
    } else if (el.type === "way" && el.tags?.building && el.tags?.name) buildingsRaw.push(el);
    else if (el.type === "way" && el.tags?.highway) ways.push(el);
  }
  console.log(
    `OSM: ${ways.length} skyway ways, ${buildingsRaw.length} named buildings, ${poiNodes.length} POI nodes.`,
  );

  // Building records with footprints.
  const wikidataByBuildingId = new Map();
  const buildings = buildingsRaw
    .map((w) => {
      const ring = w.nodes.map((id) => nodes.get(id)).filter(Boolean);
      if (ring.length < 3) return null;
      const fp = ring.map((n) => [+n.lon.toFixed(6), +n.lat.toFixed(6)]);
      const c = centroid(fp);
      const id = `${slugify(w.tags.name)}-${w.id}`;
      if (w.tags.wikidata) wikidataByBuildingId.set(id, w.tags.wikidata);
      return {
        id,
        name: w.tags.name,
        address: [w.tags["addr:housenumber"], w.tags["addr:street"]].filter(Boolean).join(" ") || "Minneapolis",
        category: buildingCategory(w.tags),
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
            ...(w.tags?.highway === "steps" ? { hasSteps: true } : {}),
          });
        }
        pending = [pending[pending.length - 1]];
      }
      if (b) prevBuilding = b;
    }
  }

  // Keep only the largest connected component: the contiguous skyway.
  // Smaller fragments are mostly unrelated indoor corridors (hospitals,
  // apartment blocks) that would pollute the picker and never route.
  const adj = new Map();
  for (const e of edgeMap.values()) {
    (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)).push(e.to);
    (adj.get(e.to) ?? adj.set(e.to, []).get(e.to)).push(e.from);
  }
  const seen = new Set();
  let mainComponent = new Set();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const comp = new Set();
    const stack = [start];
    while (stack.length) {
      const id = stack.pop();
      if (comp.has(id)) continue;
      comp.add(id);
      seen.add(id);
      stack.push(...adj.get(id));
    }
    if (comp.size > mainComponent.size) mainComponent = comp;
  }
  console.log(`Components: keeping largest (${mainComponent.size} of ${seen.size} connected buildings).`);
  const finalBuildings = buildings.filter((b) => mainComponent.has(b.id));
  const finalEdges = [...edgeMap.values()].filter(
    (e) => mainComponent.has(e.from) && mainComponent.has(e.to),
  );

  const relevantWikidata = new Map(
    [...wikidataByBuildingId].filter(([id]) => mainComponent.has(id)),
  );
  console.log(`Fetching landmark photos for ${relevantWikidata.size} tagged buildings…`);
  const imageByBuildingId = await fetchLandmarkImages(relevantWikidata);
  for (const b of finalBuildings) {
    const image = imageByBuildingId.get(b.id);
    if (image) b.image = image;
  }
  console.log(`Landmark photos attached: ${imageByBuildingId.size}.`);

  // Businesses/features inside network buildings (point-in-polygon).
  const pois = [];
  for (const n of poiNodes) {
    const host = finalBuildings.find((b) => pointInRing(n.lon, n.lat, b.footprint));
    if (!host) continue;
    const kind = n.tags.highway === "elevator" ? "elevator" : n.tags.amenity ? "amenity" : n.tags.shop ? "shop" : n.tags.tourism ? "tourism" : "leisure";
    const category = n.tags.highway === "elevator" ? "elevator" : (n.tags.amenity ?? n.tags.shop ?? n.tags.tourism ?? n.tags.leisure);
    pois.push({
      id: `poi-${n.id}`,
      name: n.tags.name ?? (category === "toilets" ? "Public restroom" : category === "elevator" ? "Elevator" : category),
      category,
      kind,
      group: groupFor(kind, category),
      lat: +n.lat.toFixed(6),
      lon: +n.lon.toFixed(6),
      buildingId: host.id,
      ...(n.tags.level ? { level: n.tags.level } : {}),
      ...(n.tags.opening_hours ? { openingHours: n.tags.opening_hours } : {}),
    });
  }

  // Transit stops: street-level, attached to the nearest network building
  // within 120 m; deduped by name (route variants share a pole).
  const seenStops = new Set();
  for (const n of transitNodes) {
    if (seenStops.has(n.tags.name)) continue;
    let host = null;
    let best = 120;
    for (const b of finalBuildings) {
      const d = haversine(n.lat, n.lon, b.lat, b.lon);
      if (d < best) {
        best = d;
        host = b;
      }
    }
    if (!host) continue;
    seenStops.add(n.tags.name);
    pois.push({
      id: `poi-${n.id}`,
      name: n.tags.name,
      category: n.tags.railway ?? "bus_stop",
      kind: "transit",
      group: "transit",
      lat: +n.lat.toFixed(6),
      lon: +n.lon.toFixed(6),
      buildingId: host.id,
      exterior: true,
    });
  }
  console.log(
    `POIs: ${pois.filter((p) => !p.exterior).length} inside the network, ${pois.filter((p) => p.exterior).length} transit stops nearby.`,
  );

  const data = {
    meta: {
      name: "Minneapolis Skyway (OSM extraction)",
      source: "OpenStreetMap via Overpass API — © OpenStreetMap contributors, ODbL",
      disclaimer:
        "Map data © OpenStreetMap contributors. Hours are typical skyway schedules — verify with each building.",
      generated: new Date().toISOString(),
    },
    buildings: finalBuildings,
    edges: finalEdges,
    pois,
  };

  const outPath = join(
    ROOT,
    "public",
    "data",
    APPLY ? "skymap-data.json" : "skymap-data.osm.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(data, null, 1));
  console.log(`Wrote ${outPath}: ${finalBuildings.length} buildings, ${finalEdges.length} links.`);
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
