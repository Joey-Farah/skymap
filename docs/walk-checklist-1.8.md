# 1.8 walk checklist

Generated 2026-08-23 from the diff against 1.7. Everything here is a claim 1.8 makes
that 1.7 didn't, so it's the set a walk can actually falsify.

The point of a walk is the things a test can't see: whether a pin is on the right side
of a skyway, whether a place is where we say, whether hours we read off a website match
the door. Anything that disagrees goes in `data/poi-overlay.json` with its source.

## 1. The report that started this

**Emery, Autograph Collection — 215 S 4th St.** Spyhouse Coffee should be a pin in the
Coffee chip, in the Emery's card, alongside Giulia. Published hours Mo–Tu 6:30–17:00,
We–Su 6:30–19:00 (the hotel's own page disagrees and claims 6:30–17:00 daily — if the
door says otherwise, the door wins).

## 2. New food & coffee inside a skyway building

Twelve places 1.7 didn't have. Check the pin is in the right building and, where hours
are listed, that they match the door.

| | Place | Building | Hours we claim |
|---|---|---|---|
| ☐ | Spyhouse Coffee | Emery | Mo-Tu 6:30-17, We-Su 6:30-19 |
| ☐ | Aurora Restaurant & Bar | Marriott City Center | *none — 5th floor, three services* |
| ☐ | Socca Café | RBC Gateway (Four Seasons) | Mo-Fr 7-17 |
| ☐ | Mara | RBC Gateway (Four Seasons) | *none* |
| ☐ | Bep Eatery | Fifth Street Towers | Mo-Fr 11-14, Ste 210 |
| ☐ | 123 Sushi | IDS Center | *none* |
| ☐ | Sushi Takatsu | 733 Building (Baker Center) | Mo-Th 10:30-14:45, Fr to 14:30 |
| ☐ | Murray's | its own building, 26 S 6th | — |
| ☐ | Cowboy Jack's | its own building, 126 N 5th | — |
| ☐ | Graze Food Hall by Travail | its own building | — |
| ☐ | Aster House | its own building | — |
| ☐ | Mocha Momma's Coffee | Minneapolis Central Library | Mo-Sa 8-16 |

The last five are **single-tenant buildings**: the building *is* the business. Tapping
the pin should open the **building card**, not a place card, and the pin should sit
under the **Food** chip — that combination is new and is the thing most likely to be
subtly wrong.

## 3. Buildings that gained a pin

45 buildings now carry a marker, up from 20. The 20 from earlier in 1.8 were walked
already; these are the new ones worth a glance if you pass them — mostly that the pin
sits on the building and the label doesn't collide with it.

Worth confirming specifically: **Hennepin County Government Center**, **Minneapolis
Central Library**, **City Center**, **Orpheum Theatre**, **State Theatre**,
**Guthrie Theater**, **Orchestra Hall**.

## 4. Two removals — confirm they really are gone

| | Place | Where it was |
|---|---|---|
| ☐ | The Seville | 15 Glenwood Ave (across from Target Center) |
| ☐ | Midwest Motorcycle | 215 Washington Ave N |

If either is trading, the removal was wrong and should be reverted — that's the failure
mode worth catching, because a wrong removal is invisible from a desk.

## 5. Four we deliberately did *not* remove

A 2026-08-07 note called these closed or misplaced; re-checking said otherwise. If the
walk shows the old note was right after all, they go in `removed`.

| | Place | The old claim |
|---|---|---|
| ☐ | FedEx Office, IDS Center | "absent from FedEx's own locator" — it isn't |
| ☐ | Dreamgirls, 12 N 5th | "closed" — it has current hours |
| ☐ | Trax, near Ford Center | "filed 136 m away" — it's flagged *nearby*, which is honest |
| ☐ | James & Mary Laurie Booksellers | address disputed: ILAB says 250 3rd Ave N, Yelp says 933 Marquette |

Laurie Booksellers is the one a walk settles fastest — whichever address has the shop.

## 6. Known, not caused by 1.8

**MacPhail Center for Music is no longer a routable building.** A skyway node reassigned
to Residence Inn at the Depot upstream in OSM; the baseline extractor drops it too. It
survives as a *nearby* POI hosted by Portland Avenue Ramp. If you're near the Depot,
worth seeing whether the skyway really does connect where OSM now says.

## 7. Not checkable on foot

Three places named by the Meet Minneapolis skyway guide are **not** in the app because
no second source confirmed them. If you happen to pass, a look settles each:

- ☐ Broadway Pizza and ☐ JR Thai Food — U.S. Bank Plaza
- ☐ Los Ocampos Express — City Center / 50 South Sixth
