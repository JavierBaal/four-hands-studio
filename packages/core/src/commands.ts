/**
 * Commands: every change to the song goes through one of these (ARQUITECTURA.md, 5.1).
 * They are the same for the mouse, the MIDI keyboard and the AI.
 *
 * Authorship rule (PRD_MVP.md, 4.5; ESTUDIO_INTERFAZ.md, 8.7), applied here and nowhere else:
 * a note belongs to whoever decided its current pitch, position and duration.
 * - Changing pitch, start or duration makes the transaction's author the note's author.
 * - Changing only the velocity (or moving the note to another track) does not.
 * - Accepting a proposal does not either: it runs with the AI as author (`TransactionMeta.author`).
 */
import { CommandError, type Transaction } from "./document.js";
import {
  type Annotation,
  type KeyChange,
  type KeySignature,
  type Meter,
  type Note,
  type PedalSpan,
  type CcPoint,
  type CurveKind,
  type Section,
  type TempoPoint,
  type Track,
  type TrackLibrary,
  type TrackPlugin,
  type TrackSound,
  barTicks,
  sameAuthorship,
  TRACK_COLOR_COUNT,
} from "./model.js";

// ---------------------------------------------------------------------------
// Validation

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new CommandError(message);
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function checkPitch(pitch: number): void {
  check(isInt(pitch) && pitch >= 0 && pitch <= 127, `Pitch out of range: ${pitch}`);
}
function checkStart(start: number): void {
  check(isInt(start) && start >= 0, `Invalid start: ${start}`);
}
function checkDuration(duration: number): void {
  check(isInt(duration) && duration >= 1, `Invalid duration: ${duration}`);
}
function checkVelocity(velocity: number): void {
  check(isInt(velocity) && velocity >= 1 && velocity <= 127, `Velocity out of range: ${velocity}`);
}

function getTrack(tx: Transaction, id: string): Track {
  const track = tx.song.tracks[id];
  if (!track) throw new CommandError(`Unknown track: ${id}`);
  return track;
}

function getNote(tx: Transaction, id: string): Note {
  const note = tx.song.notes[id];
  if (!note) throw new CommandError(`Unknown note: ${id}`);
  return note;
}

// ---------------------------------------------------------------------------
// Song

export interface SongProperties {
  title?: string;
  /** The song concept; "" removes it. Its author is the transaction's. */
  concept?: string;
  /** Microseconds per quarter note. */
  tempo?: number;
  meter?: Meter;
  key?: KeySignature;
  /** The master fader, 0–1 (1 = 0 dB, which removes the field). */
  masterVolume?: number;
}

/** A few sentences: the intention and the limits, not a score. */
export const CONCEPT_MAX = 1000;

export function setSongProperties(tx: Transaction, props: SongProperties): void {
  if (props.title !== undefined && props.title !== tx.song.title) tx.set(["title"], props.title);
  if (props.concept !== undefined) {
    const text = props.concept.trim();
    check(text.length <= CONCEPT_MAX, `The concept is too long (${text.length} characters; at most ${CONCEPT_MAX})`);
    if (!text) {
      if (tx.song.concept) tx.remove(["concept"]);
    } else if (text !== tx.song.concept?.text) tx.set(["concept"], { text, author: tx.author });
  }
  if (props.tempo !== undefined && props.tempo !== tx.song.tempo) {
    check(isInt(props.tempo) && props.tempo > 0 && props.tempo < 0x1000000, `Invalid tempo: ${props.tempo}`);
    tx.set(["tempo"], props.tempo);
  }
  if (props.meter !== undefined) {
    const { numerator, denominator } = props.meter;
    check(isInt(numerator) && numerator >= 1 && numerator <= 32, `Invalid meter: ${numerator}/${denominator}`);
    check([1, 2, 4, 8, 16, 32].includes(denominator), `Invalid meter: ${numerator}/${denominator}`);
    tx.set(["meter"], { numerator, denominator });
  }
  if (props.key !== undefined) {
    check(isInt(props.key.fifths) && Math.abs(props.key.fifths) <= 7, `Invalid key: ${props.key.fifths}`);
    check(props.key.mode === "major" || props.key.mode === "minor", `Invalid mode: ${props.key.mode}`);
    tx.set(["key"], { fifths: props.key.fifths, mode: props.key.mode });
  }
  if (props.masterVolume !== undefined && props.masterVolume !== (tx.song.masterVolume ?? 1)) {
    check(Number.isFinite(props.masterVolume) && props.masterVolume >= 0 && props.masterVolume <= 1, "Master volume must be between 0 and 1");
    if (props.masterVolume === 1) tx.remove(["masterVolume"]);
    else tx.set(["masterVolume"], props.masterVolume);
  }
}

