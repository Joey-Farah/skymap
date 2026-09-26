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
