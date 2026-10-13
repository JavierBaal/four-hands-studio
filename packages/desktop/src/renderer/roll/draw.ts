/**
 * Canvas drawing of the piano roll, the keyboard, the velocity lane and the arrangement lanes
 * (ARQUITECTURA.md, 8), with the colours and sizes of DIRECCION_ARTISTICA.md (2.9, 4, 5).
 */
import { type Meter, type Note, type Song, type Track, barTicks, beatTicks, songEnd } from "@fourhands/core";
import { type NoteNames, isBlack, noteName } from "../music.js";
import { FONT, SIZE, T, velocityOpacity } from "../theme.js";
import { ROW, type RollView, endTick, pitchToY, tickToX } from "./geometry.js";

export interface Surface {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
}

/** Resizes a canvas to its CSS box at the device pixel ratio and returns a context in CSS pixels. */
export function prepare(canvas: HTMLCanvasElement): Surface | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

function visibleRows(v: RollView): { top: number; bottom: number } {
  const top = Math.min(127, 127 - Math.floor(v.scrollY / ROW));
  const bottom = Math.max(0, 127 - Math.floor((v.scrollY + v.height) / ROW));
  return { top, bottom };
}

// ---------------------------------------------------------------------------
// Keyboard

export function drawKeyboard(s: Surface, v: RollView, names: NoteNames): void {
  const { ctx, width } = s;
  const { top, bottom } = visibleRows(v);
  ctx.font = `10px ${FONT.sans}`;
  ctx.textBaseline = "middle";
  for (let p = top; p >= bottom; p--) {
    const y = pitchToY(v, p);
    // As in the sketch: black keys are shorter and leave the background showing on their right.
    ctx.fillStyle = isBlack(p) ? T.bgApp : T.keyWhite;
    ctx.fillRect(0, y, width, ROW);
    if (isBlack(p)) {
      ctx.fillStyle = T.keyBlack;
      ctx.fillRect(0, y, width - SIZE.blackKeyGap, ROW);
      ctx.fillStyle = T.keyBlackLine;
      ctx.fillRect(0, y + ROW - 1, width - SIZE.blackKeyGap, 1);
    } else {
      ctx.fillStyle = T.keyWhiteLine;
      ctx.fillRect(0, y + ROW - 1, width, 1);
    }
    if (p % 12 === 0) {
      ctx.fillStyle = T.keyWhiteText;
      ctx.fillText(noteName(p, names), 6, y + 7.5);
    }
  }
}

// ---------------------------------------------------------------------------
// Grid, notes and playhead

export interface NotesLayer {
  notes: readonly Note[];
  ghosts: ReadonlyArray<{ note: Note; color: string }>;
  selected: ReadonlySet<string>;
  authorship: boolean;
  /** Pitch classes to highlight, or null for the piano's white and black rows. */
  scale: ReadonlySet<number> | null;
  names: NoteNames;
  song: Song;
  /** Time selection band, if any. */
  band: { start: number; end: number } | null;
  playhead: number | null;
  /** Notes added in the last moments (fade-in of the AI's notes), by id → age 0..1. */
  fresh?: ReadonlyMap<string, number>;
  /** Proposal notes (dashed outline), not part of the song. */
  proposal?: readonly Note[];
}

export function drawGrid(s: Surface, v: RollView, meter: Meter, scale: ReadonlySet<number> | null): void {
  const { ctx, width } = s;
  const { top, bottom } = visibleRows(v);
  for (let p = top; p >= bottom; p--) {
    const y = pitchToY(v, p);
    const light = scale ? scale.has(p % 12) : !isBlack(p);
    ctx.fillStyle = light ? T.rowWhite : T.rowBlack;
    ctx.fillRect(0, y, width, ROW);
    if (p % 12 === 0) {
      ctx.fillStyle = T.rowC;
      ctx.fillRect(0, y + ROW - 1, width, 1);
    }
  }
  const beat = beatTicks(meter);
  const bar = barTicks(meter);
  const end = endTick(v);
  const beatPx = beat * v.pxPerTick;
  const first = Math.floor(v.startTick / beat) * beat;
  for (let t = first; t <= end; t += beat) {
    const isBar = t % bar === 0;
    if (!isBar && beatPx < 6) continue;
    ctx.fillStyle = isBar ? T.gridBar : T.gridBeat;
    ctx.fillRect(Math.round(tickToX(v, t)), 0, 1, s.height);
  }
}

function noteFill(note: Note, authorship: boolean): string {
  if (!authorship) return T.authorOff;
  return note.shapedBy.by === "ai" ? T.authorAi : T.authorUser;
}

