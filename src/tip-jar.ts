import type { KeyValueStore } from "./storage.ts";

/** The tip jar's decisions, kept free of the DOM and of StoreKit so they can
 * be tested. The dialog in tip-jar-card.ts only renders what these say. */

export const PATREON_URL = "https://www.patreon.com/joeydonuts";

export interface TipProduct {
  id: string;
  /** Localised by StoreKit ("$1.99", "1,99 €"). Never hardcoded: the app
   * sells in every territory but the EU, and each has its own currency. */
  displayPrice: string;
}

export type TipJarMode = "patreon" | "iap" | "hidden";

/**
 * Which tip jar to show. The iOS app may only take tips through Apple — an
 * external payment link is allowed on the US storefront alone, and SkyMap
 * sells worldwide — so when Apple's products haven't loaded it shows
 * nothing rather than falling back to Patreon.
 */
export function tipJarMode(env: { native: boolean; products: TipProduct[] }): TipJarMode {
  if (!env.native) return "patreon";
  return env.products.length > 0 ? "iap" : "hidden";
}

/** The tips, cheapest first. The ids are the App Store Connect product ids;
 * the names are ours, so they read the same in every territory. */
const TIPS = [
  { id: "app.skymap.ios.tip.small", label: "☕ Small tip" },
  { id: "app.skymap.ios.tip.medium", label: "🥐 Medium tip" },
  { id: "app.skymap.ios.tip.large", label: "🍽 Large tip" },
] as const;

export const TIP_IDS: string[] = TIPS.map((t) => t.id);

export interface TipOption {
  id: string;
  label: string;
  price: string;
}

/** Our names with StoreKit's prices, in our order. A product we have no name
 * for is dropped rather than shown as a bare id. */
export function tipOptions(products: TipProduct[]): TipOption[] {
  return TIPS.flatMap((tip) => {
    const product = products.find((p) => p.id === tip.id);
    return product ? [{ id: tip.id, label: tip.label, price: product.displayPrice }] : [];
  });
}

export type PurchaseResult = "purchased" | "cancelled" | "pending" | "failed";

/**
 * What the card does after a purchase attempt. Cancelling is silent: the
 * person just changed their mind, and the card stays put. A failure stays
 * open too, so trying again is one tap.
 */
export function tipOutcome(result: PurchaseResult): { close: boolean; toast: string | null } {
  switch (result) {
    case "purchased":
      return { close: true, toast: "Thank you ♥ That means a lot." };
    case "pending":
      // Ask to Buy: a parent approves later, and the plugin finishes the
      // transaction when it lands.
      return { close: true, toast: "Waiting for approval. Thank you ♥" };
    case "cancelled":
      return { close: false, toast: null };
    case "failed":
      return { close: false, toast: "That didn't go through. You haven't been charged." };
  }
}

const TIPPED_KEY = "skymap.tipped";

/** Whether this person has tipped, or followed the Patreon link, before. */
export function hasTipped(store: KeyValueStore): boolean {
  try {
    return store.getItem(TIPPED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remembered so the arrival line stops asking. Storage that refuses
 * (private browsing) just means it keeps asking; the tip itself is safe. */
export function markTipped(store: KeyValueStore): void {
  try {
    store.setItem(TIPPED_KEY, "1");
  } catch {
    // Nothing to do: see above.
  }
}

/**
 * The "Stayed warm? ♥ Leave a tip" line under "You've arrived". Shown on
 * every arrival until the person tips, then never again: the banner is
 * up for about ten seconds, so once would be easy to miss, and asking
 * again after a tip would be rude.
 */
export function showArrivalTip(env: { arrived: boolean; mode: TipJarMode; tipped: boolean }): boolean {
  return env.arrived && env.mode !== "hidden" && !env.tipped;
}
