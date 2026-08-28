/**
 * Colors for text drawn on the map, kept apart from the category palette.
 *
 * Map labels used to be tinted by POI group, which meant a food place's
 * name was drawn in signal amber (#e08a00) — 2.69:1 against the white halo
 * behind it, where AA asks for 4.5:1. A reader wrote in that they had to
 * read the places several times to make out the lettering.
 *
 * The rule now: color identifies a category on the *pin*, which already
 * carries a glyph and is a solid shape rather than 10px letterforms. Label
 * text is ink, always, so legibility never depends on which category a
 * place happens to belong to. Darkening the eight category colors was the
 * other option and it was worse — a readable food amber lands at 1.38
 * against coffee brown, trading a contrast bug for a confusion bug.
 */

/** Every label on the map, whatever it names. */
export const LABEL_INK = "#17243a";

/**
 * The one exception: a building about to close. There is no pin under a
 * building label to carry that signal, so the color has to say it — but at
 * a value that can actually be read (5.28:1, against amber's 2.69:1).
 */
export const LABEL_WARNING = "#9c5d00";

/** Painted behind every label, in both the light and dark map styles. */
export const LABEL_HALO = "rgba(255,255,255,0.92)";

/**
 * What the halo effectively is for contrast purposes. It sits at 92% over
 * map tiles, so the opaque white it is mostly made of is the honest thing
 * to measure against — and the conservative one on the dark style.
 */
export const LABEL_HALO_SOLID = "#ffffff";

function channels(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const value = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [value(0), value(2), value(4)];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
