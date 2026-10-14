/**
 * The song model (ARQUITECTURA.md, 4).
 *
 * Plain JSON-friendly data: records keyed by id, no classes, no Maps. The same object
 * is saved in `.fourhands` files, patched by commands and diffed for the window.
 * All times are integer ticks at PPQ (960 per quarter note); ticks never leave the core.
 */
import { PPQ } from "./time.js";

/** Who decided something. An AI is always identified by its MCP client (e.g. "claude-ai"). */
export type Authorship = { readonly by: "user" } | { readonly by: "ai"; readonly client: string };

export const USER: Authorship = Object.freeze({ by: "user" });
export function ai(client: string): Authorship {
  return { by: "ai", client };
}
export function sameAuthorship(a: Authorship, b: Authorship): boolean {
  return a.by === b.by && (a.by === "user" || (b.by === "ai" && a.client === b.client));
}

export interface Meter {
  numerator: number;
  /** Power of two: 2, 4, 8, 16. */
  denominator: number;
}

/** Key signature as MIDI stores it: number of sharps (positive) or flats (negative), and the mode. */
export interface KeySignature {
  fifths: number;
  mode: "major" | "minor";
}

export interface Note {
  id: string;
  trackId: string;
  /** MIDI note number, 0–127. Middle C (C4) = 60. */
  pitch: number;
  start: number;
  duration: number;
  /** 1–127. */
  velocity: number;
  /** Note-off velocity, only when it differs from the song's default (`midiFile.releaseVelocity`). */
  releaseVelocity?: number;
  /** Who created the note. Never changes. */
  createdBy: Authorship;
  /**
   * Who decided its current pitch, position and duration (PRD_MVP.md, 4.5).
   * This is the note's author: what `@u` / `@ai` show and what the authorship layer colours.
   */
  shapedBy: Authorship;
}

export interface PedalSpan {
  start: number;
  end: number;
}

/** A MIDI event the model does not interpret, kept so that exporting gives the file back unchanged. */
export interface PassthroughEvent {
  tick: number;
  /** midi-file event without `deltaTime` and `running`. Byte arrays are plain number arrays. */
  event: { type: string; [field: string]: unknown };
}

export interface Track {
  id: string;
  name: string;
  /** General MIDI program 0–127, or null when the track sets none (drums, for instance). */
  program: number | null;
  /** MIDI channel 0–15. Channel 9 is percussion. */
  channel: number;
  /** 0–1. */
  volume: number;
  /** -1 (left) to 1 (right). */
  pan: number;
  mute: boolean;
  solo: boolean;
  /** Index in the track palette (DIRECCION_ARTISTICA.md). */
  color: number;
  /** Sustain pedal. */
  pedal: PedalSpan[];
  /** Events of this track the model does not interpret (controllers, pitch bend, text…). */
  extraEvents: PassthroughEvent[];
  /**
   * The sound from a sound bank other than the default one, if the user chose one. Absent: the
   * default bank plays `program`. `program` stays the General MIDI program for MIDI export.
   */
  sound?: TrackSound;
}

/** A preset of a sound bank installed by the user (a SoundFont file), by its file name. */
export interface TrackSound {
  /** File name of the bank, e.g. "YDP-GrandPiano-20160804.sf2". */
  bank: string;
  /** Preset inside the bank. */
  program: number;
  bankMSB: number;
  /** Preset name, as the bank calls it ("1st Violins Sustain"). */
  name: string;
}

export interface Section {
  id: string;
  name: string;
  /** 1-based, inclusive. */
  startBar: number;
  /** 1-based, inclusive. */
  endBar: number;
}

export interface Annotation {
  id: string;
  start: number;
  end: number;
  /** Empty = the whole score. */
  trackIds: string[];
  text: string;
  author: Authorship;
}

export interface TickRange {
  start: number;
  end: number;
}

/**
 * Selection, loop, cursor, active track and visible area live in the model, not only in the
 * window, so that "this" and "here" mean the same for the user and the AI (ESTUDIO_INTERFAZ.md, 8.7).
 * They are not undoable and do not bump the revision.
 */
export interface SharedContext {
  selection: string[];
  loop: TickRange | null;
  cursor: number;
  activeTrackId: string | null;
  visible: TickRange | null;
}

export interface ViewPreferences {
  noteNames: "letters" | "solfege";
  /** Octave number of middle C as the user reads it. The AI always writes C4 = 60. */
  middleC: "C4" | "C3";
  degrees: boolean;
}

