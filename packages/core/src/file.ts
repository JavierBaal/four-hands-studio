/**
 * The `.fourhands` file (ARQUITECTURA.md, 9): readable JSON with the song, the signed history
 * and the pending proposals, with a format version from day one.
 *
 * Pure: text in, text out. Autosave, temporary files and renaming are the app's job.
 */
import { z } from "zod";
import type { HistoryEntry } from "./document.js";
import { type IdPrefix, type Song, idNumber } from "./model.js";

export const FILE_FORMAT = "fourhands";
/** Bump when the shape changes, and add a migration from the previous version. */
export const FILE_VERSION = 1;

export class FourHandsFileError extends Error {
  override name = "FourHandsFileError";
}

export interface FourHandsFile {
  song: Song;
  history: HistoryEntry[];
  /** Pending proposals. Their shape arrives with milestone H4. */
  proposals: unknown[];
}

// ---------------------------------------------------------------------------
// Schema

const int = z.number().int();
const tick = int.min(0);
const authorship = z.union([z.object({ by: z.literal("user") }), z.object({ by: z.literal("ai"), client: z.string().min(1) })]);
const passthrough = z.object({ tick, event: z.looseObject({ type: z.string() }) });
const range = z.object({ start: tick, end: tick });

const note = z.object({
  id: z.string().regex(/^n\d+$/),
  trackId: z.string(),
  pitch: int.min(0).max(127),
  start: tick,
  duration: int.min(1),
  velocity: int.min(1).max(127),
  releaseVelocity: int.min(0).max(127).optional(),
  createdBy: authorship,
  shapedBy: authorship,
});

const track = z.object({
  id: z.string().regex(/^t\d+$/),
  name: z.string(),
  program: int.min(0).max(127).nullable(),
  channel: int.min(0).max(15),
  volume: z.number().min(0).max(1),
  pan: z.number().min(-1).max(1),
  mute: z.boolean(),
  solo: z.boolean(),
  color: int.min(0),
  pedal: z.array(range),
  extraEvents: z.array(passthrough),
  sound: z.object({ bank: z.string().min(1).max(255), program: int.min(0).max(127), bankMSB: int.min(0).max(127), name: z.string().max(100) }).optional(),
});

const section = z.object({ id: z.string().regex(/^s\d+$/), name: z.string(), startBar: int.min(1), endBar: int.min(1) });

const annotation = z.object({
  id: z.string().regex(/^a\d+$/),
  start: tick,
  end: tick,
  trackIds: z.array(z.string()),
  text: z.string(),
  author: authorship,
});

const song = z.object({
  title: z.string(),
  concept: z.object({ text: z.string().min(1).max(2000), author: authorship }).optional(),
  tempo: int.min(1),
  meter: z.object({ numerator: int.min(1), denominator: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.literal(16), z.literal(32)]) }),
  key: z.object({ fifths: int.min(-7).max(7), mode: z.enum(["major", "minor"]) }),
  revision: int.min(0),
  counters: z.object({ n: int.min(1), t: int.min(1), s: int.min(1), a: int.min(1), p: int.min(1), i: int.min(1) }),
  trackOrder: z.array(z.string()),
  tracks: z.record(z.string(), track),
  notes: z.record(z.string(), note),
  sections: z.record(z.string(), section),
  harmony: z.record(z.string().regex(/^\d+$/), z.string()),
  annotations: z.record(z.string(), annotation),
  conductorEvents: z.array(passthrough),
  context: z.object({
    selection: z.array(z.string()),
    loop: range.nullable(),
    cursor: tick,
    activeTrackId: z.string().nullable(),
    visible: range.nullable(),
  }),
  viewPreferences: z.object({ noteNames: z.enum(["letters", "solfege"]), middleC: z.enum(["C4", "C3"]), degrees: z.boolean() }),
  midiFile: z.object({ ticksPerBeat: int.min(1), runningStatus: z.boolean(), noteOffAsNoteOn: z.boolean(), releaseVelocity: int.min(0).max(127) }),
});

const historyEntry = z.object({
  revision: int.min(1),
  kind: z.enum(["edit", "undo", "redo"]),
  actor: authorship,
  author: authorship,
  label: z.string(),
  at: z.number(),
});

