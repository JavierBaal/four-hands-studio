/**
 * Library cards (05/11/2026; sketch aprobado el mismo día): what a sample library inside a
 * plugin responds to (velocity, expression CC11, modulation CC1), which keys sound and which change
 * articulation, whether it brings its own reverb, and notes. The user's catalog keeps them outside
 * any song, so one card serves every song that uses that library; a track only links one
 * (Track.library). The AI reads the card in the overview and fills it after a test.
 *
 * Pure: types, cleaning what comes from disk or the renderer, reading the AI's text and writing the
 * text the AI reads. The file lives in main (library-catalog.ts).
 */
import { parsePitch, pitchName } from "@fourhands/core";

export type LibState = "yes" | "weak" | "no" | "untested";
export const LIB_STATES: readonly LibState[] = ["yes", "weak", "no", "untested"];

export interface LibResponse {
  state: LibState;
  /** "sobre todo de v80 arriba". */
  note?: string;
}

export interface Keyswitch {
  /** MIDI pitch, Four Hands' numbering (60 = middle C, Do4). */
  pitch: number;
  name: string;
}

export interface LibraryCard {
  id: string;
  /** "Symphonic Strings · Violas". */
  name: string;
  /** The plugin it lives in ("Kontakt 8"), as the plugin calls itself. */
  host?: string;
  velocity: LibResponse;
  expression: LibResponse;
  modulation: LibResponse;
  /** The keys that sound (inclusive), Four Hands' numbering. */
  range?: { low: number; high: number };
  keyswitches: Keyswitch[];
  /** Its own reverb: "off" (it has one, switched off), "on", "none" (it has none). Absent: unknown. */
  ownReverb?: "off" | "on" | "none";
  notes?: string;
  /** Who filled it last, when (ms) and why ("tras la prueba de dinámica"). */
  updated?: { by: "user" | "ai"; at: number; why?: string };
}

export interface LibraryCatalog {
  cards: LibraryCard[];
}

export const EMPTY_CATALOG: LibraryCatalog = { cards: [] };

export function emptyCard(id: string, name: string, host?: string): LibraryCard {
  const card: LibraryCard = { id, name, velocity: { state: "untested" }, expression: { state: "untested" }, modulation: { state: "untested" }, keyswitches: [] };
  if (host) card.host = host;
  return card;
}

const text = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const pitch = (v: unknown): number | undefined => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 127 ? (v as number) : undefined);

function cleanResponse(v: unknown): LibResponse {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const state = LIB_STATES.includes(r.state as LibState) ? (r.state as LibState) : "untested";
  const note = text(r.note, 200);
  return note ? { state, note } : { state };
}

/** A card as it came from disk or the renderer, made valid; null if it has no id or name. */
export function cleanCard(v: unknown): LibraryCard | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  const id = text(c.id, 100);
  const name = text(c.name, 200);
  if (!id || !name) return null;
  const card = emptyCard(id, name, text(c.host, 200));
  card.velocity = cleanResponse(c.velocity);
  card.expression = cleanResponse(c.expression);
  card.modulation = cleanResponse(c.modulation);
  const r = c.range as Record<string, unknown> | undefined;
  const low = pitch(r?.low);
  const high = pitch(r?.high);
  if (low !== undefined && high !== undefined) card.range = { low: Math.min(low, high), high: Math.max(low, high) };
  const seen = new Set<number>();
  for (const k of Array.isArray(c.keyswitches) ? c.keyswitches : []) {
    const p = pitch((k as Record<string, unknown>)?.pitch);
    const n = text((k as Record<string, unknown>)?.name, 60);
    if (p === undefined || !n || seen.has(p)) continue;
    seen.add(p);
    card.keyswitches.push({ pitch: p, name: n });
  }
  card.keyswitches.sort((a, b) => a.pitch - b.pitch);
  if (c.ownReverb === "off" || c.ownReverb === "on" || c.ownReverb === "none") card.ownReverb = c.ownReverb;
  const notes = text(c.notes, 2000);
  if (notes) card.notes = notes;
  const u = c.updated as Record<string, unknown> | undefined;
  if (u && (u.by === "user" || u.by === "ai") && Number.isFinite(u.at)) {
    card.updated = { by: u.by, at: Number(u.at) };
    const why = text(u.why, 200);
    if (why) card.updated.why = why;
  }
  return card;
}

export function cleanCatalog(v: unknown): LibraryCatalog {
  const cards = (v && typeof v === "object" && Array.isArray((v as Record<string, unknown>).cards) ? ((v as Record<string, unknown>).cards as unknown[]) : [])
    .map(cleanCard)
    .filter((c): c is LibraryCard => !!c);
  const ids = new Set<string>();
  return { cards: cards.filter((c) => !ids.has(c.id) && !!ids.add(c.id)) };
}

/** A new id that is not in the catalog. */
export function newCardId(catalog: LibraryCatalog, now: number): string {
  let n = now;
  while (catalog.cards.some((c) => c.id === `lib${n.toString(36)}`)) n++;
  return `lib${n.toString(36)}`;
}

