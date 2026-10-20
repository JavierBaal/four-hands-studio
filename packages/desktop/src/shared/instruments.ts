/**
 * Short instrument names for the piano roll bar ("Melodía (cuerdas) · Cuerdas").
 * The instruments of the MVP palette have their own name; the rest, their General MIDI family.
 */
import type { Lang } from "./i18n.js";

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

/** Instruments with a name of their own, by General MIDI program (the AI can ask for them by name). */
export const NAMED_PROGRAMS: Readonly<Record<number, readonly [string, string]>> = NAMED;

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
  /** Real sounding range, lowest and highest MIDI note (what the AI reads in list_instruments). */
  range?: [low: number, high: number];
  /** What the AI cannot guess from the name (ESTUDIO_SKILLS_COMPOSICION.md, 5.4). */
  note?: string;
}

/** General MIDI sounds outside the palette whose behaviour surprises (list_instruments says it once). */
export const GM_NOTES = "General MIDI 120-127 (guitar fret noise, breath noise, seashore, bird, telephone, helicopter, applause, gunshot) are sound effects: the pitch changes their colour, not a note you hear as a melody.";

/**
 * The instrument palette (PRD_MVP.md, 4.2): piano, strings by section, organ, pad, timpani, plus a
 * few colours a neoclassical writer reaches for. Names are plural for sections, as on a score.
 */
export const PALETTE: { es: string; en: string; items: PaletteItem[] }[] = [
  {
    es: "Teclados",
    en: "Keyboards",
    items: [
      { program: 0, es: "Piano", en: "Piano", range: [21, 108] },
      { program: 4, es: "Piano eléctrico", en: "Electric piano", range: [28, 103], note: "an electric piano (tines), not an acoustic piano" },
      { program: 6, es: "Clave", en: "Harpsichord", range: [29, 89] },
      { program: 8, es: "Celesta", en: "Celesta", range: [60, 108] },
      { program: 19, es: "Órgano", en: "Organ", range: [24, 96] },
    ],
  },
  {
    es: "Cuerdas",
    en: "Strings",
    items: [
      { program: 48, es: "Cuerdas", en: "Strings", range: [28, 96] },
      { program: 49, es: "Cuerdas lentas", en: "Slow strings", range: [28, 96] },
      { program: 40, es: "Violines", en: "Violins", range: [55, 100] },
      { program: 41, es: "Violas", en: "Violas", range: [48, 88] },
      { program: 42, es: "Chelos", en: "Cellos", range: [36, 81] },
      { program: 43, es: "Contrabajos", en: "Double basses", range: [28, 67] },
      { program: 45, es: "Pizzicato", en: "Pizzicato", range: [28, 93] },
      { program: 46, es: "Arpa", en: "Harp", range: [23, 104] },
    ],
  },
  {
    es: "Viento y voces",
    en: "Winds and voices",
    items: [
      { program: 73, es: "Flauta", en: "Flute", range: [60, 96] },
      { program: 68, es: "Oboe", en: "Oboe", range: [58, 93] },
      { program: 71, es: "Clarinete", en: "Clarinet", range: [50, 94] },
      { program: 70, es: "Fagot", en: "Bassoon", range: [34, 76] },
      { program: 60, es: "Trompa", en: "French horn", range: [35, 77] },
      { program: 52, es: "Coro", en: "Choir", range: [40, 81], note: "sung 'aah' vowels: no words, no consonants" },
    ],
  },
  {
    es: "Otros",
    en: "Others",
    items: [
      { program: 89, es: "Pad cálido", en: "Warm pad", range: [24, 108], note: "a synth pad, not an acoustic instrument" },
      { program: 47, es: "Timbales", en: "Timpani", range: [38, 57], note: "tuned drums: one or two pitches per passage; a roll is fast repeated notes" },
      { program: null, es: "Percusión", en: "Drums" },
    ],
  },
];

export function paletteName(item: PaletteItem, lang: Lang): string {
  return lang === "es" ? item.es : item.en;
}
