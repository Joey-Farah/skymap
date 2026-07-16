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

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
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
relation["building"]["name"](${BBOX});
out body;
>;
out skel qt;
node["amenity"~"^(cafe|restaurant|fast_food|bar|pub|ice_cream|bank|pharmacy|clinic|dentist|post_office|theatre|cinema|library|townhall|courthouse|place_of_worship)$"]["name"](${BBOX});
out body;
node["shop"]["name"](${BBOX});
out body;
node["leisure"~"^(fitness_centre|bowling_alley|sports_centre)$"]["name"](${BBOX});
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
      if (res.ok) {
        const osm = await res.json();
        // Mirrors can lag the main database by weeks; a stale snapshot
        // silently loses recently mapped buildings and bridges (a fallback
        // mirror once served 2-week-old data, dropping Mill City Museum).
        const base = osm.osm3s?.timestamp_osm_base;
        const ageDays = base ? (Date.now() - Date.parse(base)) / 86400000 : null;
        console.log(`  Data timestamp: ${base ?? "unknown"} (${ageDays?.toFixed(1) ?? "?"} days old).`);
        if (ageDays !== null && ageDays > 7) {
          console.warn(`  WARNING: mirror data is ${ageDays.toFixed(0)} days stale — trying next mirror.`);
          lastErr = new Error(`stale data from ${url}`);
          continue;
        }
        return osm;
      }
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

/**
 * Business logos, downloaded once per domain at build time so the app stays
 * offline-capable and makes zero third-party requests at runtime. POIs with
 * only a brand:wikidata tag (chains) get their official website resolved via
 * Wikidata P856 first. Misses fall back to a monogram chip in the UI, so a
 * failed download only costs polish, never correctness.
 */
