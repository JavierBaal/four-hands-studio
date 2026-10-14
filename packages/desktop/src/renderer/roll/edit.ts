/**
 * What each gesture of ESPEC_PIANO_ROLL.md does to the notes, as pure functions: hit testing,
 * moving with a relative grid, resizing and creating with an absolute grid, rubber band, eraser,
 * quantizing with strength, clipboard, duplicate, transpose. The window turns their results into
 * one command list per gesture (one undo step).
 */
import type { CommandData, Note } from "@fourhands/core";
import { ROW, type RollView, pitchToY, snapFloor, snapNearest, tickToX, xToTick, yToPitch } from "./geometry.js";

/** Edges are grabbed within 6 px; notes under 18 px only have a right edge (ESPEC_PIANO_ROLL.md, 4). */
export const EDGE_PX = 6;
export const SMALL_NOTE_PX = 18;
/** A press is a drag only after the mouse moves more than 3 px. */
export const DRAG_THRESHOLD_PX = 3;

export type Zone = "body" | "left" | "right";

export interface Hit {
  note: Note;
  zone: Zone;
}

export function noteRect(v: RollView, n: Note): { x: number; y: number; w: number; h: number } {
  return { x: tickToX(v, n.start), y: pitchToY(v, n.pitch), w: Math.max(3, n.duration * v.pxPerTick), h: ROW };
}

/** The note under the mouse (the topmost, i.e. the last drawn) and which part of it. */
export function hitTest(notes: readonly Note[], v: RollView, x: number, y: number): Hit | null {
  const pitch = yToPitch(v, y);
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i]!;
    if (n.pitch !== pitch) continue;
    const r = noteRect(v, n);
    if (x < r.x - 1 || x > r.x + r.w + 1) continue;
    if (r.w < SMALL_NOTE_PX) return { note: n, zone: x >= r.x + r.w - EDGE_PX ? "right" : "body" };
    if (x <= r.x + EDGE_PX) return { note: n, zone: "left" };
    if (x >= r.x + r.w - EDGE_PX) return { note: n, zone: "right" };
    return { note: n, zone: "body" };
  }
  return null;
}

export interface GridSetting {
  on: boolean;
  /** Grid step in ticks. */
  step: number;
}

/**
 * Moving: the grid is relative — what snaps is the displacement, so each note keeps its own
 * deviation (ESPEC_PIANO_ROLL.md, 5.3). Shift limits the move to its first direction.
 */
export function moveDelta(
  rawTicks: number,
  rawSemitones: number,
  grid: GridSetting,
  constrain: "time" | "pitch" | null,
): { ticks: number; semitones: number } {
  let ticks = grid.on ? snapNearest(rawTicks, grid.step) : Math.round(rawTicks);
  let semitones = Math.round(rawSemitones);
  if (constrain === "time") semitones = 0;
  if (constrain === "pitch") ticks = 0;
  return { ticks, semitones };
}

/** Keeps a move inside the song: no note before tick 0 or outside 0–127. */
export function clampMove(notes: readonly Note[], d: { ticks: number; semitones: number }): { ticks: number; semitones: number } {
  if (notes.length === 0) return d;
  const minStart = Math.min(...notes.map((n) => n.start));
  const minPitch = Math.min(...notes.map((n) => n.pitch));
  const maxPitch = Math.max(...notes.map((n) => n.pitch));
  return {
    ticks: Math.max(d.ticks, -minStart),
    semitones: Math.max(-minPitch, Math.min(127 - maxPitch, d.semitones)),
  };
}

/**
 * How far the mouse is from where a move snaps, in ticks and semitones (fractional). The notes are
 * drawn that far from their snapped place, so they follow the mouse; the snapped place shows as a
 * target. Kept inside the same limits as the move, and zero along a constrained axis.
 */
export function moveDrift(
  notes: readonly Note[],
  rawTicks: number,
  rawSemitones: number,
  snapped: { ticks: number; semitones: number },
  constrain: "time" | "pitch" | null,
): { ticks: number; semitones: number } {
  const raw = clampMove(notes, { ticks: constrain === "pitch" ? 0 : rawTicks, semitones: constrain === "time" ? 0 : rawSemitones });
  return { ticks: raw.ticks - snapped.ticks, semitones: raw.semitones - snapped.semitones };
}

