/**
 * Business-logo helpers shared by the data pipeline (which downloads one
 * favicon per domain at build time) and the UI (which renders the chip).
 * Logos are keyed by domain, not by POI — every Starbucks shares one file.
 */

/** "https://www.kierans.com/x" -> "kierans-com"; null when unparseable. */
export function logoKey(website: string | undefined | null): string | null {
  if (!website) return null;
  // OSM website tags are frequently scheme-less ("kierans.com").
  const url = /^[a-z][a-z0-9+.-]*:/i.test(website) ? website : `https://${website.trim()}`;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (!host.includes(".")) return null;
  return host.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}
