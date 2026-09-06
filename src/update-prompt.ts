/**
 * Tells someone their copy of SkyMap is behind, and — for a version we
 * know is broken — stops them using it.
 *
 * Two levels, because they answer different questions. Most releases are
 * ordinary and a dismissible line is the honest weight for them; iOS
 * updates most people on its own anyway, and the ones it doesn't have no
 * other way to find out. A wall is for a version that is actually broken,
 * where continuing to use it is worse than the interruption.
 *
 * The decision itself is in app-version.ts and is pure. This file is the
 * fetch, the cache and the screen.
 */

import { Capacitor } from "@capacitor/core";
import { updateGate, type UpdateGate, type UpdateManifest } from "./app-version.ts";
import type { KeyValueStore } from "./storage.ts";

const VERSION = typeof __APP_VERSION__ === "undefined" ? "dev" : __APP_VERSION__;

/** Where the App Store sends someone who taps Update. */
export const LISTING_URL = "https://apps.apple.com/app/id6792509326";

const CACHE_KEY = "skymap.updateManifest";
const DISMISSED_KEY = "skymap.updateDismissed";

/**
 * Where the manifest lives. Same split as the feedback endpoint: the web
 * build sits alongside it, the native build is served from
 * capacitor://localhost and needs the deployed absolute URL, supplied at
 * build time (see ios/App/ci_scripts/ci_post_clone.sh).
 */
function manifestUrl(): string | null {
  if (!Capacitor.isNativePlatform()) return "./update.json";
  return import.meta.env.VITE_UPDATE_MANIFEST || null;
}

type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Never throws: a gate that fails on its own network call would be the
 * thing keeping people out of the app. */
export async function fetchManifest(url: string, fetchImpl: FetchLike): Promise<UpdateManifest | null> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const body = await res.json();
    return body && typeof body === "object" ? (body as UpdateManifest) : null;
  } catch {
    return null;
  }
}

export class UpdatePrompt {
  private banner = document.getElementById("update-banner") as HTMLElement;
  private bannerText = document.getElementById("update-banner-text") as HTMLElement;
  private wall = document.getElementById("update-wall") as HTMLElement;
  private wallText = document.getElementById("update-wall-text") as HTMLElement;

  constructor(private store: KeyValueStore = localStorage) {
    document.getElementById("update-banner-go")!.addEventListener("click", () => this.openListing());
    document.getElementById("update-wall-go")!.addEventListener("click", () => this.openListing());
    document.getElementById("update-banner-dismiss")!.addEventListener("click", () => {
      // Remembered per version: a suggestion said once is a courtesy, the
      // same suggestion every launch is nagging. The next release asks again.
      const shown = this.banner.dataset.version;
      if (shown) this.store.setItem(DISMISSED_KEY, shown);
      this.banner.hidden = true;
    });
  }

  /**
   * Read the manifest and act on it.
   *
   * A *block* is applied only from a manifest fetched just now. The cached
   * copy can raise a suggestion but never a wall: SkyMap's promise is that
   * it works in a skyway with no signal, and shutting the app on someone
   * standing in one, on the strength of a file we read last week, would
   * break it exactly where it exists to work.
   */
  async check(fetchImpl: FetchLike = (u) => fetch(u)): Promise<UpdateGate> {
    const url = manifestUrl();
    const fresh = url ? await fetchManifest(url, fetchImpl) : null;
    if (fresh) this.store.setItem(CACHE_KEY, JSON.stringify(fresh));

    const gate = updateGate(VERSION, fresh ?? this.cached());
    if (gate.kind === "block" && !fresh) return { kind: "none" };

    this.render(gate);
    return gate;
  }

  private cached(): UpdateManifest | null {
    const raw = this.store.getItem(CACHE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  private render(gate: UpdateGate) {
    if (gate.kind === "block") {
      this.wallText.textContent =
        gate.message || "This version of SkyMap has a problem we've since fixed. Update to keep going.";
      this.wall.hidden = false;
      this.banner.hidden = true;
      return;
    }
    if (gate.kind === "suggest") {
      if (this.store.getItem(DISMISSED_KEY) === gate.version) return;
      this.banner.dataset.version = gate.version;
      this.bannerText.textContent = `SkyMap ${gate.version} is out.`;
      this.banner.hidden = false;
    }
  }

  private openListing() {
    window.open(LISTING_URL, "_blank");
  }
}