export function drawNotes(s: Surface, v: RollView, layer: NotesLayer): void {
  const { ctx, width, height } = s;
  const start = v.startTick;
  const end = endTick(v);
  const beat = beatTicks(layer.song.meter);

  if (layer.band) {
    const x0 = tickToX(v, layer.band.start);
    const x1 = tickToX(v, layer.band.end);
    ctx.fillStyle = T.selectBand;
    ctx.fillRect(x0, 0, x1 - x0, height);
    ctx.strokeStyle = T.selectBandLine;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x0) + 0.5, 0);
    ctx.lineTo(Math.round(x0) + 0.5, height);
    ctx.moveTo(Math.round(x1) - 0.5, 0);
    ctx.lineTo(Math.round(x1) - 0.5, height);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Ghosts: other tracks, thin, in their colour.
  for (const { note, color } of layer.ghosts) {
    if (note.start + note.duration < start || note.start > end) continue;
    const y = pitchToY(v, note.pitch);
    if (y < -ROW || y > height) continue;
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = color;
    roundRect(ctx, tickToX(v, note.start), y + 3, Math.max(2, note.duration * v.pxPerTick), SIZE.ghost, 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.font = `10px ${FONT.sans}`;
  ctx.textBaseline = "middle";
  for (const note of layer.notes) {
    if (note.start + note.duration < start || note.start > end) continue;
    const y = pitchToY(v, note.pitch);
    if (y < -ROW || y > height) continue;
    const x = tickToX(v, note.start);
    const w = Math.max(3, note.duration * v.pxPerTick);
    const fade = layer.fresh?.get(note.id);
    ctx.globalAlpha = velocityOpacity(note.velocity) * (fade === undefined ? 1 : fade);
    ctx.fillStyle = noteFill(note, layer.authorship);
    roundRect(ctx, x, y + 1, w, SIZE.note, 3);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (note.duration >= beat * 1.9 && w >= 24) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y + 1, w - 2, SIZE.note);
      ctx.clip();
      ctx.fillStyle = T.textOnLight;
      ctx.fillText(noteName(note.pitch, layer.names, layer.song.key), x + 4, y + 8);
      ctx.restore();
    }
    if (layer.selected.has(note.id)) {
      ctx.strokeStyle = T.selectNote;
      ctx.lineWidth = 2;
      roundRect(ctx, x - 1, y, w + 2, SIZE.note + 2, 4);
      ctx.stroke();
    }
  }

  for (const note of layer.proposal ?? []) {
    const y = pitchToY(v, note.pitch);
    const x = tickToX(v, note.start);
    const w = Math.max(3, note.duration * v.pxPerTick);
    ctx.fillStyle = T.proposalFill;
    roundRect(ctx, x, y + 1, w, SIZE.note, 3);
    ctx.fill();
    ctx.strokeStyle = T.proposalLine;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    roundRect(ctx, x + 0.75, y + 1.75, w - 1.5, SIZE.note - 1.5, 3);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (layer.playhead !== null && layer.playhead >= start && layer.playhead <= end) {
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = T.playhead;
    ctx.fillRect(Math.round(tickToX(v, layer.playhead)) - 1, 0, 2, height);
    ctx.globalAlpha = 1;
  }
  void width;
}

// ---------------------------------------------------------------------------
// Velocity lane

export function drawVelocity(s: Surface, v: RollView, notes: readonly Note[], selected: ReadonlySet<string>, authorship: boolean): void {
  const { ctx, height } = s;
  const start = v.startTick;
  const end = endTick(v);
  for (const note of notes) {
    if (note.start < start - 1 || note.start > end) continue;
    const h = Math.round((note.velocity / 127) * SIZE.velocityMax);
    const x = tickToX(v, note.start);
    ctx.fillStyle = noteFill(note, authorship);
    ctx.globalAlpha = selected.size === 0 || selected.has(note.id) ? 1 : 0.45;
    roundRect(ctx, x - SIZE.velocityBar / 2, height - h, SIZE.velocityBar, h, 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Arrangement: every track in miniature over the whole song

export interface ArrangementLayout {
  /** Height of the sections strip above the lanes (the viewport covers it too). */
  stripHeight: number;
  laneHeight: number;
  /** Ticks shown across the width. */
  totalTicks: number;
  activeTrackId: string | null;
  viewport: { start: number; end: number } | null;
  colors: ReadonlyMap<string, string>;
}

export function arrangementTotal(song: Song): number {
  const bar = barTicks(song.meter);
  return Math.max(16 * bar, Math.ceil(songEnd(song) / bar) * bar);
}

export function drawArrangement(s: Surface, song: Song, tracks: readonly Track[], notesByTrack: ReadonlyMap<string, readonly Note[]>, layout: ArrangementLayout): void {
  const { ctx, width } = s;
  const px = width / layout.totalTicks;
  tracks.forEach((track, i) => {
    const y0 = layout.stripHeight + i * layout.laneHeight;
    if (track.id === layout.activeTrackId) {
      ctx.fillStyle = T.bgCard;
      ctx.fillRect(0, y0, width, layout.laneHeight - 1);
    }
    ctx.fillStyle = T.laneRow;
    ctx.fillRect(0, y0 + layout.laneHeight - 1, width, 1);
    const notes = notesByTrack.get(track.id) ?? [];
    if (notes.length === 0) return;
    let lo = 127;
    let hi = 0;
    for (const n of notes) {
      lo = Math.min(lo, n.pitch);
      hi = Math.max(hi, n.pitch);
    }
    const range = Math.max(hi - lo, 1);
    ctx.fillStyle = layout.colors.get(track.id) ?? T.text2;
    const inner = layout.laneHeight - 1;
    for (const n of notes) {
      const y = y0 + inner * (0.12 + 0.7 * (1 - (n.pitch - lo) / range));
      ctx.fillRect(n.start * px, Math.round(y), Math.max(1.5, n.duration * px - 0.5), 2);
    }
  });
  if (layout.viewport) {
    const x0 = Math.max(0, layout.viewport.start * px);
    const x1 = Math.min(width, layout.viewport.end * px);
    const h = layout.stripHeight + tracks.length * layout.laneHeight;
    ctx.fillStyle = T.viewportFill;
    roundRect(ctx, x0, 0, x1 - x0, h, 3);
    ctx.fill();
    ctx.strokeStyle = T.viewport;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x0 + 0.75, 0.75, x1 - x0 - 1.5, h - 1.5, 3);
    ctx.stroke();
  }
  void song;
}
