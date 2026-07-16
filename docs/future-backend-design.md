# Future backend design — multi-user incident sync

**Status: design only. Nothing here is provisioned.** Standing up a real
Postgres/Supabase backend means a new cloud account, billing, and an
ongoing hosting cost — a decision for Joey to make deliberately, not
something to spin up unilaterally during an overnight run. This document
exists so that decision is easy to make later: the design is ready, sized
against our actual data, and translatable from the client-only version
shipped tonight (`src/incidents.ts`) without a rewrite.

## Why client-only is the right call today

Skymap's core value — routing, hours-awareness, accessibility — needs
zero backend and works 100% offline once the service worker has cached
the data once. A backend only becomes necessary for exactly one thing:
**incident reports syncing across devices** (person A reports a locked
door, person B sees it live). Everything else in the mandated spec that
sounded backend-shaped (temporal routing, offline caching) is already
solved client-side, for free, with no server to run or pay for.

So: build this when incident reports are common enough that "only my own
phone sees my own reports" (tonight's `src/incidents.ts`) actually
matters. Not before.

## Schema (PostgreSQL + PostGIS)

Sized against what `scripts/fetch-osm.mjs` already produces — this is a
direct relational mapping of `src/types.ts`, not a generic textbook
schema.

```sql
create extension if not exists postgis;

create table buildings (
  id text primary key,              -- matches our slugified OSM id, e.g. "ids-center-1385236413"
  name text not null,
  address text not null,
  category text not null,           -- office | retailHub | hotel | parking | ...
  location geography(point, 4326) not null,
  footprint geography(polygon, 4326) not null,
  hours jsonb not null,              -- [ [openMin,closeMin]|null, ... ] x7, Sunday-first — same shape as today
  hours_note text,
  image jsonb,                       -- { url, attribution, sourceUrl } | null
  updated_at timestamptz not null default now()
);
create index buildings_location_idx on buildings using gist (location);

create table edges (
  id bigserial primary key,
  from_building text not null references buildings(id),
  to_building text not null references buildings(id),
  crossing text not null,
  geometry geography(linestring, 4326),
  has_steps boolean not null default false,
  unique (from_building, to_building)
);

create table pois (
  id text primary key,               -- "poi-<osm-node-id>"
  building_id text not null references buildings(id),
  name text not null,
  category text not null,
  kind text not null,
  poi_group text not null,           -- food | shop | service | restroom | elevator | landmark | transit
  location geography(point, 4326) not null,
  exterior boolean not null default false,
  level text,
  opening_hours text
);

-- The only table that actually needs to exist for the reason we'd add a backend at all.
create table incidents (
  id bigserial primary key,
  edge_id bigint not null references edges(id),
  reported_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '4 hours'),
  reporter_device text                -- pseudonymous client id, not a user account — no auth needed for v1
);
create index incidents_active_idx on incidents (edge_id) where expires_at > now();
```

Notes:
- `hours` stays JSONB matching our existing per-building array, not a
  separate `schedules` table with a `schedule_id` foreign key — our
  hours model has never needed more than one schedule per building, and
  splitting it out would be speculative complexity with no current use
  case. Add a real `schedules` table only when a building actually needs
  multiple named schedules (e.g. holiday hours) — not before.
- `edges` gets a real `id` here (our client-side graph doesn't need one,
  since it's rebuilt fresh from the JSON each load) — incidents need a
  stable foreign key to reference.

## Real-time incident sync (Supabase)

Supabase's realtime is just Postgres logical replication over
`postgres_changes` — no custom trigger/Edge Function needed for the
basic case:

```sql
-- Enable realtime on the incidents table (Supabase dashboard or SQL):
alter publication supabase_realtime add table incidents;
```

Client subscribes:

```ts
supabase
  .channel("incidents")
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "incidents" }, (payload) => {
    // same shape as src/incidents.ts's activeClosedEdges() — router.route()
    // already accepts { closedEdges: Set<string> }, so this just needs to
    // feed that same option. No router changes needed.
  })
  .subscribe();
```

An Edge Function is only needed if reports should be validated/rate-limited
before insert (e.g. reject if the same device reported >5 times in an
hour) — worth adding once abuse is an actual observed problem, not
speculatively now.

## Migration path from tonight's client-only version

`src/incidents.ts`'s public functions (`reportClosedCrossing`,
`activeClosedEdges`) are already the exact shape a Supabase-backed version
would need — swap the `localStorage`-backed `KeyValueStore` calls for a
Supabase insert + realtime subscription, and `router.ts`,
`main.ts`, and every test that exercises `{ closedEdges }` need zero
changes. That interface boundary was chosen deliberately for this reason.
