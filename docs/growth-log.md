# Growth and monetization log

A running record of how SkyMap gets found and whether it ever pays for
itself. Ideas live here whether or not they are acted on; a rejected idea
with its reason is worth more than a list that keeps re-proposing it.

Nothing here is committed to. Joey decides; this file argues.

## Where things stand (2026-09-06)

From App Store Connect, the day 1.11 went live:

| | |
|---|---|
| First-time downloads | 241 |
| Redownloads | 12 |
| Impressions | 2.52K |
| Product page views | 300 |
| Conversion rate | 13.5% daily average |
| Updates | 944 |
| Retention | ~9.5% D1 · ~2% D7 · ~5% D14 · ~0.5% D28 |

**What these actually say.** Conversion is healthy — when someone lands on
the listing, better than one in eight installs. So the constraint is not
the listing, the icon, or the screenshots. It is that only 2.52K people
saw it at all. **Discovery is the whole bottleneck**, which is what makes
physical distribution inside the skyway the right first move rather than
listing tinkering.

Retention looks alarming and mostly isn't. SkyMap is a "I am downtown and
it is February" utility; the honest measure is whether someone still has
it installed and opens it the next time they are in the skyway, not
whether they opened it on day 7. Don't optimise D7. The number worth
watching is redownloads staying near zero — that is people not deleting it.

944 updates against 241 new installs also means the installed base updates
itself. That is context for the update gate: the wall is for emergencies,
not for routine version herding.

## Distribution

### QR code to the App Store — DONE, ready to print

`appstore-assets/marketing/qr-appstore.png` (820×820, ~2.7in at 300dpi)
and `.svg` (vector, any size). Encodes `https://apps.apple.com/app/id6792509326`,
decoded back with `zbarimg` to confirm, error correction level Q so it
still scans with a logo overlaid or a scuffed print.

Note the existing `qr-raw.svg` on the business cards points at the **PWA**
(`skymap-alpha.vercel.app`), which was correct before the app was
approved. Cards printed from that artwork still work — the site is real —
but new print runs should carry the App Store code.

**Considered and rejected: a `/get` redirect on our own domain**, so one
printed code could be retargeted without reprinting. Rejected because it
adds a hop that can fail: `apps.apple.com` is up whether or not Vercel is,
and reprinting cards is cheaper than a dead QR on a poster nobody is
maintaining. Revisit if we ever print something expensive and permanent.

### Physical placement in the skyway

The target user is standing in the product. Ranked by effort against
plausible reach:

1. **Cards with skyway businesses** — the existing card artwork, left at
   coffee shops and lunch counters. Already the plan; needs the test print
   run.
2. **Building directories and management newsletters** — a skyway map app
   is a genuine amenity for a landlord to tell tenants about, which makes
   this a free ask rather than a sales pitch. Highest leverage per email
   sent, and it doubles as the opening for the data-licensing conversation
   below.
3. **Posters at the confusing junctions** — the places people are already
   standing still looking lost. Needs permission from whoever owns the
   wall, which is the same landlords as (2).
4. **Local channels** — r/Minneapolis, downtown-worker groups, Nextdoor.
   Free, one-shot, and worth doing the week a release lands so there is
   something to say.

## Monetization

Ranked by what they cost the product, not by what they might earn.

### Paid placement for restaurants and coffee shops (Joey's idea)

The strongest version of this is real, and it is worth being precise about
which version it is.

**What works about it.** The audience is hyper-local, the intent is
immediate — someone searching "coffee" in SkyMap is going to buy coffee in
the next ten minutes — and the advertiser is a business two hundred feet
away that can see the result. That is a better-qualified impression than
anything a display network sells, and skyway businesses live and die on
lunchtime foot traffic they cannot otherwise reach. A landlord or a BID
could plausibly buy it on behalf of a whole building.

**What breaks it.** The reviews SkyMap has are about trust — "life saver",
someone writing in about a missing ramp because they assumed we would care.
The app's own pitch is "no accounts, no ads, no tracking". If a paid result
outranks a closer, open, better one, the product silently starts lying
about the thing it exists to answer, and there is no way for the user to
tell. That is also the version most likely to draw an App Store review
problem: Apple requires paid placement to be disclosed, and an undisclosed
one in a wayfinding result is exactly the kind of thing that gets flagged.

**The line to hold.** Sponsored content may occupy its own labelled slot;
it may never reorder an honest answer. Concretely:

- A "Featured" card in the search sheet, visibly labelled, above or below
  the real results but never mixed into them.
- Never in a *route*. If the route says walk past the sponsor, that is
  because it is on the way.
- Never a filter result that hides a closer option.
- Sold as a flat monthly placement, not per-click — per-click creates the
  incentive to make the honest results worse.

If that constraint makes it not worth selling, that is the finding, and it
is better to learn it now than after the trust is spent.

### Alternatives worth weighing first

- **Landlord and BID data licensing.** The Urban Works skyway data is
  licensable and would close most of the building-hours gap in one deal.
  The same conversation runs the other way: buildings pay a modest annual
  fee to keep their own hours and tenant list accurate in the app. This
  sells accuracy rather than attention, so it makes the product better
  instead of worse — the only idea on this page with that property.
- **A tip jar / "buy me a coffee".** Trivial to add, no product
  compromise, will not pay for anything. Worth it only as a signal of
  whether people value it enough to pay at all.
- **Paid pro tier.** There is no feature worth paywalling yet, and
  paywalling wayfinding in a public skyway is a bad look. Revisit only if
  something genuinely optional appears (saved routes for commuters,
  building-specific detail).
- **Sponsored "verified hours".** A business pays to have its hours
  checked and kept current. Reads as a service rather than an ad, and the
  user gets a strictly better answer. Closest thing to a free lunch here.

## Decided

Nothing yet. Next decision on the table is whether the paid-placement
experiment runs at all, and if so whether it runs under the labelled-slot
constraint above.
