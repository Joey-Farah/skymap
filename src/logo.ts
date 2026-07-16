/**
 * Business-logo helpers shared by the data pipeline (which downloads one
 * favicon per domain at build time) and the UI (which renders the chip).
 * Logos are keyed by domain, not by POI — every Starbucks shares one file.
 */

/** "https://www.kierans.com/x" -> "kierans-com"; null when unparseable. */
export function logoKey(website: string | undefined | null): string | null {
  if (!website) return null;
  let host: string;
  try {
    host = new URL(website).hostname;
  } catch {
    return null;
  }
  if (!host.includes(".")) return null;
  return host.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

// Muted, dark-enough-for-white-text hues; index chosen by name hash so a
// business keeps its color across sessions and devices.
const MONOGRAM_PALETTE = [
  "#b3593a", "#2e7d5b", "#4a5fc1", "#8a4f9e", "#b07d2b",
  "#c04f6e", "#3a7f8f", "#6b6f2e", "#845c44", "#52629a",
];

export function monogramColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return MONOGRAM_PALETTE[h % MONOGRAM_PALETTE.length];
}
