/**
 * Reading what the AI writes (docs/mcp.md, 3): the compact format back into ticks.
 *
 *   E5 17.1 1/4 v72
 *   D5 17.2 1/8 v65 ~s+0.03
 *
 * The mirror of compact.ts. Every parse error says, in musical terms, what is wrong and where, so
 * that the AI can fix it by itself (docs/mcp.md, 11). Nothing is written if any line is wrong:
 * the caller parses everything first and only then runs the commands.
 */
import type { NoteSpec } from "./commands.js";
import { formatPosition } from "./compact.js";
import { type KeyChange, type KeySignature, type Meter, type Song, type TempoPoint, barAt, barStart, barTicks, beatTicks, notesOf, orderedSections, songEnd } from "./model.js";
import { PPQ, nominalGridPosition } from "./time.js";

/** An error the AI can read and act on. */
export class MusicError extends Error {
  override name = "MusicError";
}

const WHOLE = 4 * PPQ;
const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C4" → 60, "Eb5" → 75, "F#3" → 54. Also "Cb4", "B#3", "Fx4" (double sharp) and "Ebb4". */
export function parsePitch(text: string): number {
  const m = /^([A-Ga-g])(##|#|x|bb|b)?(-?\d{1,2})$/.exec(text);
  if (!m) throw new MusicError(`'${text}' is not a pitch (expected e.g. C4, Eb5, F#3; middle C = C4)`);
  const accidental = { "#": 1, "##": 2, x: 2, b: -1, bb: -2 }[m[2] ?? ""] ?? 0;
  const pitch = (Number(m[3]) + 1) * 12 + PITCH_CLASS[m[1]!.toUpperCase()]! + accidental;
  if (pitch < 0 || pitch > 127) throw new MusicError(`'${text}' is outside the MIDI range (C-1 to G9)`);
  return pitch;
}

function parseFraction(text: string, what: string): number {
  const m = /^(\d+)\/(\d+)$/.exec(text);
  if (!m || Number(m[2]) === 0) throw new MusicError(`'${text}' is not a fraction for ${what}`);
  return Number(m[1]) / Number(m[2]);
}

export interface ParsedPosition {
  tick: number;
  bar: number;
}

/** "17.1", "17.3+1/2", "17.2+1/3" → tick. The beat is the meter's unit (quarter in 4/4, eighth in 6/8). */
export function parsePosition(meter: Meter, text: string): ParsedPosition {
  const m = /^(\d+)\.(\d+)(?:\+(\d+\/\d+))?$/.exec(text);
  if (!m) throw new MusicError(`'${text}' is not a position (expected bar.beat, e.g. 17.1 or 17.3+1/2)`);
  const bar = Number(m[1]);
  const beat = Number(m[2]);
  if (bar < 1) throw new MusicError(`'${text}': bars start at 1`);
  if (beat < 1 || beat > meter.numerator) {
    throw new MusicError(`'${text}': beat ${beat} does not exist in ${meter.numerator}/${meter.denominator} (beats 1 to ${meter.numerator})`);
  }
  const part = m[3] ? parseFraction(m[3], "a beat") : 0;
  if (part >= 1) throw new MusicError(`'${text}': the fraction after + must be less than one beat`);
  const tick = barStart(meter, bar) + Math.round((beat - 1 + part) * beatTicks(meter));
  return { tick, bar };
}

/**
 * "1/4", "1/8.", "1/8t", "1/2+1/8", "3/8" → ticks. A whole number counts whole notes: "1", "2",
 * "1+1+1" (Claude wrote that for three tied bars in the Severance session, 20/10/2026).
 */
export function parseDuration(text: string): number {
  let total = 0;
  for (const part of text.split("+")) {
    const m = /^(\d+)(?:\/(\d+))?(\.{0,2})(t?)$/.exec(part.replace(/^(\d+)(?=\.{0,2}t?$)/, "$1/1"));
    if (!m || Number(m[2]) === 0) {
      throw new MusicError(`'${text}' is not a duration (fractions of a whole note: 1/4, 1/8., 1/8t, 1/2+1/8)`);
    }
    let value = (WHOLE * Number(m[1])) / Number(m[2]);
    if (m[3] === ".") value *= 1.5;
    if (m[3] === "..") value *= 1.75;
    if (m[4] === "t") value *= 2 / 3;
    total += value;
  }
  const ticks = Math.round(total);
  if (ticks < 1) throw new MusicError(`'${text}' is too short`);
  return ticks;
}

/** "+0.03" or "-0.02" beats → ticks. */
function parseDeviation(meter: Meter, text: string, what: string): number {
  const m = /^[+-]\d+(?:\.\d+)?$/.exec(text);
  if (!m) throw new MusicError(`'${what}${text}' is not a deviation (in beats, e.g. ~s+0.03 or ~d-0.05)`);
  const beats = Number(text);
  if (Math.abs(beats) >= 1) throw new MusicError(`'${what}${text}': a deviation is less than one beat`);
  return Math.round(beats * beatTicks(meter));
}

function parseVelocity(text: string): number {
  const m = /^v(\d{1,3})$/.exec(text);
  const v = m ? Number(m[1]) : NaN;
  if (!(v >= 1 && v <= 127)) throw new MusicError(`'${text}' is not a velocity (v1 to v127)`);
  return v;
}

/** The fields one line can carry. Missing fields stay as they are (for edits) or take defaults (for new notes). */
export interface NoteTokens {
  id?: string;
  pitch?: number;
  start?: number;
  bar?: number;
  duration?: number;
  velocity?: number;
  startDeviation?: number;
  durationDeviation?: number;
}

const ID = /^n\d+$/;
const PITCH = /^[A-Ga-g](##|#|x|bb|b)?-?\d{1,2}$/;
const POSITION = /^\d+\.\d+(\+\d+\/\d+)?$/;
// Fractions of a whole note, or whole numbers of whole notes ("1+1+1"); a position always has a dot and a beat.
const DURATION = /^\d+(\/\d+)?\.{0,2}t?(\+|$)/;

/**
 * Splits a line into its fields by their shape, in any order:
 * `n482`, `F5`, `17.2+1/2`, `1/8.`, `v65`, `~s+0.03`, `~d-0.05`. `@u` and `@ai` are ignored
 * (the app decides the author), so a line copied from read_notes can be sent back.
 */
export function parseNoteTokens(meter: Meter, line: string): NoteTokens {
  const out: NoteTokens = {};
  const once = (key: keyof NoteTokens, token: string) => {
    if (out[key] !== undefined) throw new MusicError(`'${token}': the line has two values of the same kind`);
  };
  for (const token of line.trim().split(/\s+/)) {
    if (token === "" || token === "@u" || token === "@ai") continue;
    if (ID.test(token)) {
      once("id", token);
      out.id = token;
    } else if (PITCH.test(token)) {
      once("pitch", token);
      out.pitch = parsePitch(token);
    } else if (POSITION.test(token)) {
      once("start", token);
      const p = parsePosition(meter, token);
      out.start = p.tick;
      out.bar = p.bar;
    } else if (DURATION.test(token)) {
      once("duration", token);
      out.duration = parseDuration(token);
    } else if (/^v/.test(token)) {
      once("velocity", token);
      out.velocity = parseVelocity(token);
    } else if (token.startsWith("~s")) {
      once("startDeviation", token);
      out.startDeviation = parseDeviation(meter, token.slice(2), "~s");
    } else if (token.startsWith("~d")) {
      once("durationDeviation", token);
      out.durationDeviation = parseDeviation(meter, token.slice(2), "~d");
    } else {
      throw new MusicError(`'${token}' is not a pitch, position, duration, velocity or deviation`);
    }
  }
  return out;
}

export const DEFAULT_VELOCITY = 80;

/** Lines of a multi-line text, without blank lines; each with its 1-based line number. */
export function lines(text: string): { n: number; text: string }[] {
  return text
    .split(/\r?\n|;/)
    .map((t, i) => ({ n: i + 1, text: t.trim() }))
    .filter((l) => l.text.length > 0);
}

function atLine(n: number, text: string, error: unknown): MusicError {
  const message = error instanceof MusicError ? error.message : String(error);
  return new MusicError(`Line ${n} ("${text}"): ${message}. Nothing was written.`);
}

/** New notes: every line needs pitch, position and duration; velocity defaults to 80. */
export function parseNewNotes(meter: Meter, text: string): NoteSpec[] {
  const all = lines(text);
  if (all.length === 0) throw new MusicError("No notes: write one note per line, e.g. 'E5 17.1 1/4 v72'");
  return all.map(({ n, text: line }) => {
    try {
      const t = parseNoteTokens(meter, line);
      if (t.id) throw new MusicError(`new notes have no id (${t.id}): to change an existing note use edit_notes`);
      if (t.pitch === undefined) throw new MusicError("missing the pitch (e.g. E5)");
      if (t.start === undefined) throw new MusicError("missing the position (e.g. 17.1)");
      if (t.duration === undefined) throw new MusicError("missing the duration (e.g. 1/4)");
      const start = t.start + (t.startDeviation ?? 0);
      const duration = t.duration + (t.durationDeviation ?? 0);
      if (start < 0) throw new MusicError("the deviation puts the note before the start of the song");
      if (duration < 1) throw new MusicError("the deviation leaves the note without duration");
      return { pitch: t.pitch, start, duration, velocity: t.velocity ?? DEFAULT_VELOCITY };
    } catch (error) {
      throw atLine(n, line, error);
    }
  });
}

/** A line of edit_notes: the id and only the fields that change. */
export interface NoteEdit extends NoteTokens {
  id: string;
}

export function parseNoteEdits(meter: Meter, text: string): NoteEdit[] {
  const all = lines(text);
  if (all.length === 0) throw new MusicError("No changes: write one note per line, starting with its id, e.g. 'n482 F5'");
  return all.map(({ n, text: line }) => {
    try {
      const t = parseNoteTokens(meter, line);
      if (!t.id) throw new MusicError("missing the note id (e.g. n482)");
      const fields = Object.keys(t).filter((k) => k !== "id" && k !== "bar");
      if (fields.length === 0) throw new MusicError(`nothing to change in ${t.id}`);
      return t as NoteEdit;
    } catch (error) {
      throw atLine(n, line, error);
    }
  });
}

// ---------------------------------------------------------------------------
// Ranges (docs/mcp.md, 3.2)

export interface ResolvedRange {
  start: number;
  /** Exclusive. */
  end: number;
  fromBar: number;
  toBar: number;
  /** "c. 17–24", "selection (c. 17–18)". */
  label: string;
  /** Only for `selection`: the selected notes. */
  noteIds?: string[];
}

/** Bars of the song: up to the last note, section, chord, annotation or loop, at least one. */
export function songBars(song: Song): number {
  let end = songEnd(song);
  for (const s of Object.values(song.sections)) end = Math.max(end, barStart(song.meter, s.endBar + 1));
  for (const tick of Object.keys(song.harmony)) end = Math.max(end, Number(tick) + 1);
  for (const a of Object.values(song.annotations)) end = Math.max(end, a.end);
  if (song.context.loop) end = Math.max(end, song.context.loop.end);
  return Math.max(1, barAt(song.meter, Math.max(0, end - 1)));
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function barsLabel(from: number, to: number): string {
  return from === to ? `c. ${from}` : `c. ${from}–${to}`;
}

function fromTicks(song: Song, start: number, end: number, label?: string): ResolvedRange {
  const fromBar = barAt(song.meter, start);
  const toBar = barAt(song.meter, Math.max(start, end - 1));
  const bars = barsLabel(fromBar, toBar);
  return { start, end, fromBar, toBar, label: label ? `${label} (${bars})` : bars };
}

/** End of a range limit: a bar includes the whole bar; a position includes that beat. */
function rangeEnd(meter: Meter, text: string): number {
  if (/^\d+$/.test(text)) return barStart(meter, Number(text) + 1);
  const p = parsePosition(meter, text);
  const beat = beatTicks(meter);
  return Math.floor(p.tick / beat) * beat + beat;
}

function rangeStart(meter: Meter, text: string): number {
  if (/^\d+$/.test(text)) return barStart(meter, Number(text));
  return parsePosition(meter, text).tick;
}

export interface RangeOptions {
  /** Writing may go past the end of the song (to extend it); reading and pointing may not. */
  allowBeyondEnd?: boolean;
}

/**
 * "17-24", "17", "17.3-18.2", "selection", "loop", "section:Coro", "all".
 * Throws a MusicError the AI can act on: "Bar 90 does not exist: the song has 52 bars."
 */
export function resolveRange(song: Song, text: string, options: RangeOptions = {}): ResolvedRange {
  const raw = text.trim();
  const key = fold(raw);
  const bars = songBars(song);
  if (key === "all" || key === "") return fromTicks(song, 0, barStart(song.meter, bars + 1), "whole song");
  if (key === "selection") {
    const notes = song.context.selection.map((id) => song.notes[id]).filter((n) => n !== undefined);
    if (notes.length === 0) throw new MusicError("The user has nothing selected. Use get_user_context, or ask them.");
    const start = Math.min(...notes.map((n) => n.start));
    const end = Math.max(...notes.map((n) => n.start + n.duration));
    return { ...fromTicks(song, start, end, `selection, ${notes.length} notes`), noteIds: notes.map((n) => n.id) };
  }
  if (key === "loop") {
    const loop = song.context.loop;
    if (!loop) throw new MusicError("There is no loop. Use get_user_context, or ask the user.");
    return fromTicks(song, loop.start, loop.end, "loop");
  }
  if (key.startsWith("section:")) {
    const name = fold(raw.slice(raw.indexOf(":") + 1));
    const sections = orderedSections(song);
    const section = sections.find((s) => fold(s.name) === name) ?? sections.find((s) => fold(s.name).startsWith(name) && name.length > 0);
    if (!section) {
      const names = sections.map((s) => s.name).join(", ");
      throw new MusicError(`There is no section '${raw.slice(raw.indexOf(":") + 1)}'. ${names ? `Sections: ${names}.` : "The song has no sections."}`);
    }
    return fromTicks(song, barStart(song.meter, section.startBar), barStart(song.meter, section.endBar + 1), section.name);
  }
  const m = /^([\d.+/]+?)(?:\s*-\s*([\d.+/]+))?$/.exec(raw);
  if (!m) throw new MusicError(`'${raw}' is not a range. Use bars like '17-24' or '17.3-18.2', or 'selection', 'loop', 'section:Name', 'all'`);
  const start = rangeStart(song.meter, m[1]!);
  const end = rangeEnd(song.meter, m[2] ?? m[1]!);
  if (end <= start) throw new MusicError(`'${raw}': the range ends before it starts`);
  const range = fromTicks(song, start, end);
  if (!options.allowBeyondEnd && range.fromBar > bars) {
    throw new MusicError(`Bar ${range.fromBar} does not exist: the song has ${bars} bar${bars === 1 ? "" : "s"}`);
  }
  if (!options.allowBeyondEnd && range.toBar > bars) {
    return fromTicks(song, start, barStart(song.meter, bars + 1));
  }
  return range;
}

/** Notes of some tracks whose start falls in a range (or the selected notes, for `selection`). */
export function notesInRange(song: Song, range: ResolvedRange, trackIds?: readonly string[]): string[] {
  const wanted = trackIds && trackIds.length > 0 ? new Set(trackIds) : null;
  if (range.noteIds) return range.noteIds.filter((id) => !wanted || wanted.has(song.notes[id]!.trackId));
  // By nominal start, as read_notes groups them: a note played a hair early still belongs to its bar.
  return notesOf(song)
    .filter((n) => {
      const start = nominalGridPosition(n.start).gridTick;
      return (!wanted || wanted.has(n.trackId)) && start >= range.start && start < range.end;
    })
    .map((n) => n.id);
}

/** Bars of a tick span, as the history and the AI read them: "c. 17–18". */
export function barsOf(meter: Meter, start: number, end: number): string {
  return barsLabel(barAt(meter, start), barAt(meter, Math.max(start, end - 1)));
}

// ---------------------------------------------------------------------------
// Time shifts and harmony positions

/** "+1 bar", "-2 beats", "+1/8", "+1 bar 2 beats", "-1/2 beat" → ticks. */
export function parseShift(meter: Meter, text: string): number {
  const raw = text.trim().toLowerCase();
  const sign = raw.startsWith("-") ? -1 : 1;
  const body = raw.replace(/^[+-]\s*/, "");
  if (!body) throw new MusicError(`'${text}' is not a shift (e.g. '+1 bar', '-2 beats', '+1/8')`);
  let ticks = 0;
  const re = /(\d+(?:\/\d+)?(?:\.\d+)?)\s*(bars?|beats?|compás|compases|tiempos?)?/g;
  let consumed = "";
  for (const m of body.matchAll(re)) {
    if (!m[0].trim()) continue;
    consumed += m[0];
    const amount = m[1]!.includes("/") ? parseFraction(m[1]!, "a shift") : Number(m[1]);
    const unit = m[2] ?? "";
    if (/^(bar|compás|compases)/.test(unit)) ticks += amount * barTicks(meter);
    else if (/^(beat|tiempo)/.test(unit)) ticks += amount * beatTicks(meter);
    else if (m[1]!.includes("/")) ticks += amount * WHOLE;
    else throw new MusicError(`'${text}': say 'bar' or 'beat' after ${m[1]} (or use a figure like 1/8)`);
  }
  if (consumed.replace(/\s/g, "") !== body.replace(/\s/g, "")) {
    throw new MusicError(`'${text}' is not a shift (e.g. '+1 bar', '-2 beats', '+1/8')`);
  }
  return sign * Math.round(ticks);
}

/** A chord position: a bar ("17") or a beat ("17.3"). */
export function parseChordPosition(meter: Meter, text: string): number {
  if (/^\d+$/.test(text.trim())) {
    const bar = Number(text.trim());
    if (bar < 1) throw new MusicError(`'${text}': bars start at 1`);
    return barStart(meter, bar);
  }
  return parsePosition(meter, text.trim()).tick;
}

/** Describes a tick for messages: "17.3+1/2". */
export function positionText(meter: Meter, tick: number): string {
  return formatPosition(meter, tick);
}

// ---------------------------------------------------------------------------
// Keys and scale degrees

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
const MAJOR_BY_FIFTHS = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
const MINOR_BY_FIFTHS = ["Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#"];
const SOLFEGE: Record<string, string> = { do: "C", re: "D", mi: "E", fa: "F", sol: "G", la: "A", si: "B" };

/** Pitch class of the key's tonic (0 = C). */
export function tonicOf(key: KeySignature): number {
  const major = (((key.fifths * 7) % 12) + 12) % 12;
  return key.mode === "minor" ? (major + 9) % 12 : major;
}

/** "A minor", "Eb major". */
export function keyText(key: KeySignature): string {
  const names = key.mode === "minor" ? MINOR_BY_FIFTHS : MAJOR_BY_FIFTHS;
  return `${names[key.fifths + 7] ?? "C"} ${key.mode}`;
}

/** "A minor", "Am", "Eb major", "F#m", "La menor", "Mi bemol mayor" → key signature. */
export function parseKey(text: string): KeySignature {
  const raw = fold(text).replace(/\s+/g, " ");
  const m = /^(do|re|mi|fa|sol|la|si|[a-g])\s*(#|♯|b|♭|sostenido|bemol)?\s*(major|minor|mayor|menor|maj|min|m)?$/.exec(raw);
  if (!m) throw new MusicError(`'${text}' is not a key (e.g. 'A minor', 'Eb major', 'F# minor')`);
  const letter = (SOLFEGE[m[1]!] ?? m[1]!).toUpperCase();
  const accidental = m[2] === "#" || m[2] === "♯" || m[2] === "sostenido" ? "#" : m[2] ? "b" : "";
  const mode: KeySignature["mode"] = m[3] && /^(minor|menor|min|m)$/.test(m[3]) ? "minor" : "major";
  const names = mode === "minor" ? MINOR_BY_FIFTHS : MAJOR_BY_FIFTHS;
  const spelled = names.indexOf(letter + accidental);
  if (spelled >= 0) return { fifths: spelled - 7, mode };
  // Enharmonic spelling with no key signature of its own (D# major): the nearest one.
  const pc = (((PITCH_CLASS[letter]! + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0)) % 12) + 12) % 12;
  let best: KeySignature | null = null;
  for (let f = -7; f <= 7; f++) {
    const k: KeySignature = { fifths: f, mode };
    if (tonicOf(k) === pc && (!best || Math.abs(f) < Math.abs(best.fifths))) best = k;
  }
  if (!best) throw new MusicError(`'${text}' is not a key`);
  return best;
}

/**
 * Moves a pitch by scale steps inside the key (natural minor for minor keys). A note outside the
 * scale keeps its alteration over the degree below it.
 */
export function transposeByDegrees(pitch: number, degrees: number, key: KeySignature): number {
  const steps = key.mode === "minor" ? MINOR_STEPS : MAJOR_STEPS;
  const tonic = tonicOf(key);
  const rel = (((pitch - tonic) % 12) + 12) % 12;
  const base = pitch - rel;
  let degree = 0;
  for (let i = 0; i < 7; i++) if (steps[i]! <= rel) degree = i;
  const offset = rel - steps[degree]!;
  const target = degree + degrees;
  const octave = Math.floor(target / 7);
  return base + octave * 12 + steps[((target % 7) + 7) % 7]! + offset;
}

/** "3/4" → meter. */
export function parseMeter(text: string): Meter {
  const m = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*$/.exec(text);
  if (!m || ![1, 2, 4, 8, 16, 32].includes(Number(m[2])) || Number(m[1]) < 1 || Number(m[1]) > 32) {
    throw new MusicError(`'${text}' is not a meter (e.g. '4/4', '3/4', '6/8')`);
  }
  return { numerator: Number(m[1]), denominator: Number(m[2]) };
}

// ---------------------------------------------------------------------------
// Tempo and key changes (H4, 26/10/2026)

function bpmText(tempo: number): string {
  return String(Math.round((60_000_000 / tempo) * 100) / 100);
}

/**
 * The tempo changes as the AI reads and writes them, one per line:
 *   17.1 60          the tempo jumps to 60 BPM there
 *   21.1 rit 50      it slows down from the previous point and reaches 50 there
 *   25.1 accel 72    it speeds up from the previous point and reaches 72 there
 * Empty when the song keeps one tempo.
 */
export function tempoChangesText(song: Song): string {
  const points = song.tempoChanges ?? [];
  let previous = song.tempo;
  return points
    .map((p) => {
      const word = p.ramp ? (p.tempo > previous ? "rit " : "accel ") : "";
      previous = p.tempo;
      return `${formatPosition(song.meter, p.tick)} ${word}${bpmText(p.tempo)}`;
    })
    .join("\n");
}

/**
 * Reads the whole list of tempo changes. Besides the lines of `tempoChangesText`:
 *   24.3 fermata         that beat lasts twice as long (a fermata), then the tempo comes back
 *   24.3 fermata 3       three times as long
 *   24.3 fermata 2 1/2   twice as long, for a half note
 * "rit" must slow down and "accel" speed up; the BPM written is where the ramp arrives.
 */
export function parseTempoChanges(song: Song, text: string): TempoPoint[] {
  const out: TempoPoint[] = [];
  const tempoBefore = (tick: number) => {
    let t = song.tempo;
    for (const p of out) if (p.tick <= tick) t = p.tempo;
    return t;
  };
  for (const { n, text: line } of lines(text)) {
    const where = `Line ${n} ("${line}")`;
    const tokens = line.split(/\s+/);
    let tick: number;
    try {
      tick = parsePosition(song.meter, tokens[0]!).tick;
    } catch (error) {
      throw new MusicError(`${where}: ${(error as Error).message}`);
    }
    if (tick === 0) throw new MusicError(`${where}: the tempo at 1.1 is the song's tempo; change it with set_song_properties`);
    const last = out.at(-1);
    if (last && tick <= last.tick) throw new MusicError(`${where}: write the changes in order, one per position`);
    const word = tokens[1]?.toLowerCase();
    if (word === "fermata" || word === "calderon" || word === "calderón") {
      const factor = tokens[2] === undefined ? 2 : Number(tokens[2].replace(",", "."));
      if (!(factor > 1 && factor <= 8)) throw new MusicError(`${where}: a fermata makes the beat 1.5 to 8 times longer (e.g. 'fermata 2')`);
      const length = tokens[3] === undefined ? beatTicks(song.meter) : parseDuration(tokens[3]);
      const before = tempoBefore(tick);
      out.push({ tick, tempo: Math.round(before * factor) }, { tick: tick + length, tempo: before });
      continue;
    }
    const ramp = word === "rit" || word === "rit." || word === "ritardando" || word === "rall" || word === "accel" || word === "accel." || word === "accelerando";
    const raw = ramp ? tokens[2] : tokens[1];
    const value = raw === undefined ? NaN : Number(raw.replace(",", "."));
    if (!(value >= 10 && value <= 1000)) throw new MusicError(`${where}: write the BPM (10 to 1000), e.g. '17.1 60' or '21.1 rit 50'`);
    if (tokens.length > (ramp ? 3 : 2)) throw new MusicError(`${where}: one change per line: position, then 'rit' or 'accel' if it glides, then the BPM`);
    const tempo = Math.round(60_000_000 / value);
    if (ramp) {
      const before = tempoBefore(tick);
      const slower = tempo > before;
      if (word!.startsWith("rit") || word!.startsWith("rall")) {
        if (!slower) throw new MusicError(`${where}: a ritardando goes slower than ${bpmText(before)} BPM; use 'accel' to speed up`);
      } else if (slower || tempo === before) throw new MusicError(`${where}: an accelerando goes faster than ${bpmText(before)} BPM; use 'rit' to slow down`);
    }
    out.push(ramp ? { tick, tempo, ramp: true } : { tick, tempo });
  }
  return out;
}

/** The key changes, one per line: "c. 17 C major". Empty when the song keeps one key. */
export function keyChangesText(song: Song): string {
  return (song.keyChanges ?? []).map((c) => `c. ${barAt(song.meter, c.tick)} ${keyText(c.key)}`).join("\n");
}

/** Reads the whole list of key changes: "17 C major", "c. 25 La menor", "Coro D major" (a section's first bar). */
export function parseKeyChanges(song: Song, text: string): KeyChange[] {
  const out: KeyChange[] = [];
  for (const { n, text: line } of lines(text)) {
    const where = `Line ${n} ("${line}")`;
    const m = /^(?:c\.?\s*)?(\d+)\s+(.+)$/i.exec(line);
    let bar: number;
    let keyPart: string;
    if (m) {
      bar = Number(m[1]);
      keyPart = m[2]!;
    } else {
      const section = orderedSections(song).find((s) => line.toLowerCase().startsWith(`${s.name.toLowerCase()} `));
      if (!section) throw new MusicError(`${where}: write the bar (or a section's name) and the key, e.g. '17 C major' or 'Coro D major'`);
      bar = section.startBar;
      keyPart = line.slice(section.name.length).trim();
    }
    if (bar < 2) throw new MusicError(`${where}: the key at bar 1 is the song's key; change it with set_song_properties`);
    let key: KeySignature;
    try {
      key = parseKey(keyPart);
    } catch (error) {
      throw new MusicError(`${where}: ${(error as Error).message}`);
    }
    const tick = barStart(song.meter, bar);
    const last = out.at(-1);
    if (last && tick <= last.tick) throw new MusicError(`${where}: write the changes in order, one per bar`);
    out.push({ tick, key });
  }
  return out;
}
