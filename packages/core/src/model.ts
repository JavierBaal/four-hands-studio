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
/**
 * A tempo from a tick on. With `ramp`, the tempo glides there from the previous point (linear in
 * BPM): a ritardando or an accelerando. Without it, it changes at once. A fermata is two points:
 * slower at the held note, the old tempo again after it.
 */
export interface TempoPoint {
  tick: number;
  /** Microseconds per quarter note, like `Song.tempo`. */
  tempo: number;
  ramp?: true;
}

/** A key from a bar line on. */
export interface KeyChange {
  tick: number;
  key: KeySignature;
}

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

/**
 * A controller curve (H4, Fran 15/10/2026): CC11 expression and CC1 modulation. Points are MIDI
 * events: each value holds until the next point. A ramp is many points (one per 16th by default).
 */
export interface CcPoint {
  tick: number;
  /** 0–127. */
  value: number;
}

export type CurveKind = "expression" | "modulation";
export const CURVE_KINDS: readonly CurveKind[] = ["expression", "modulation"];
/** The MIDI controller of each curve. */
export const CURVE_CC: Record<CurveKind, number> = { expression: 11, modulation: 1 };
/** What a track plays with no point before: full expression, no modulation (General MIDI). */
export const CURVE_DEFAULT: Record<CurveKind, number> = { expression: 127, modulation: 0 };

/** The value of a curve at a tick: the last point at or before it, or the default. */
export function curveValueAt(points: readonly CcPoint[] | undefined, kind: CurveKind, tick: number): number {
  let value = CURVE_DEFAULT[kind];
  for (const p of points ?? []) {
    if (p.tick > tick) break;
    value = p.value;
  }
  return value;
}

/** A MIDI event the model does not interpret, kept so that exporting gives the file back unchanged. */
export interface PassthroughEvent {
  tick: number;
  /** midi-file event without `deltaTime` and `running`. Byte arrays are plain number arrays. */
  event: { type: string; [field: string]: unknown };
}

/** Number of colours in the track palette (the names and tones live in the app). */
export const TRACK_COLOR_COUNT = 10;

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
  /**
   * Reverb send (CC91), 0–1 (H4, Fran 15/10/2026: "los violines más lejos"). Absent: 0, the
   * synthesizer's own default, so songs from before sound the same.
   */
  reverb?: number;
  mute: boolean;
  solo: boolean;
  /** Index in the track palette (DIRECCION_ARTISTICA.md, 2.7), 0 to TRACK_COLOR_COUNT - 1. */
  color: number;
  /** Insert effects after its sound, in order (F2.2 parte C, effects.ts). Absent: none. */
  inserts?: Insert[];
  /** Sustain pedal. */
  pedal: PedalSpan[];
  /**
   * Where the track sounds (H4, Fran 20/10/2026): "external" sends its MIDI out (to Studio One
   * through a virtual port) instead of playing the built-in sound. "plugin" (fase 2, prueba S2):
   * a plugin hosted by the native engine plays it (`plugin` says which). Absent: inside Four Hands.
   */
  output?: "external" | "plugin";
  /** The plugin that plays the track when `output` is "plugin". */
  plugin?: TrackPlugin;
  /** Expression (CC11) and modulation (CC1), sorted by tick, one point per tick. Absent: none. */
  curves?: Partial<Record<CurveKind, CcPoint[]>>;
  /** Events of this track the model does not interpret (controllers, pitch bend, text…). */
  extraEvents: PassthroughEvent[];
  /**
   * The sound from a sound bank other than the default one, if the user chose one. Absent: the
   * default bank plays `program`. `program` stays the General MIDI program for MIDI export.
   */
  sound?: TrackSound;
}

/** A preset of a sound bank installed by the user (a SoundFont file), by its file name. */
/** An insert effect (F2.2 parte C): one of Four Hands' own, or a plugin (VST3). */
export type InsertKind = "eq" | "compressor" | "limiter" | "plugin";

export interface Insert {
  /** "x12": never reused in the song. */
  id: string;
  kind: InsertKind;
  /** Off: the sound goes through untouched. Absent: on. */
  bypass?: boolean;
  /** Own effects: every parameter, by id (effects.ts OWN_EFFECTS). */
  params?: Record<string, number>;
  /** A plugin effect: which plugin (its state is kept by the app, like an instrument's). */
  plugin?: TrackPlugin;
  /**
   * A plugin effect's parameters the AI set (by the plugin's parameter index, normalised 0–1), and
   * what each one was before the AI first touched it: undoing that puts the plugin back. What the
   * user turns in the plugin's own window is not here (Fran, 03/11/2026: it is only saved).
   */
  pluginParams?: Record<string, number>;
  pluginBase?: Record<string, number>;
}

/** A plugin hosted by the engine (VST3). */
export interface TrackPlugin {
  /** The engine's identifier for it (format, name, file and id). */
  id: string;
  /** "Kontakt 8", as the plugin calls itself. */
  name: string;
}

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

export type IdPrefix = "n" | "t" | "s" | "a" | "p" | "i" | "x";

/** The song concept (ESTUDIO_SKILLS_COMPOSICION.md, 6.3): the intention and the limits, in words. */
export interface SongConcept {
  /** "Orquesta infectada. Dura 1:12, como los créditos; se exportará a Vital y Kontakt." */
  text: string;
  author: Authorship;
}

export interface Song {
  title: string;
  /** What the song is for and its limits; every AI reads it first. Absent until someone writes it. */
  concept?: SongConcept;
  /**
   * Microseconds per quarter note at the start, exactly as MIDI stores it. Use `bpm()` to show it.
   * Later changes are in `tempoChanges` (tempo.ts reads both).
   */
  tempo: number;
  /** Tempo changes after the start (H4, Fran 26/10/2026), sorted by tick. Absent: one tempo. */
  tempoChanges?: TempoPoint[];
  meter: Meter;
  /** The key at the start. Later changes are in `keyChanges`. */
  key: KeySignature;
  /** Key changes after the start (H4, Fran 26/10/2026), sorted by tick, on bar lines. Absent: one key. */
  keyChanges?: KeyChange[];
  /**
   * The master fader (F2.2 parte B, Fran 03/11/2026), with the tracks' scale: 0–1 and the CC7 curve,
   * 1 = 0 dB. Absent: 0 dB, so songs from before sound the same.
   */
  masterVolume?: number;
  /** Insert effects on the Master, before its fader (F2.2 parte C). Absent: none. */
  masterInserts?: Insert[];
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
    counters: { n: 1, t: 1, s: 1, a: 1, p: 1, i: 1, x: 1 },
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
