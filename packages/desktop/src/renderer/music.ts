/**
 * Names the user reads: notes in Do Re Mi or C D E with middle C = 4 (DIRECCION_ARTISTICA.md, 10),
 * key names and the transport position. The AI always reads scientific pitch (compact format).
 */
import { type KeySignature, type Meter, PPQ, barAt, barStart, beatTicks } from "@fourhands/core";
import type { Lang } from "../shared/i18n.js";

export type NoteNames = "solfege" | "letters";

const SOLFEGE_SHARP = ["Do", "Do♯", "Re", "Re♯", "Mi", "Fa", "Fa♯", "Sol", "Sol♯", "La", "La♯", "Si"];
const SOLFEGE_FLAT = ["Do", "Re♭", "Re", "Mi♭", "Mi", "Fa", "Sol♭", "Sol", "La♭", "La", "Si♭", "Si"];
const LETTER_SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const LETTER_FLAT = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

export const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

export function isBlack(pitch: number): boolean {
  return BLACK_KEYS.has(((pitch % 12) + 12) % 12);
}

/** 60 → "Do4" / "C4". Black keys spelled with sharps, or flats in flat keys. */
export function noteName(pitch: number, names: NoteNames, key?: KeySignature): string {
  const flats = (key?.fifths ?? 0) < 0;
  const table = names === "solfege" ? (flats ? SOLFEGE_FLAT : SOLFEGE_SHARP) : flats ? LETTER_FLAT : LETTER_SHARP;
  return `${table[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

const MAJOR_BY_FIFTHS = ["C♭", "G♭", "D♭", "A♭", "E♭", "B♭", "F", "C", "G", "D", "A", "E", "B", "F♯", "C♯"];
const MINOR_BY_FIFTHS = ["A♭", "E♭", "B♭", "F", "C", "G", "D", "A", "E", "B", "F♯", "C♯", "G♯", "D♯", "A♯"];
const LETTER_TO_SOLFEGE: Record<string, string> = { C: "Do", D: "Re", E: "Mi", F: "Fa", G: "Sol", A: "La", B: "Si" };

/** "La menor" / "A minor". */
export function keyName(key: KeySignature, lang: Lang): string {
  const tonic = (key.mode === "minor" ? MINOR_BY_FIFTHS : MAJOR_BY_FIFTHS)[key.fifths + 7] ?? "C";
  if (lang === "es") {
    const name = LETTER_TO_SOLFEGE[tonic[0]!]! + tonic.slice(1);
    return `${name} ${key.mode === "minor" ? "menor" : "mayor"}`;
  }
  return `${tonic} ${key.mode}`;
}

/** Pitch classes of the key's scale (natural minor for minor keys). */
export function scalePitchClasses(key: KeySignature): Set<number> {
  const majorTonic = (((key.fifths * 7) % 12) + 12) % 12;
  const steps = [0, 2, 4, 5, 7, 9, 11];
  return new Set(steps.map((s) => (majorTonic + s) % 12));
}

/** Transport position "023.1.1": bar (three digits), beat, sixteenth inside the beat. */
export function transportPosition(meter: Meter, tick: number): string {
  const bar = barAt(meter, tick);
  const inBar = tick - barStart(meter, bar);
  const beat = beatTicks(meter);
  const sixteenth = Math.floor((inBar % beat) / (PPQ / 4)) + 1;
  return `${String(bar).padStart(3, "0")}.${Math.floor(inBar / beat) + 1}.${sixteenth}`;
}

/** Position for people: "23.1.1" (bar.beat.sixteenth), no padding. */
export function shortPosition(meter: Meter, tick: number): string {
  return transportPosition(meter, tick).replace(/^0+/, "");
}

/** "c. 25–26" style bar range of a tick range (end exclusive). */
export function barRange(meter: Meter, start: number, end: number): string {
  const a = barAt(meter, start);
  const b = barAt(meter, Math.max(start, end - 1));
  return a === b ? `${a}` : `${a}–${b}`;
}

const FIGURES: ReadonlyArray<{ ticks: number; es: string; en: string }> = [
  { ticks: PPQ * 4, es: "redonda", en: "whole" },
  { ticks: PPQ * 2, es: "blanca", en: "half" },
  { ticks: PPQ, es: "negra", en: "quarter" },
  { ticks: PPQ / 2, es: "corchea", en: "eighth" },
  { ticks: PPQ / 4, es: "semicorchea", en: "sixteenth" },
  { ticks: PPQ / 8, es: "fusa", en: "thirty-second" },
];

/**
 * A duration as a musician says it (H3.2, label over a note): "negra", "corchea con puntillo",
 * "negra de tresillo"; "≈ blanca" when it is within 10 % of one (played or articulated notes,
 * like Dilatación's at 95 %); otherwise beats: "1,3 tiempos".
 */
export function durationName(ticks: number, lang: Lang): string {
  const kinds: Array<{ ticks: number; text: string }> = [];
  for (const f of FIGURES) {
    const name = lang === "es" ? f.es : f.en;
    kinds.push({ ticks: f.ticks, text: name });
    kinds.push({ ticks: f.ticks * 1.5, text: lang === "es" ? `${name} con puntillo` : `dotted ${name}` });
    kinds.push({ ticks: (f.ticks * 2) / 3, text: lang === "es" ? `${name} de tresillo` : `${name} triplet` });
  }
  const exact = kinds.find((k) => Math.abs(k.ticks - ticks) <= 1);
  if (exact) return exact.text;
  let best = kinds[0]!;
  for (const k of kinds) if (Math.abs(Math.log(k.ticks / ticks)) < Math.abs(Math.log(best.ticks / ticks))) best = k;
  if (Math.abs(best.ticks - ticks) <= best.ticks * 0.1) return `≈ ${best.text}`;
  const beats = ticks / PPQ;
  const text = (Math.round(beats * 10) / 10).toString();
  const shown = lang === "es" ? text.replace(".", ",") : text;
  return lang === "es" ? `${shown} ${beats === 1 ? "tiempo" : "tiempos"}` : `${shown} ${beats === 1 ? "beat" : "beats"}`;
}
