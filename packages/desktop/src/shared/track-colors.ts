import { TRACK_COLOR_COUNT } from "@fourhands/core";

/**
 * Track palette, shared by the window (theme.ts) and the AI desk, which accepts the names.
 * 2.7 Track colours (H3.2, 15/10/2026, pending Fran's approval): ten named, muted tones, without the
 * amber and blue of authorship. The first six keep the hues of the approved sketches, nudged in
 * lightness so that every pair stays apart for deuteranopia, protanopia and tritanopia (CIEDE2000
 * ≥ 6 in all three simulations) and the dark note text reads at ≥ 4.5:1 on all of them.
 * A track stores the index (`Track.color`), so the order here never changes: add at the end.
 */
export interface TrackColor {
  /** Name the AI uses (`color` in add_track / update_track). */
  id: string;
  es: string;
  en: string;
  hex: string;
  /** Comparison (15/10/2026): the same tone with about twice the saturation. */
  vivid: string;
}

export const TRACK_PALETTE: readonly TrackColor[] = [
  { id: "lavender", es: "Lavanda", en: "Lavender", hex: "#afabcd", vivid: "#aea8e3" },
  { id: "sand", es: "Arena", en: "Sand", hex: "#beae8a", vivid: "#c3ae79" },
  { id: "sage", es: "Salvia", en: "Sage", hex: "#99b7a9", vivid: "#79bea0" },
  { id: "clay", es: "Arcilla", en: "Clay", hex: "#bd9388", vivid: "#d18b79" },
  { id: "slate", es: "Pizarra", en: "Slate", hex: "#859bae", vivid: "#7f9cb3" },
  { id: "stone", es: "Piedra", en: "Stone", hex: "#87867c", vivid: "#888674" },
  { id: "plum", es: "Ciruela", en: "Plum", hex: "#957d8d", vivid: "#a57596" },
  { id: "moss", es: "Musgo", en: "Moss", hex: "#838e6c", vivid: "#7e9159" },
  { id: "water", es: "Agua", en: "Water", hex: "#7cb7b4", vivid: "#53bcb9" },
  { id: "heather", es: "Brezo", en: "Heather", hex: "#a99096", vivid: "#b58b96" },
];

function fold(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

/** Palette index of a colour named in English or Spanish (any case, accents optional), or null. */
export function trackColorByName(name: string): number | null {
  const n = fold(name);
  const i = TRACK_PALETTE.findIndex((c) => c.id === n || fold(c.es) === n || fold(c.en) === n);
  return i >= 0 ? i : null;
}

/** Name of a palette index in English (what the AI reads). */
export function trackColorId(index: number): string {
  return TRACK_PALETTE[((index % TRACK_COLOR_COUNT) + TRACK_COLOR_COUNT) % TRACK_COLOR_COUNT]?.id ?? TRACK_PALETTE[0]!.id;
}
