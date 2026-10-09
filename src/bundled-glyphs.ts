/**
 * The map's font, for the ranges our own names need, from the app itself.
 *
 * MapLibre lays out no label in a tile until it has every font range that
 * tile's text needs, and it fetched them from the basemap host. A request
 * that fails is fine — MapLibre then draws the glyphs itself — but one that
 * hangs, as on one bar of signal in a skyway, holds every label back for as
 * long as it hangs: no pins and no building names at all (QA 024), or, mid-
 * walk, every pin near "Tom’s Watch Bar" gone for want of its apostrophe
 * (QA 025).
 *
 * Every name in our data fits in two ranges: 0-255 (Latin) and 8192-8447
 * (curly quotes, dashes). In public/fonts, with the font's licence. Other
 * fonts and ranges, only the basemap's own labels use, so they still come
 * from its host.
 */
const BUNDLED = /\/fonts\/(Noto(?:%20| )Sans(?:%20| )(?:Regular|Bold))\/(0-255|8192-8447)\.pbf$/;

/** The bundled copy of a glyph request, or null to fetch it as asked. */
export function bundledGlyphs(url: string, base: string): string | null {
  const m = BUNDLED.exec(url);
  if (!m) return null;
  return new URL(`fonts/${decodeURIComponent(m[1])}/${m[2]}.pbf`, base).href;
}