// --- Names the user types and reads ---------------------------------------------------------------

const SOLFEGE: Record<string, number> = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11 };

/**
 * A pitch as the user types it in the card: "Do2", "do♯1", "Re♭3", "sol 4", or letters ("C2",
 * "F#3", "Eb5"). Middle C = Do4 = C4 = 60. Null if it is not one.
 */
export function parseUserPitch(input: string): number | null {
  const s = input.trim().replace(/\s+/g, "").replace(/♯/g, "#").replace(/♭/g, "b");
  const m = /^(do|re|mi|fa|sol|la|si)(#|b)?(-?\d{1,2})$/i.exec(s);
  if (m) {
    const p = (Number(m[3]) + 1) * 12 + SOLFEGE[m[1]!.toLowerCase()]! + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
    return p >= 0 && p <= 127 ? p : null;
  }
  try {
    return parsePitch(s.charAt(0).toUpperCase() + s.slice(1));
  } catch {
    return null;
  }
}

/** Kontakt (and Yamaha-style samplers) call middle C "C3": one octave lower than Four Hands. */
export function hostPitchName(pitch: number, host: string | undefined): string | null {
  if (!host || !/kontakt/i.test(host)) return null;
  return pitchName(pitch - 12);
}

// --- The AI's side ---------------------------------------------------------------------------------

const STATE_WORDS: Record<string, LibState> = { yes: "yes", si: "yes", sí: "yes", weak: "weak", debil: "weak", débil: "weak", no: "no", untested: "untested", "sin probar": "untested", unknown: "untested" };

/** "weak: mostly from v80 up" → { state: weak, note }. Throws a message the AI can act on. */
export function parseResponse(input: string, what: string): LibResponse {
  const m = /^\s*([a-záéíóú ]+?)\s*(?:[:,—-]\s*(.*))?$/i.exec(input);
  const state = m ? STATE_WORDS[m[1]!.trim().toLowerCase()] : undefined;
  if (!state) throw new Error(`${what}: start with yes, weak, no or untested (e.g. 'weak: only above v80'), not '${input}'`);
  const note = m![2]?.trim();
  return note ? { state, note: note.slice(0, 200) } : { state };
}

/** "C2-C6" (scientific pitch, middle C = C4), or "none" to forget it. */
export function parseRange(input: string): { low: number; high: number } | null {
  if (/^\s*(none|-)?\s*$/i.test(input)) return null;
  const m = /^\s*(\S+?)\s*(?:-|–|to|\.\.)\s*(\S+)\s*$/i.exec(input);
  if (!m) throw new Error(`range: two pitches, e.g. 'C2-C6' (middle C = C4), not '${input}'`);
  const a = parsePitch(m[1]!);
  const b = parsePitch(m[2]!);
  return { low: Math.min(a, b), high: Math.max(a, b) };
}

/** "C1 Sustain, C#1 Staccato" (or one per line), or "none". */
export function parseKeyswitches(input: string): Keyswitch[] {
  if (/^\s*(none|-)?\s*$/i.test(input)) return [];
  const out: Keyswitch[] = [];
  for (const part of input.split(/[,\n;]/).map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\S+)\s+(.+)$/.exec(part);
    if (!m) throw new Error(`keyswitches: a pitch and a name each, e.g. 'C1 Sustain, C#1 Staccato', not '${part}'`);
    const p = parsePitch(m[1]!);
    if (out.some((k) => k.pitch === p)) throw new Error(`keyswitches: ${m[1]} is there twice`);
    out.push({ pitch: p, name: m[2]!.trim().slice(0, 60) });
  }
  return out.sort((a, b) => a.pitch - b.pitch);
}

const STATE_TEXT: Record<LibState, string> = { yes: "responds", weak: "responds weakly", no: "does not respond", untested: "untested" };

function responseText(label: string, r: LibResponse): string {
  return `${label} ${STATE_TEXT[r.state]}${r.note ? ` (${r.note})` : ""}`;
}

/** The card as the AI reads it, one line: what to write and what not to. */
export function cardText(card: LibraryCard): string {
  const parts = [responseText("velocity", card.velocity), responseText("expression CC11", card.expression), responseText("modulation CC1", card.modulation)];
  if (card.range) parts.push(`plays ${pitchName(card.range.low)}–${pitchName(card.range.high)}: nothing outside`);
  if (card.keyswitches.length) parts.push(`keyswitches (notes that change articulation, not music) ${card.keyswitches.map((k) => `${pitchName(k.pitch)} ${k.name}`).join(", ")}`);
  if (card.ownReverb) parts.push({ off: "own reverb switched off", on: "own reverb ON (it already sounds wet)", none: "no reverb of its own" }[card.ownReverb]);
  if (card.notes) parts.push(`notes: ${card.notes}`);
  return `library card '${card.name}': ${parts.join("; ")}`;
}

/** Where the cards live (main: libraries.json). */
export interface LibraryStore {
  read(): LibraryCatalog;
  card(id: string): LibraryCard | undefined;
  save(card: unknown): LibraryCard | null;
}
