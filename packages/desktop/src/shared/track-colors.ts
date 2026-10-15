import { TRACK_COLOR_COUNT } from "@fourhands/core";

/**
 * Track palette, shared by the window (theme.ts) and the AI desk, which accepts the names.
 * 2.7 Track colours (H3.2, approved by Fran on 15/10/2026, option C): ten named tones without the
 * amber and blue of authorship, about twice as saturated as the first H3.2 palette (it looked dull
 * next to Partita), same lightness. Every pair stays apart for deuteranopia, protanopia and
 * tritanopia (CIEDE2000 ≥ 5.5 in all three simulations) and the dark note text reads at ≥ 4.7:1.
 * A track stores the index (`Track.color`), so the order here never changes: add at the end.
 */
export interface TrackColor {
  /** Name the AI uses (`color` in add_track / update_track). */
  id: string;
  es: string;
  en: string;
  hex: string;
}

export const TRACK_PALETTE: readonly TrackColor[] = [
  { id: "lavender", es: "Lavanda", en: "Lavender", hex: "#aea8e3" },
  { id: "sand", es: "Arena", en: "Sand", hex: "#c3ae79" },
  { id: "sage", es: "Salvia", en: "Sage", hex: "#79bea0" },
  { id: "clay", es: "Arcilla", en: "Clay", hex: "#d18b79" },
  { id: "slate", es: "Pizarra", en: "Slate", hex: "#7f9cb3" },
  { id: "stone", es: "Piedra", en: "Stone", hex: "#888674" },
  { id: "plum", es: "Ciruela", en: "Plum", hex: "#a57596" },
  { id: "moss", es: "Musgo", en: "Moss", hex: "#7e9159" },
  { id: "water", es: "Agua", en: "Water", hex: "#53bcb9" },
  { id: "heather", es: "Brezo", en: "Heather", hex: "#b58b96" },
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