/** A note drawn away from its place while it follows the mouse, in pixels (edges and vertical). */
export interface NoteDrift {
  left: number;
  right: number;
  dy: number;
}

export function applyMove(notes: readonly Note[], d: { ticks: number; semitones: number }): Note[] {
  return notes.map((n) => ({ ...n, start: n.start + d.ticks, pitch: n.pitch + d.semitones }));
}

/** Resizing: the dragged edge lands on a grid line (absolute grid). Never shorter than one step. */
export function resizeRight(n: Note, rawEnd: number, grid: GridSetting): Note {
  const min = grid.on ? grid.step : 10;
  let end = grid.on ? snapNearest(rawEnd, grid.step) : Math.round(rawEnd);
  // A played note keeps a length of at least one step after its (possibly off-grid) start.
  if (end - n.start < min) end = grid.on ? Math.ceil((n.start + 1) / grid.step) * grid.step : n.start + min;
  return { ...n, duration: Math.max(1, end - n.start) };
}

export function resizeLeft(n: Note, rawStart: number, grid: GridSetting): Note {
  const end = n.start + n.duration;
  let start = grid.on ? snapNearest(rawStart, grid.step) : Math.round(rawStart);
  const limit = end - (grid.on ? 1 : 10);
  if (start > limit) start = grid.on ? Math.floor((end - 1) / grid.step) * grid.step : limit;
  start = Math.max(0, start);
  return { ...n, start, duration: end - start };
}

/** A new note starts on the grid line at or before the mouse and lasts one grid step. */
export function newNoteAt(tick: number, pitch: number, grid: GridSetting, velocity: number): { pitch: number; start: number; duration: number; velocity: number } {
  const start = Math.max(0, grid.on ? snapFloor(tick, grid.step) : Math.round(tick));
  return { pitch: Math.max(0, Math.min(127, pitch)), start, duration: grid.on ? grid.step : 480, velocity };
}

/** Pencil dragged to the right: the length grows in grid steps. */
export function pencilLength(start: number, rawEnd: number, grid: GridSetting): number {
  if (!grid.on) return Math.max(10, Math.round(rawEnd - start));
  return Math.max(grid.step, snapNearest(rawEnd - start, grid.step));
}

/** Notes touched by a rubber band in pixels. */
export function inRect(notes: readonly Note[], v: RollView, r: { x0: number; y0: number; x1: number; y1: number }): Note[] {
  const left = Math.min(r.x0, r.x1);
  const right = Math.max(r.x0, r.x1);
  const top = Math.min(r.y0, r.y1);
  const bottom = Math.max(r.y0, r.y1);
  return notes.filter((n) => {
    const nr = noteRect(v, n);
    return nr.x <= right && nr.x + nr.w >= left && nr.y + 1 <= bottom && nr.y + ROW - 1 >= top;
  });
}

/**
 * Quantize: moves the start (and optionally the end) towards the grid. Strength 0–1 lets a
 * phrase get closer to the grid without losing its life (ESPEC_PIANO_ROLL.md, 8.1).
 */
export function quantize(notes: readonly Note[], step: number, strength: number, ends: boolean): Note[] {
  const k = Math.max(0, Math.min(1, strength));
  return notes.map((n) => {
    const start = Math.max(0, Math.round(n.start + (snapNearest(n.start, step) - n.start) * k));
    if (!ends) return { ...n, start };
    const end = n.start + n.duration;
    const target = Math.max(snapNearest(end, step), snapNearest(n.start, step) + step);
    const newEnd = Math.round(end + (target - end) * k);
    return { ...n, start, duration: Math.max(1, newEnd - start) };
  });
}

export interface ClipNote {
  /** Relative to the earliest start of the copied notes. */
  offset: number;
  pitch: number;
  duration: number;
  velocity: number;
}

export function toClipboard(notes: readonly Note[]): ClipNote[] {
  if (notes.length === 0) return [];
  const first = Math.min(...notes.map((n) => n.start));
  return [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch).map((n) => ({ offset: n.start - first, pitch: n.pitch, duration: n.duration, velocity: n.velocity }));
}

