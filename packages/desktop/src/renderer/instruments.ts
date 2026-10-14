/**
 * Short instrument names for the piano roll bar ("Melodía (cuerdas) · Cuerdas").
 * The instruments of the MVP palette have their own name; the rest, their General MIDI family.
 */
import type { Lang } from "../shared/i18n.js";

const NAMED: Record<number, [es: string, en: string]> = {
  0: ["Piano", "Piano"],
  1: ["Piano brillante", "Bright piano"],
  4: ["Piano eléctrico", "Electric piano"],
  6: ["Clave", "Harpsichord"],
  8: ["Celesta", "Celesta"],
  11: ["Vibráfono", "Vibraphone"],
  16: ["Órgano", "Organ"],
  19: ["Órgano de iglesia", "Church organ"],
  24: ["Guitarra", "Guitar"],
  32: ["Bajo", "Bass"],
  40: ["Violín", "Violin"],
  41: ["Viola", "Viola"],
  42: ["Chelo", "Cello"],
  43: ["Contrabajo", "Double bass"],
  44: ["Cuerdas en trémolo", "Tremolo strings"],
  45: ["Pizzicato", "Pizzicato"],
  46: ["Arpa", "Harp"],
  47: ["Timbales", "Timpani"],
  48: ["Cuerdas", "Strings"],
  49: ["Cuerdas lentas", "Slow strings"],
  52: ["Coro", "Choir"],
  56: ["Trompeta", "Trumpet"],
  57: ["Trombón", "Trombone"],
  60: ["Trompa", "French horn"],
  68: ["Oboe", "Oboe"],
  70: ["Fagot", "Bassoon"],
  71: ["Clarinete", "Clarinet"],
  73: ["Flauta", "Flute"],
  88: ["Pad", "Pad"],
  89: ["Pad cálido", "Warm pad"],
};

const FAMILIES: [es: string, en: string][] = [
  ["Piano", "Piano"],
  ["Percusión afinada", "Chromatic percussion"],
  ["Órgano", "Organ"],
  ["Guitarra", "Guitar"],
  ["Bajo", "Bass"],
  ["Cuerdas", "Strings"],
  ["Conjunto", "Ensemble"],
  ["Metales", "Brass"],
  ["Lengüeta", "Reed"],
  ["Viento", "Pipe"],
  ["Sintetizador", "Synth lead"],
  ["Pad", "Synth pad"],
  ["Efectos", "Synth effects"],
  ["Étnicos", "Ethnic"],
  ["Percusión", "Percussive"],
  ["Efectos de sonido", "Sound effects"],
];

export function instrumentName(program: number | null, channel: number, lang: Lang): string {
  const i = lang === "es" ? 0 : 1;
  if (channel === 9 || program === null) return lang === "es" ? "Percusión" : "Drums";
  return (NAMED[program] ?? FAMILIES[Math.floor(program / 8)] ?? FAMILIES[0]!)[i];
}

export interface PaletteItem {
  /** General MIDI program, or null for percussion (channel 10). */
  program: number | null;
  es: string;
  en: string;
}

/**
 * The instrument palette (PRD_MVP.md, 4.2): piano, strings by section, organ, pad, timpani, plus a
 * few colours a neoclassical writer reaches for. Names are plural for sections, as on a score.
 */
export const PALETTE: { es: string; en: string; items: PaletteItem[] }[] = [
  {
    es: "Teclados",
    en: "Keyboards",
    items: [
      { program: 0, es: "Piano", en: "Piano" },
      { program: 4, es: "Piano eléctrico", en: "Electric piano" },
      { program: 6, es: "Clave", en: "Harpsichord" },
      { program: 8, es: "Celesta", en: "Celesta" },
      { program: 19, es: "Órgano", en: "Organ" },
    ],
  },
  {
    es: "Cuerdas",
    en: "Strings",
    items: [
      { program: 48, es: "Cuerdas", en: "Strings" },
      { program: 49, es: "Cuerdas lentas", en: "Slow strings" },
      { program: 40, es: "Violines", en: "Violins" },
      { program: 41, es: "Violas", en: "Violas" },
      { program: 42, es: "Chelos", en: "Cellos" },
      { program: 43, es: "Contrabajos", en: "Double basses" },
      { program: 45, es: "Pizzicato", en: "Pizzicato" },
      { program: 46, es: "Arpa", en: "Harp" },
    ],
  },
  {
    es: "Viento y voces",
    en: "Winds and voices",
    items: [
      { program: 73, es: "Flauta", en: "Flute" },
      { program: 68, es: "Oboe", en: "Oboe" },
      { program: 71, es: "Clarinete", en: "Clarinet" },
      { program: 70, es: "Fagot", en: "Bassoon" },
      { program: 60, es: "Trompa", en: "French horn" },
      { program: 52, es: "Coro", en: "Choir" },
    ],
  },
  {
    es: "Otros",
    en: "Others",
    items: [
      { program: 89, es: "Pad cálido", en: "Warm pad" },
      { program: 47, es: "Timbales", en: "Timpani" },
      { program: null, es: "Percusión", en: "Drums" },
    ],
  },
];

export function paletteName(item: PaletteItem, lang: Lang): string {
  return lang === "es" ? item.es : item.en;
}
