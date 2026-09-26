/** The tip jar dialog. Renders whatever tip-jar.ts decides this platform
 * gets; the footer button stays hidden when that is nothing. */

import { registerPlugin } from "@capacitor/core";
import {
  PATREON_URL,
  TIP_IDS,
  tipJarMode,
  tipOptions,
  tipOutcome,
  type PurchaseResult,
  type TipOption,
  type TipProduct,
} from "./tip-jar.ts";

/** ios/App/App/TipJarPlugin.swift. Registered by the app's own bridge, so
 * there is no web implementation: calls are made only on native. */
const TipJar = registerPlugin<{
  getProducts(options: { ids: string[] }): Promise<{ products: TipProduct[] }>;
  purchase(options: { id: string }): Promise<{ result: PurchaseResult }>;
}>("TipJar");

/** Apple's tips, or none. A binary built before the plugin existed rejects
 * the call; that and a store that can't be reached both mean no tip jar. */
async function loadProducts(): Promise<TipProduct[]> {
  try {
    return (await TipJar.getProducts({ ids: TIP_IDS })).products;
  } catch {
    return [];
  }
}

export class TipJarCard {
  private root = document.getElementById("tipjar") as HTMLElement;
  private backdrop = document.getElementById("tipjar-backdrop") as HTMLElement;
  private options = document.getElementById("tipjar-options") as HTMLElement;
  private link = document.getElementById("tipjar-link") as HTMLButtonElement;
  /** Restored on close, as the feedback dialog does: a dialog that keeps
   * focus strands anyone navigating by keyboard or switch control. */
  private returnFocusTo: HTMLElement | null = null;

  private busy = false;

  constructor(private toast: (text: string) => void) {
    this.link.addEventListener("click", () => this.open());
    document.getElementById("tipjar-close")!.addEventListener("click", () => this.close());
    this.backdrop.addEventListener("click", () => this.close());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.root.hidden) this.close();
    });
  }

  /** Decides what this platform gets and fills the card with it. */
  async load(native: boolean) {
    const products = native ? await loadProducts() : [];
    const mode = tipJarMode({ native, products });
    this.link.hidden = mode === "hidden";
    this.options.replaceChildren();
    if (mode === "patreon") this.options.append(patreonLink());
    if (mode === "iap") this.options.append(...tipOptions(products).map((o) => this.tipButton(o)));
  }

  private tipButton(option: TipOption): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tipjar-option";
    const label = document.createElement("span");
    label.textContent = option.label;
    const price = document.createElement("span");
    price.textContent = option.price;
    button.append(label, price);
    button.addEventListener("click", () => void this.buy(option.id));
    return button;
  }

  private async buy(id: string) {
    // One purchase at a time: Apple's sheet is modal, but a quick double tap
    // can land before it appears.
    if (this.busy) return;
    this.setBusy(true);
    const { result } = await TipJar.purchase({ id }).catch(() => ({ result: "failed" as const }));
    this.setBusy(false);
    const outcome = tipOutcome(result);
    if (outcome.close) this.close();
    if (outcome.toast) this.toast(outcome.toast);
  }

  private setBusy(busy: boolean) {
    this.busy = busy;
    for (const b of this.options.querySelectorAll("button")) b.disabled = busy;
  }

  open() {
    this.returnFocusTo = document.activeElement as HTMLElement | null;
    this.root.hidden = false;
    this.backdrop.hidden = false;
    (this.options.firstElementChild as HTMLElement | null)?.focus();
  }

  close() {
    this.root.hidden = true;
    this.backdrop.hidden = true;
    this.returnFocusTo?.focus();
    this.returnFocusTo = null;
  }
}

function patreonLink(): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = "tipjar-option";
  a.href = PATREON_URL;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = "Support on Patreon ↗";
  return a;
}