async function attachLogos(pois) {
  const { logoKey } = await import("../src/logo.ts");

  // Resolve brand-only POIs (no website tag) through Wikidata P856.
  const brandOnly = pois.filter((p) => !p.website && p.brandWikidata);
  const qids = [...new Set(brandOnly.map((p) => p.brandWikidata))];
  const siteByQid = new Map();
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50);
    try {
      const res = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join("|")}&props=claims&format=json`,
        { headers: { "User-Agent": USER_AGENT } },
      );
      if (!res.ok) continue;
      const json = await res.json();
      for (const [qid, entity] of Object.entries(json.entities ?? {})) {
        const url = entity.claims?.P856?.[0]?.mainsnak?.datavalue?.value;
        if (url) siteByQid.set(qid, url);
      }
    } catch {
      // Logos are decoration; never fail the pipeline over them.
    }
  }
  for (const p of brandOnly) {
    const site = siteByQid.get(p.brandWikidata);
    if (site) p.website = site;
  }
  for (const p of pois) delete p.brandWikidata;

  const logosDir = join(ROOT, "public", "logos");
  mkdirSync(logosDir, { recursive: true });
  const domains = new Map(); // key -> website (first seen)
  for (const p of pois) {
    const key = logoKey(p.website);
    if (key && !domains.has(key)) domains.set(key, p.website);
  }

  const available = new Set();
  const entries = [...domains.keys()];
  const CONCURRENCY = 8;
  let downloaded = 0;
  async function fetchOne(key) {
    const path = join(logosDir, `${key}.png`);
    if (existsSync(path)) {
      available.add(key);
      return;
    }
    const domain = new URL(domains.get(key)).hostname;
    try {
      const res = await fetch(
        `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=64`,
      );
      if (!res.ok) return; // 404 = no favicon known; monogram fallback covers it
      const bytes = Buffer.from(await res.arrayBuffer());
      // Platform-default favicons (e.g. the stock WordPress "W") say nothing
      // about the business — the colored monogram is strictly better.
      const { createHash } = await import("node:crypto");
      const GENERIC_FAVICONS = new Set([
        "ebb03167d411fd593893b2f93ff5d179", // WordPress default
      ]);
      if (GENERIC_FAVICONS.has(createHash("md5").update(bytes).digest("hex"))) return;
      writeFileSync(path, bytes);
      available.add(key);
      downloaded++;
    } catch {
      // Same: decoration only.
    }
  }
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    await Promise.all(entries.slice(i, i + CONCURRENCY).map(fetchOne));
  }

  let attached = 0;
  for (const p of pois) {
    const key = logoKey(p.website);
    if (key && available.has(key)) {
      p.logo = key;
      attached++;
    }
  }
  console.log(
    `Logos: ${attached} POIs across ${available.size} domains (${downloaded} newly downloaded).`,
  );
}

/**
 * Stitch a multipolygon relation's outer way segments into one closed ring
 * of node ids. Buildings mapped as relations (the Central Library became
 * one in July 2026, silently vanishing from our extraction) usually split
 * their outline across several member ways that share endpoints.
 */
function stitchOuterRing(segments) {
  // Stitch every closed ring the segments form, then keep the largest —
  // multi-outer relations (a complex mapped as several detached footprints)
  // at least keep their dominant building. Unclosed leftovers are rejected:
  // an open ring fed to pointInRing gets implicitly closed by a chord and
  // quietly assigns POIs to the wrong building.
  const segs = segments.map((s) => [...s]);
  const rings = [];
  while (segs.length) {
    const ring = segs.shift();
    while (segs.length && ring[0] !== ring[ring.length - 1]) {
      const end = ring[ring.length - 1];
      const i = segs.findIndex((s) => s[0] === end || s[s.length - 1] === end);
      if (i === -1) break;
      const [next] = segs.splice(i, 1);
      if (next[0] === end) ring.push(...next.slice(1));
      else ring.push(...next.reverse().slice(1));
    }
    if (ring.length >= 4 && ring[0] === ring[ring.length - 1]) rings.push(ring);
  }
  if (!rings.length) return null;
  rings.sort((a, b) => b.length - a.length);
  return rings[0];
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
  // SKYMAP_DUMP_RAW=/path.json caches the raw Overpass response so pipeline
  // logic can be debugged offline without hammering the (flaky) API.
  if (process.env.SKYMAP_DUMP_RAW) writeFileSync(process.env.SKYMAP_DUMP_RAW, JSON.stringify(osm));
  const nodes = new Map(); // id -> {lat, lon}
  const ways = [];
  const buildingsRaw = [];
  const poiNodes = [];
  const waysById = new Map(); // every way, tagged or skeleton — relation members resolve here
  const relationsRaw = [];

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
    } else if (el.type === "way") {
      waysById.set(el.id, el);
      if (el.tags?.building && el.tags?.name) buildingsRaw.push(el);
      else if (el.tags?.highway) ways.push(el);
    } else if (el.type === "relation" && el.tags?.building && el.tags?.name) relationsRaw.push(el);
  }

  // Buildings mapped as multipolygon relations: stitch outer members into a
  // way-shaped record so the rest of the pipeline treats them identically.
  let relationBuildings = 0;
  for (const r of relationsRaw) {
    const outers = (r.members ?? [])
      .filter((m) => m.type === "way" && (m.role === "outer" || !m.role))
      .map((m) => waysById.get(m.ref)?.nodes)
      .filter(Boolean);
    const ring = stitchOuterRing(outers);
    if (!ring) continue;
    buildingsRaw.push({ id: `r${r.id}`, nodes: ring, tags: r.tags });
    relationBuildings++;
  }
  if (relationBuildings) console.log(`Building relations stitched: ${relationBuildings}.`);
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

  // Building-to-building connectivity has to follow the full pedestrian
  // node graph, not stop at each OSM way's boundary: a single real skyway
  // bridge is routinely mapped as several way segments joined at shared
  // nodes (one per contributor, or split at each street crossing), and a
  // per-way walk that resets its "current building" at every way boundary
  // misses any connection spanning more than one segment — which silently
  // dropped real, walkable bridges (found via Target Center: OSM has a
  // complete, named, indoor-tagged "Minneapolis Skyway" chain from LaSalle
  // Plaza all the way there, split across ~10 way segments that share
  // endpoint nodes; the old per-way logic produced zero edges from it).
  const coordOf = (nodeId) => {
    const n = nodes.get(nodeId);
    return [+n.lon.toFixed(6), +n.lat.toFixed(6)];
  };
  const nodeGraph = new Map(); // nodeId -> [{to, wayTags}]
  const addNodeEdge = (a, b, wayTags) => {
    if (!nodeGraph.has(a)) nodeGraph.set(a, []);
    nodeGraph.get(a).push({ to: b, wayTags });
  };
  for (const w of ways) {
    for (let i = 1; i < w.nodes.length; i++) {
      const a = w.nodes[i - 1];
      const b = w.nodes[i];
      if (!nodes.has(a) || !nodes.has(b)) continue;
      addNodeEdge(a, b, w.tags);
      addNodeEdge(b, a, w.tags);
    }
  }

  const nodesByBuilding = new Map(); // buildingId -> Set(nodeId)
  for (const nodeId of nodeGraph.keys()) {
    const b = buildingFor(nodeId);
    if (!b) continue;
    if (!nodesByBuilding.has(b.id)) nodesByBuilding.set(b.id, new Set());
    nodesByBuilding.get(b.id).add(nodeId);
  }

  // Sanity cap: real building-to-building skyway hops are short. Without
  // this, a long unrelated ground-level footway with no building nearby
  // could in principle bridge two buildings that aren't actually connected.
  const MAX_BRIDGE_METERS = 500;
  const edgeMap = new Map(); // "a|b" -> {from,to,geometry,crossing,hasSteps}
  for (const [buildingId, anchorNodes] of nodesByBuilding) {
    const visited = new Set(anchorNodes);
    const queue = [...anchorNodes].map((id) => ({
      id,
      dist: 0,
      geom: [coordOf(id)],
      hasSteps: false,
      crossingName: null,
    }));
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      for (const edge of nodeGraph.get(cur.id) ?? []) {
        if (visited.has(edge.to)) continue;
        const toCoord = coordOf(edge.to);
        const hopDist = haversine(coordOf(cur.id)[1], coordOf(cur.id)[0], toCoord[1], toCoord[0]);
        const newDist = cur.dist + hopDist;
        if (newDist > MAX_BRIDGE_METERS) continue;
        const hopHasSteps = edge.wayTags?.highway === "steps";
        const hopName =
          edge.wayTags?.name && !/^(minneapolis )?skyway$/i.test(edge.wayTags.name) ? edge.wayTags.name : null;
        const otherBuilding = buildingFor(edge.to);
        const newGeom = [...cur.geom, toCoord];
        const newHasSteps = cur.hasSteps || hopHasSteps;
        const newCrossingName = cur.crossingName ?? hopName;
        if (otherBuilding && otherBuilding.id !== buildingId) {
          const key = [buildingId, otherBuilding.id].sort().join("|");
          if (!edgeMap.has(key)) {
            edgeMap.set(key, {
              from: buildingId,
              to: otherBuilding.id,
              crossing: newCrossingName ?? edge.wayTags?.name ?? "skyway",
              geometry: newGeom,
              ...(newHasSteps ? { hasSteps: true } : {}),
            });
          }
          visited.add(edge.to);
          continue;
        }
        visited.add(edge.to);
        queue.push({ id: edge.to, dist: newDist, geom: newGeom, hasSteps: newHasSteps, crossingName: newCrossingName });
      }
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
  const components = [];
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
    components.push(comp);
  }
  components.sort((a, b) => b.size - a.size);

  // Keep every real skyway cluster, not just the single largest. Even a
  // 2-building cluster can be a real destination + its ramp (the Guthrie
  // Theater is exactly this); dropping small components made real,
  // searchable buildings silently vanish, which is far worse than a few
  // niche pairs appearing in search. Cross-cluster routes correctly report
  // no connection. Only singletons (a building with no skyway edge at all)
  // are excluded, via the component walk itself.
  const MIN_COMPONENT_SIZE = 2;
  const mainComponent = new Set();
  let keptComponents = 0;
  for (const comp of components) {
    if (comp.size < MIN_COMPONENT_SIZE) continue;
    keptComponents++;
    for (const id of comp) mainComponent.add(id);
  }
  console.log(
    `Components: keeping ${keptComponents} of ${components.length} (${mainComponent.size} of ${seen.size} connected buildings, min size ${MIN_COMPONENT_SIZE}).`,
  );
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
      ...(n.tags.website || n.tags["contact:website"]
        ? { website: n.tags.website ?? n.tags["contact:website"] }
        : {}),
      ...(n.tags["brand:wikidata"] ? { brandWikidata: n.tags["brand:wikidata"] } : {}),
    });
  }
  await attachLogos(pois);

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

// SKYMAP_RAW_IN=/path.json replays a cached Overpass response (see
// SKYMAP_DUMP_RAW) so pipeline logic can iterate without the flaky API.
const source = process.env.SKYMAP_RAW_IN
  ? import("node:fs").then((fs) => JSON.parse(fs.readFileSync(process.env.SKYMAP_RAW_IN, "utf8")))
  : fetchOverpass();
source
  .then(main)
  .catch((err) => {
    console.error(`OSM extraction failed: ${err.message}`);
    console.error("If the network blocks Overpass, run this script from a normal connection,");
    console.error("or set OVERPASS_URL to a reachable mirror.");
    process.exit(1);
  });