/** The tempo changes after the start (H4). Replaces the whole list; an empty list leaves one tempo. */
export function setTempoChanges(tx: Transaction, points: TempoPoint[]): void {
  const clean: TempoPoint[] = [];
  for (const p of points) {
    check(isInt(p.tick) && p.tick > 0, `A tempo change goes after the start: tick ${p.tick}`);
    check(isInt(p.tempo) && p.tempo >= 60_000 && p.tempo <= 6_000_000, `Invalid tempo: ${p.tempo} (10 to 1000 BPM)`);
    const last = clean.at(-1);
    check(!last || p.tick > last.tick, "Tempo changes go in order, one per position");
    clean.push(p.ramp ? { tick: p.tick, tempo: p.tempo, ramp: true } : { tick: p.tick, tempo: p.tempo });
  }
  if (JSON.stringify(clean) === JSON.stringify(tx.song.tempoChanges ?? [])) return;
  if (clean.length === 0) tx.remove(["tempoChanges"]);
  else tx.set(["tempoChanges"], clean);
}

/** The key changes after the start (H4), on bar lines. Replaces the whole list. */
export function setKeyChanges(tx: Transaction, changes: KeyChange[]): void {
  const bar = barTicks(tx.song.meter);
  const clean: KeyChange[] = [];
  let current = tx.song.key;
  for (const c of changes) {
    check(isInt(c.tick) && c.tick > 0 && c.tick % bar === 0, "A key change goes on a bar line after the first bar");
    check(isInt(c.key.fifths) && Math.abs(c.key.fifths) <= 7, `Invalid key: ${c.key.fifths}`);
    check(c.key.mode === "major" || c.key.mode === "minor", `Invalid mode: ${c.key.mode}`);
    const last = clean.at(-1);
    check(!last || c.tick > last.tick, "Key changes go in order, one per bar");
    // A change to the key already in force says nothing: drop it.
    if (c.key.fifths === current.fifths && c.key.mode === current.mode) continue;
    clean.push({ tick: c.tick, key: { fifths: c.key.fifths, mode: c.key.mode } });
    current = c.key;
  }
  if (JSON.stringify(clean) === JSON.stringify(tx.song.keyChanges ?? [])) return;
  if (clean.length === 0) tx.remove(["keyChanges"]);
  else tx.set(["keyChanges"], clean);
}

// ---------------------------------------------------------------------------
// Tracks

export interface TrackSpec {
  name: string;
  program?: number | null;
  /** Free channel by default (never 9 unless `percussion`). */
  channel?: number;
  percussion?: boolean;
  /** A preset of another sound bank (see Track.sound). */
  sound?: TrackSound;
  /** Palette index; by default the first colour no other track uses. */
  color?: number;
}

function checkColor(color: number): void {
  check(isInt(color) && color >= 0 && color < TRACK_COLOR_COUNT, `Invalid colour: ${color}`);
}

/** The first palette colour no track uses; when all are taken, the least used one. */
function freeColor(tx: Transaction): number {
  const count = new Array<number>(TRACK_COLOR_COUNT).fill(0);
  for (const t of Object.values(tx.song.tracks)) if (t.color >= 0 && t.color < TRACK_COLOR_COUNT) count[t.color]!++;
  let best = 0;
  for (let i = 1; i < TRACK_COLOR_COUNT; i++) if (count[i]! < count[best]!) best = i;
  return best;
}