/** Pasted at the cursor, at the same pitch (ESPEC_PIANO_ROLL.md, 6.1). */
export function pasteAt(clip: readonly ClipNote[], at: number): { pitch: number; start: number; duration: number; velocity: number }[] {
  return clip.map((c) => ({ pitch: c.pitch, start: Math.max(0, at + c.offset), duration: c.duration, velocity: c.velocity }));
}

/** Duplicate: a copy right after the selection, rounded up to the grid when it is on. */
export function duplicateOffset(notes: readonly Note[], grid: GridSetting): number {
  const first = Math.min(...notes.map((n) => n.start));
  const last = Math.max(...notes.map((n) => n.start + n.duration));
  const span = last - first;
  return grid.on ? Math.max(grid.step, Math.ceil(span / grid.step) * grid.step) : span;
}

/** Note before or after the given one in time (Left / Right arrows). */
export function neighbour(notes: readonly Note[], current: Note | null, direction: 1 | -1): Note | null {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  if (sorted.length === 0) return null;
  if (!current) return direction === 1 ? sorted[0]! : sorted.at(-1)!;
  const i = sorted.findIndex((n) => n.id === current.id);
  return sorted[Math.max(0, Math.min(sorted.length - 1, i + direction))] ?? null;
}

/** Velocity from a y position in the velocity lane (bars up to 56 px). */
export function velocityAt(y: number, laneHeight: number, maxBar = 56): number {
  const h = laneHeight - y;
  return Math.max(1, Math.min(127, Math.round((h / maxBar) * 127)));
}

/**
 * A freehand stroke as a value per pixel column: every segment between two mouse positions is
 * filled in, and a later pass over the same column wins. Curves come out as drawn.
 */
export function strokeColumns(points: readonly { x: number; y: number }[], into = new Map<number, number>(), from = 0): Map<number, number> {
  for (let i = Math.max(1, from); i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const x0 = Math.round(a.x);
    const x1 = Math.round(b.x);
    const steps = Math.max(1, Math.abs(x1 - x0));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      into.set(Math.round(x0 + (x1 - x0) * t), a.y + (b.y - a.y) * t);
    }
  }
  if (points.length === 1) into.set(Math.round(points[0]!.x), points[0]!.y);
  return into;
}

/** Pedal spans after drawing a new one: overlapping or touching spans merge. */
export function addPedalSpan(spans: readonly { start: number; end: number }[], add: { start: number; end: number }): { start: number; end: number }[] {
  const all = [...spans, add].filter((p) => p.end > p.start).sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const p of all) {
    const last = out.at(-1);
    if (last && p.start <= last.end) last.end = Math.max(last.end, p.end);
    else out.push({ ...p });
  }
  return out;
}

/** Removes a stretch of time from the pedal: what was pressed there is lifted, splitting spans. */
export function cutPedal(spans: readonly { start: number; end: number }[], from: number, to: number): { start: number; end: number }[] {
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  const out: { start: number; end: number }[] = [];
  for (const p of spans) {
    if (p.end <= a || p.start >= b) out.push({ ...p });
    else {
      if (p.start < a) out.push({ start: p.start, end: a });
      if (p.end > b) out.push({ start: b, end: p.end });
    }
  }
  return out;
}

/** Velocity the eraser gives back to the notes it passes over (MIDI mezzoforte, the pencil's default). */
export const DEFAULT_VELOCITY = 80;

/** Commands that turn `before` into `after` for the same notes (only the fields that changed). */
export function changeCommands(before: readonly Note[], after: readonly Note[]): CommandData[] {
  const changes = after
    .map((a, i) => {
      const b = before[i]!;
      const c: { id: string; pitch?: number; start?: number; duration?: number; velocity?: number } = { id: a.id };
      if (a.pitch !== b.pitch) c.pitch = a.pitch;
      if (a.start !== b.start) c.start = a.start;
      if (a.duration !== b.duration) c.duration = a.duration;
      if (a.velocity !== b.velocity) c.velocity = a.velocity;
      return Object.keys(c).length > 1 ? c : null;
    })
    .filter((c) => c !== null);
  return changes.length ? [{ type: "updateNotes", changes }] : [];
}

/** Tick and pitch under a point, rounded the way the gestures need them. */
export function pointAt(v: RollView, x: number, y: number): { tick: number; pitch: number } {
  return { tick: Math.max(0, xToTick(v, x)), pitch: yToPitch(v, y) };
}
