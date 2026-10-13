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