/**
 * The MIDI channel for a new melodic track: the first one no track uses, never 10 (drums) nor 16
 * (the metronome's when the song plays in the window). A2 (03/11/2026): with all of them taken, the
 * least used one, so a song can have more tracks than channels. Each track still has a strip of its
 * own in the engine; the channel is what goes out to a DAW and into a .mid file.
 */
export function nextChannel(tracks: Iterable<{ channel: number }>): number {
  const count = new Array<number>(15).fill(0);
  for (const t of tracks) if (t.channel >= 0 && t.channel < 15) count[t.channel]!++;
  let best = 0;
  for (let ch = 1; ch < 15; ch++) if (ch !== 9 && count[ch]! < count[best]!) best = ch;
  return best;
}

function freeChannel(tx: Transaction): number {
  return nextChannel(Object.values(tx.song.tracks));
}

export function addTrack(tx: Transaction, spec: TrackSpec): string {
  check(spec.name.trim().length > 0, "A track needs a name");
  const channel = spec.channel ?? (spec.percussion ? 9 : freeChannel(tx));
  check(isInt(channel) && channel >= 0 && channel <= 15, `Invalid channel: ${channel}`);
  const program = spec.program ?? (spec.percussion ? null : 0);
  if (program !== null) check(isInt(program) && program >= 0 && program <= 127, `Invalid program: ${program}`);
  if (spec.color !== undefined) checkColor(spec.color);
  const id = tx.nextId("t");
  const track: Track = {
    id,
    name: spec.name,
    program,
    channel,
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    color: spec.color ?? freeColor(tx),
    pedal: [],
    extraEvents: [],
  };
  tx.set(["tracks", id], track);
  tx.set(["trackOrder"], [...tx.song.trackOrder, id]);
  if (spec.sound) updateTrack(tx, id, { sound: spec.sound });
  return id;
}

export type TrackChanges = Partial<Pick<Track, "name" | "program" | "channel" | "volume" | "pan" | "mute" | "solo" | "color">> & {
  /** A preset of another sound bank, or null to go back to the default bank. */
  sound?: TrackSound | null;
  /**
   * "external": the track's MIDI goes out (Studio One); "internal": the built-in sound plays it;
   * "plugin": a plugin in the engine plays it (needs `plugin`, now or already on the track).
   */
  output?: "internal" | "external" | "plugin";
  /** The plugin for output "plugin"; null forgets it. */
  plugin?: TrackPlugin | null;
  /** Its library card in the user's catalog (Fran, 05/11/2026); null unlinks it. */
  library?: TrackLibrary | null;
};

