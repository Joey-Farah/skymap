# 1. The iOS app takes tips only through Apple, and stays out of the EU

2026-09-26 · Accepted

## Context

SkyMap is free, and Joey wanted a way for people to support it. He already had
Patreon. Two App Store facts shaped the choice:

- An in-app link to an outside payment page is allowed only on the US
  storefront (the 2025 court ruling). Everywhere else it is a rejectable
  violation, and SkyMap sells in every territory Apple offers.
- Selling anything in-app makes the developer a "trader" under the EU's
  Digital Services Act, and Apple then publishes the trader's address and
  phone number on the EU store pages. For an individual developer, those are
  personal details.

## Decision

- **iOS:** tips are three consumable in-app purchases
  (`app.skymap.ios.tip.small` / `.medium` / `.large`), through a StoreKit 2
  plugin in the app target (`ios/App/App/TipJarPlugin.swift`). The app never
  shows an external payment link. If the products don't load, the tip jar is
  hidden rather than falling back to Patreon (`tipJarMode` in `src/tip-jar.ts`).
- **Web:** the same card links to Patreon.
- **EU:** SkyMap is not distributed there. The DSA trader banner in App Store
  Connect is left unanswered on purpose.

## Alternatives rejected

- **Patreon or Ko-fi link in the app, app made US-only.** Less to build, but
  it drops every other territory, and a web checkout loses most impulse tips
  that Face ID would have kept.
- **Showing the link only on the US storefront.** Compliant, but it needs a
  native storefront check, and every other country gets nothing.
- **A purchase library (RevenueCat, cordova-plugin-purchase).** A dependency
  and an account for three consumables with nothing to restore.

## Consequences

- Apple takes 15% (Small Business Program). On a $3 tip that nets about the
  same as Ko-fi's card fees.
- Adding any payment link to the iOS build reopens the rejection risk, so
  check this ADR first.
- Joining the EU means declaring trader status and publishing contact details.
- New in-app purchases must be submitted together with an app version.
