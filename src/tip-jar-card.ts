/** The tip jar dialog. Renders whatever tip-jar.ts decides this platform
 * gets; the footer button stays hidden when that is nothing. */

import { PATREON_URL, type TipJarMode } from "./tip-jar.ts";

export class TipJarCard {
  private root = document.getElementById("tipjar") as HTMLElement;
  private backdrop = document.getElementById("tipjar-backdrop") as HTMLElement;
  private options = document.getElementById("tipjar-options") as HTMLElement;
  private link = document.getElementById("tipjar-link") as HTMLButtonElement;
  /** Restored on close, as the feedback dialog does: a dialog that keeps
   * focus strands anyone navigating by keyboard or switch control. */
  private returnFocusTo: HTMLElement | null = null;

  constructor() {
    this.link.addEventListener("click", () => this.open());
    document.getElementById("tipjar-close")!.addEventListener("click", () => this.close());
    this.backdrop.addEventListener("click", () => this.close());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.root.hidden) this.close();
    });
  }

  show(mode: TipJarMode) {
    this.link.hidden = mode === "hidden";
    this.options.replaceChildren();
    if (mode === "patreon") this.options.append(patreonLink());
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