export function updateTrack(tx: Transaction, id: string, changes: TrackChanges): void {
  const track = getTrack(tx, id);
  if (changes.program !== undefined && changes.program !== null) {
    check(isInt(changes.program) && changes.program >= 0 && changes.program <= 127, `Invalid program: ${changes.program}`);
  }
  if (changes.channel !== undefined) check(isInt(changes.channel) && changes.channel >= 0 && changes.channel <= 15, "Invalid channel");
  if (changes.volume !== undefined) check(changes.volume >= 0 && changes.volume <= 1, "Volume must be between 0 and 1");
  if (changes.pan !== undefined) check(changes.pan >= -1 && changes.pan <= 1, "Pan must be between -1 and 1");
  if (changes.name !== undefined) check(changes.name.trim().length > 0, "A track needs a name");
  if (changes.color !== undefined) checkColor(changes.color);
  const { sound, output, plugin, library, ...rest } = changes;
  if (library) {
    check(library.id.trim().length > 0 && library.name.trim().length > 0, "A library card needs its id and name");
    if (JSON.stringify(track.library) !== JSON.stringify(library)) tx.set(["tracks", id, "library"], { id: library.id, name: library.name });
  } else if (library === null && track.library) tx.remove(["tracks", id, "library"]);
  if (plugin) {
    check(plugin.id.trim().length > 0 && plugin.name.trim().length > 0, "A plugin needs its id and name");
    if (JSON.stringify(track.plugin) !== JSON.stringify(plugin)) tx.set(["tracks", id, "plugin"], { id: plugin.id, name: plugin.name });
  } else if (plugin === null && track.plugin) {
    check(output !== "plugin" && (output !== undefined || track.output !== "plugin"), "A track that sounds through a plugin needs it");
    tx.remove(["tracks", id, "plugin"]);
  }
  if (output !== undefined) {
    check(output === "internal" || output === "external" || output === "plugin", `Invalid output: ${String(output)}`);
    if (output === "plugin") check(plugin !== null && (plugin ?? track.plugin) !== undefined, "Choose the plugin that plays the track");
    if (output !== "internal" && track.output !== output) tx.set(["tracks", id, "output"], output);
    if (output === "internal" && track.output) tx.remove(["tracks", id, "output"]);
  }
  if (sound) {
    check(sound.bank.trim().length > 0, "A sound needs its bank");
    check(isInt(sound.program) && sound.program >= 0 && sound.program <= 127, `Invalid preset: ${sound.program}`);
    check(isInt(sound.bankMSB) && sound.bankMSB >= 0 && sound.bankMSB <= 127, `Invalid bank: ${sound.bankMSB}`);
    if (JSON.stringify(track.sound) !== JSON.stringify(sound)) tx.set(["tracks", id, "sound"], { ...sound });
  } else if (sound === null && track.sound) tx.remove(["tracks", id, "sound"]);
  for (const [field, value] of Object.entries(rest)) {
    if (value !== undefined && track[field as keyof Track] !== value) tx.set(["tracks", id, field], value);
  }
}

/** Removes a track and all its notes. */
export function removeTrack(tx: Transaction, id: string): void {
  getTrack(tx, id);
  for (const note of Object.values(tx.song.notes)) if (note.trackId === id) tx.remove(["notes", note.id]);
  tx.set(["trackOrder"], tx.song.trackOrder.filter((t) => t !== id));
  tx.remove(["tracks", id]);
}

export function moveTrack(tx: Transaction, id: string, index: number): void {
  getTrack(tx, id);
  const order = tx.song.trackOrder.filter((t) => t !== id);
  const at = Math.max(0, Math.min(order.length, index));
  order.splice(at, 0, id);
  if (order.join() !== tx.song.trackOrder.join()) tx.set(["trackOrder"], order);
}

export function setPedal(tx: Transaction, trackId: string, spans: PedalSpan[]): void {
  getTrack(tx, trackId);
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  for (const [i, span] of sorted.entries()) {
    checkStart(span.start);
    check(isInt(span.end) && span.end > span.start, `Invalid pedal span: ${span.start}-${span.end}`);
    const prev = sorted[i - 1];
    check(prev === undefined || prev.end <= span.start, "Pedal spans cannot overlap");
  }
  tx.set(["tracks", trackId, "pedal"], sorted.map(({ start, end }) => ({ start, end })));
}

/**
 * Replaces the points of a curve inside [from, to) with `points` (H4). Points outside the span are
 * kept. Empty `points` clears the span. One point per tick; values 0–127.
 */