/** How the song is written to a MIDI file. Taken from the imported file so that it comes back unchanged. */
export interface MidiFileSettings {
  ticksPerBeat: number;
  runningStatus: boolean;
  /** Write note-offs as note-on with velocity 0. */
  noteOffAsNoteOn: boolean;
  /** Default note-off velocity. */
  releaseVelocity: number;
}

export type IdPrefix = "n" | "t" | "s" | "a" | "p" | "i";

export interface Song {
  title: string;
  /** Microseconds per quarter note, exactly as MIDI stores it. Use `bpm()` to show it. */
  tempo: number;
  meter: Meter;
  key: KeySignature;
  /** Current revision (`r1532`). Every transaction, undo and redo increases it. */
  revision: number;
  /** Next number per id prefix. Ids are never reused within a song (ARQUITECTURA.md, 4.3). */
  counters: Record<IdPrefix, number>;
  trackOrder: string[];
  tracks: Record<string, Track>;
  notes: Record<string, Note>;
  sections: Record<string, Section>;
  /** Chord symbol by tick, as a string key ("15360": "Am"). */
  harmony: Record<string, string>;
  annotations: Record<string, Annotation>;
  /** Tempo changes, extra meters, markers off the bar lines… kept for export. */
  conductorEvents: PassthroughEvent[];
  context: SharedContext;
  viewPreferences: ViewPreferences;
  midiFile: MidiFileSettings;
}

export function emptySong(title = "Sin título"): Song {
  return {
    title,
    tempo: 500_000,
    meter: { numerator: 4, denominator: 4 },
    key: { fifths: 0, mode: "major" },
    revision: 0,
    counters: { n: 1, t: 1, s: 1, a: 1, p: 1, i: 1 },
    trackOrder: [],
    tracks: {},
    notes: {},
    sections: {},
    harmony: {},
    annotations: {},
    conductorEvents: [],
    context: { selection: [], loop: null, cursor: 0, activeTrackId: null, visible: null },
    viewPreferences: { noteNames: "letters", middleC: "C4", degrees: false },
    midiFile: { ticksPerBeat: PPQ, runningStatus: true, noteOffAsNoteOn: false, releaseVelocity: 64 },
  };
}

/** A new song as the app creates it: one piano track, active, so there is somewhere to write. */
export function starterSong(title = "Sin título"): Song {
  const song = emptySong(title);
  song.tracks.t1 = { id: "t1", name: "Piano", program: 0, channel: 0, volume: 0.8, pan: 0, mute: false, solo: false, color: 0, pedal: [], extraEvents: [] };
  song.trackOrder = ["t1"];
  song.counters.t = 2;
  song.context.activeTrackId = "t1";
  return song;
}

// ---------------------------------------------------------------------------
// Time helpers that depend on the meter. The MVP has one meter and one tempo per song.

/** Ticks of one beat: the unit of the meter's denominator (quarter in 4/4, eighth in 6/8). */
export function beatTicks(meter: Meter): number {
  return (PPQ * 4) / meter.denominator;
}

export function barTicks(meter: Meter): number {
  return beatTicks(meter) * meter.numerator;
}

/** First tick of a 1-based bar. */
export function barStart(meter: Meter, bar: number): number {
  return (bar - 1) * barTicks(meter);
}

/** 1-based bar containing a tick. */
export function barAt(meter: Meter, tick: number): number {
  return Math.floor(tick / barTicks(meter)) + 1;
}

export function bpm(song: Pick<Song, "tempo">): number {
  return 60_000_000 / song.tempo;
}

/** End of the last note, or 0. */
export function songEnd(song: Song): number {
  let end = 0;
  for (const n of Object.values(song.notes)) end = Math.max(end, n.start + n.duration);
  return end;
}

/** Number part of an id ("n482" → 482), for stable ordering. */
export function idNumber(id: string): number {
  return Number(id.slice(1));
}

export function compareNotes(a: Note, b: Note): number {
  return a.start - b.start || idNumber(a.id) - idNumber(b.id);
}

/** Notes of a track (or all tracks), ordered by start and then by id. */
export function notesOf(song: Song, trackId?: string): Note[] {
  const notes = Object.values(song.notes).filter((n) => trackId === undefined || n.trackId === trackId);
  return notes.sort(compareNotes);
}

export function orderedSections(song: Song): Section[] {
  return Object.values(song.sections).sort((a, b) => a.startBar - b.startBar || idNumber(a.id) - idNumber(b.id));
}

export function orderedTracks(song: Song): Track[] {
  return song.trackOrder.map((id) => song.tracks[id]).filter((t): t is Track => t !== undefined);
}