const fileSchema = z.object({
  format: z.literal(FILE_FORMAT),
  version: z.literal(FILE_VERSION),
  song,
  history: z.array(historyEntry),
  proposals: z.array(z.unknown()),
});

/** Migrations from version N to N + 1, keyed by N. Empty while there is only version 1. */
const MIGRATIONS: Record<number, (data: Record<string, unknown>) => Record<string, unknown>> = {};

// ---------------------------------------------------------------------------
// Write

/**
 * JSON that people can read and diff: small objects and arrays (a note, a track's pedal)
 * on one line, the rest indented.
 */
function readable(value: unknown, indent = ""): string {
  const flat = JSON.stringify(value);
  if (flat === undefined) return "null";
  if (value === null || typeof value !== "object" || flat.length <= 200) return flat;
  const inner = indent + "  ";
  if (Array.isArray(value)) {
    return `[\n${value.map((v) => inner + readable(v, inner)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${readable(v, inner)}`).join(",\n")}\n${indent}}`;
}

/**
 * Goes through the same schema as opening, so a song that could not be opened again is never
 * written, and the fields always come out in the same order.
 */
export function serializeSong(file: FourHandsFile): string {
  const parsed = fileSchema.safeParse({ format: FILE_FORMAT, version: FILE_VERSION, song: file.song, history: file.history, proposals: file.proposals });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    fail(`Refusing to save an invalid song (${issue.path.join(".")}: ${issue.message})`);
  }
  return readable(parsed.data) + "\n";
}

// ---------------------------------------------------------------------------
// Read

function fail(message: string): never {
  throw new FourHandsFileError(message);
}

export function parseSongFile(text: string): FourHandsFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    fail("The file is not valid JSON: it may be damaged or incomplete");
  }
  if (data === null || typeof data !== "object" || (data as { format?: unknown }).format !== FILE_FORMAT) {
    fail("This is not a Four Hands Studio song");
  }
  let raw = data as Record<string, unknown>;
  const version = raw.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) fail("The file has no valid format version");
  if (version > FILE_VERSION) {
    fail(`The song was saved with a newer version of Four Hands Studio (format ${version}; this one reads up to ${FILE_VERSION})`);
  }
  for (let v = version; v < FILE_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) fail(`No migration from format ${v}`);
    raw = { ...migrate(raw), version: v + 1 };
  }

  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    fail(`The song is damaged at ${issue.path.join(".") || "the top"}: ${issue.message}`);
  }
  const s = parsed.data.song as unknown as Song;
  checkConsistency(s);
  return { song: s, history: parsed.data.history as HistoryEntry[], proposals: parsed.data.proposals };
}

/** What the schema cannot see: ids match their keys, references exist, counters never reuse an id. */
function checkConsistency(s: Song): void {
  const keyed: [string, Record<string, { id: string }>][] = [
    ["tracks", s.tracks],
    ["notes", s.notes],
    ["sections", s.sections],
    ["annotations", s.annotations],
  ];
  for (const [name, record] of keyed) {
    for (const [key, item] of Object.entries(record)) if (item.id !== key) fail(`The song is damaged at ${name}.${key}: id ${item.id}`);
  }
  const order = new Set(s.trackOrder);
  if (order.size !== s.trackOrder.length || order.size !== Object.keys(s.tracks).length || ![...order].every((id) => id in s.tracks)) {
    fail("The song is damaged: the track order does not match the tracks");
  }
  for (const n of Object.values(s.notes)) if (!(n.trackId in s.tracks)) fail(`The song is damaged: note ${n.id} is on a missing track`);
  for (const sec of Object.values(s.sections)) if (sec.endBar < sec.startBar) fail(`The song is damaged: section ${sec.id} ends before it starts`);

  // Repair rather than refuse: counters must stay ahead of every id in use.
  const prefixes: [IdPrefix, Record<string, unknown>][] = [
    ["n", s.notes],
    ["t", s.tracks],
    ["s", s.sections],
    ["a", s.annotations],
  ];
  for (const [prefix, record] of prefixes) {
    const max = Math.max(0, ...Object.keys(record).map(idNumber));
    if (s.counters[prefix] <= max) s.counters[prefix] = max + 1;
  }
}