export function setCurve(tx: Transaction, trackId: string, kind: CurveKind, from: number, to: number, points: readonly CcPoint[]): void {
  const track = getTrack(tx, trackId);
  check(kind === "expression" || kind === "modulation", `Unknown curve: ${String(kind)}`);
  checkStart(from);
  check(isInt(to) && to > from, `Invalid curve span: ${from}-${to}`);
  const seen = new Set<number>();
  for (const p of points) {
    check(isInt(p.tick) && p.tick >= from && p.tick < to, `Curve point at ${p.tick} is outside ${from}-${to}`);
    check(isInt(p.value) && p.value >= 0 && p.value <= 127, `Curve value must be 0-127, not ${p.value}`);
    check(!seen.has(p.tick), `Two curve points at ${p.tick}`);
    seen.add(p.tick);
  }
  const old = track.curves?.[kind] ?? [];
  const next = [...old.filter((p) => p.tick < from || p.tick >= to), ...points.map(({ tick, value }) => ({ tick, value }))].sort((a, b) => a.tick - b.tick);
  if (JSON.stringify(next) === JSON.stringify(old)) return;
  const curves: Partial<Record<CurveKind, CcPoint[]>> = { ...(track.curves ?? {}) };
  if (next.length) curves[kind] = next;
  else delete curves[kind];
  if (Object.keys(curves).length) tx.set(["tracks", trackId, "curves"], curves);
  else tx.remove(["tracks", trackId, "curves"]);
}

// ---------------------------------------------------------------------------
// Notes

export interface NoteSpec {
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
  releaseVelocity?: number;
}

/** Creates notes on a track. They belong to the transaction's author. Returns their ids, in order. */
export function addNotes(tx: Transaction, trackId: string, specs: readonly NoteSpec[]): string[] {
  getTrack(tx, trackId);
  for (const s of specs) {
    checkPitch(s.pitch);
    checkStart(s.start);
    checkDuration(s.duration);
    checkVelocity(s.velocity);
    if (s.releaseVelocity !== undefined) check(isInt(s.releaseVelocity) && s.releaseVelocity >= 0 && s.releaseVelocity <= 127, "Invalid release velocity");
  }
  return specs.map((s) => {
    const id = tx.nextId("n");
    const note: Note = {
      id,
      trackId,
      pitch: s.pitch,
      start: s.start,
      duration: s.duration,
      velocity: s.velocity,
      createdBy: tx.author,
      shapedBy: tx.author,
    };
    if (s.releaseVelocity !== undefined) note.releaseVelocity = s.releaseVelocity;
    tx.set(["notes", id], note);
    return id;
  });
}

export interface NoteChange {
  id: string;
  pitch?: number;
  start?: number;
  duration?: number;
  velocity?: number;
  trackId?: string;
}

const SHAPE_FIELDS = ["pitch", "start", "duration"] as const;

/** Changes notes. Applies the authorship rule. */
export function updateNotes(tx: Transaction, changes: readonly NoteChange[]): void {
  for (const c of changes) {
    getNote(tx, c.id);
    if (c.pitch !== undefined) checkPitch(c.pitch);
    if (c.start !== undefined) checkStart(c.start);
    if (c.duration !== undefined) checkDuration(c.duration);
    if (c.velocity !== undefined) checkVelocity(c.velocity);
    if (c.trackId !== undefined) getTrack(tx, c.trackId);
  }
  for (const c of changes) {
    const note = getNote(tx, c.id);
    let shapeChanged = false;
    for (const field of SHAPE_FIELDS) {
      const value = c[field];
      if (value !== undefined && value !== note[field]) {
        tx.set(["notes", c.id, field], value);
        shapeChanged = true;
      }
    }
    if (c.velocity !== undefined && c.velocity !== note.velocity) tx.set(["notes", c.id, "velocity"], c.velocity);
    if (c.trackId !== undefined && c.trackId !== note.trackId) tx.set(["notes", c.id, "trackId"], c.trackId);
    if (shapeChanged && !sameAuthorship(note.shapedBy, tx.author)) tx.set(["notes", c.id, "shapedBy"], tx.author);
  }
}

/**
 * Moves notes in time and pitch. Each note keeps its own offset from the grid, because the
 * deviation is computed on read: moving by whole grid steps keeps it (ESPEC_PIANO_ROLL.md, 5.3).
 */
