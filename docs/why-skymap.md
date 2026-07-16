# Why Skymap — what Apple Maps and Google Maps can't do here

The Minneapolis Skyway is 9.5 miles of enclosed, second-story walkways
connecting ~80 downtown blocks — the largest system of its kind in the
world. In January, it *is* downtown Minneapolis. And the two dominant maps
treat it as if it doesn't exist.

## The gap

**Apple and Google route streets.** Ask either for walking directions
between two downtown buildings in a snowstorm and they'll send you outside,
because their routing graphs are built from roads and sidewalks. Skyway
bridges appear (at best) as decorative lines — not as something you can
route through. The specialist tools that do exist are static PDF maps or
thin viewers with stale listings.

Skymap's entire routing graph *is* the skyway: buildings are the nodes,
enclosed bridges are the edges, extracted from OpenStreetMap's real
geometry and rebuilt automatically as the mapping community improves it.

## The magic, concretely

**Time is part of the graph.** The skyway's defining quirk is that its
"streets" close — each building locks its doors on its own schedule. Our
router treats hours as a first-class routing constraint: a building closed
at your departure time simply drops out of the graph, routes warn when a
building on your path closes within 30 minutes of you reaching it, and the
whole map shifts to show what's open as you scrub through the day. No
general-purpose map models this, because street networks don't close.

**Navigation by storefront, not street sign.** Indoors there are no street
names, so turn-by-turn reads the way locals actually give directions:
"Head into Deluxe Plaza, past Ginelli's Pizza." Every route step is
anchored to a recognizable business drawn from the same data.

**Everything inside is a destination.** 200+ businesses — the coffee
shop, the YMCA, the pharmacy — are searchable and routable, each linked
out to its Google listing for reviews and photos rather than pretending we
have that data.

**It heals itself in real time.** Found a locked door? One tap reports the
crossing and your route recalculates around it instantly. Reports expire
after four hours, so yesterday's closure doesn't haunt today's map.

**It knows you're on foot, indoors, in winter.** Stairs-free routing for
accessibility. "Save My Ramp" pins where you parked and routes you back
with one tap. A reach map shades everything you can walk to indoors in
5/10/15 minutes — useful for "where can I get lunch without a coat," and
something no mainstream map offers at all.

**It works with no signal and no account.** The full network and router
live on the device after first load — pathfinding is 100% offline, which
matters in concrete-and-steel corridors where phones routinely lose data.
No login, no tracking, no ads.

## The one-line version

Apple Maps knows the city's streets. Skymap knows the city that exists
one story up, indoors, with opening hours — and treats it as the real
transportation network it is.
