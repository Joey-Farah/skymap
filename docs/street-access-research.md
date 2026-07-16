# Street access (ingress/egress) — research finding

**Status: not buildable from OSM alone, evidence below. Not implemented.**

Requested: clear routing transitions from street level up to the skyway
and back down (the mandated spec's "Ingress/Egress Mapping"). Investigated
twice now (once in an earlier session, once during the 2026-07-16
overnight run) — both times conclude OSM's Minneapolis downtown coverage
doesn't have this data in a form we can auto-derive.

## What was checked

**`entrance=*` nodes** in the downtown bbox: only **20** across 113+
network buildings. Most lack a `level` tag entirely; the few that have one
use inconsistent values, not a clean "0 = street, 1 = skyway" split.

**`door=*` nodes**: 760 in the bbox — much denser, but overwhelmingly
untagged with `level`, and where present, `level` values (1, 2, -1...)
don't map cleanly to a street/skyway distinction either. Most also lack
`entrance`, so there's no way to tell an exterior street door from an
interior room door by tags alone. Sample:

```
{'door': 'hinged'}                                              # no entrance, no level — interior door?
{'door': 'revolving', 'entrance': 'main', 'level': '1'}          # level=1 here means street floor for THIS building
{'access': 'permissive', 'door': 'hinged', 'entrance': 'main', 'level': '2'}  # different building, different scheme
```

The core problem: OSM's `level` tag is building-relative (ground floor is
sometimes 0, sometimes 1, sometimes unlabeled), not normalized to our
schema's skyway-wide "z=1 for skyway" convention. Building-by-building
manual verification would be needed to know which door is actually the
street entrance — auto-extraction would produce wrong answers roughly as
often as right ones, which is worse than not having the feature, especially
for exactly the scenario this is meant to help (finding your way outside
in bad weather).

## What would make this buildable

- Manually surveying/tagging street entrances for the ~113 network
  buildings (a real, scoped data-entry task — not a coding task).
- Or: if Joey does the 360-camera skyway documentation project he's
  floated, that walkthrough would naturally identify every street-level
  transition point, solving this and the imagery gap at once.

Until then: don't fake this with a fragile heuristic. Better to have no
street-access feature than a wrong one telling someone to exit through a
door that doesn't go outside.