export function moveNotes(tx: Transaction, ids: readonly string[], by: { ticks?: number; semitones?: number }): void {
  const ticks = by.ticks ?? 0;
  const semitones = by.semitones ?? 0;
  check(isInt(ticks) && isInt(semitones), "Moves are in whole ticks and semitones");
  updateNotes(
    tx,
    ids.map((id) => {
      const n = getNote(tx, id);
      return { id, start: n.start + ticks, pitch: n.pitch + semitones };
    }),
  );
}

export function deleteNotes(tx: Transaction, ids: readonly string[]): void {
  for (const id of ids) getNote(tx, id);
  for (const id of new Set(ids)) tx.remove(["notes", id]);
}

// ---------------------------------------------------------------------------
// Form, harmony and annotations

function checkBars(startBar: number, endBar: number): void {
  check(isInt(startBar) && startBar >= 1, `Invalid start bar: ${startBar}`);
  check(isInt(endBar) && endBar >= startBar, `Invalid end bar: ${endBar}`);
}

export function addSection(tx: Transaction, spec: Omit<Section, "id">): string {
  check(spec.name.trim().length > 0, "A section needs a name");
  checkBars(spec.startBar, spec.endBar);
  const id = tx.nextId("s");
  tx.set(["sections", id], { id, name: spec.name, startBar: spec.startBar, endBar: spec.endBar });
  return id;
}

export function updateSection(tx: Transaction, id: string, changes: Partial<Omit<Section, "id">>): void {
  const section = tx.song.sections[id];
  if (!section) throw new CommandError(`Unknown section: ${id}`);
  const next = { ...section, ...changes };
  check(next.name.trim().length > 0, "A section needs a name");
  checkBars(next.startBar, next.endBar);
  for (const field of ["name", "startBar", "endBar"] as const) {
    if (next[field] !== section[field]) tx.set(["sections", id, field], next[field]);
  }
}

export function removeSection(tx: Transaction, id: string): void {
  if (!tx.song.sections[id]) throw new CommandError(`Unknown section: ${id}`);
  tx.remove(["sections", id]);
}

/** Sets the chord at a tick, or clears it with null. */
export function setChord(tx: Transaction, tick: number, symbol: string | null): void {
  checkStart(tick);
  const key = String(tick);
  if (symbol === null) {
    if (key in tx.song.harmony) tx.remove(["harmony", key]);
    return;
  }
  check(symbol.trim().length > 0, "Empty chord symbol");
  if (tx.song.harmony[key] !== symbol) tx.set(["harmony", key], symbol);
}

export function addAnnotation(tx: Transaction, spec: Omit<Annotation, "id" | "author">): string {
  checkStart(spec.start);
  check(isInt(spec.end) && spec.end >= spec.start, "Invalid annotation range");
  for (const t of spec.trackIds) getTrack(tx, t);
  const id = tx.nextId("a");
  const annotation: Annotation = { id, start: spec.start, end: spec.end, trackIds: [...spec.trackIds], text: spec.text, author: tx.author };
  tx.set(["annotations", id], annotation);
  return id;
}

export function updateAnnotation(tx: Transaction, id: string, changes: Partial<Pick<Annotation, "start" | "end" | "text" | "trackIds">>): void {
  const a = tx.song.annotations[id];
  if (!a) throw new CommandError(`Unknown annotation: ${id}`);
  const next = { ...a, ...changes };
  checkStart(next.start);
  check(isInt(next.end) && next.end >= next.start, "Invalid annotation range");
  for (const t of next.trackIds) getTrack(tx, t);
  for (const field of ["start", "end", "text"] as const) if (next[field] !== a[field]) tx.set(["annotations", id, field], next[field]);
  if (next.trackIds.join() !== a.trackIds.join()) tx.set(["annotations", id, "trackIds"], [...next.trackIds]);
}

export function removeAnnotation(tx: Transaction, id: string): void {
  if (!tx.song.annotations[id]) throw new CommandError(`Unknown annotation: ${id}`);
  tx.remove(["annotations", id]);
}
