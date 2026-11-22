/**
 * Canvas drawing of the piano roll, the keyboard, the velocity lane and the arrangement lanes
 * (docs/architecture.md, 8), with the colours and sizes of docs/design.md (2.9, 4, 5).
 */
import { type Meter, type Note, type Song, type Track, barAt, barStart, barTicks, beatTicks, keyAt, orderedSections, songEnd } from "@fourhands/core";
import { type NoteNames, isBlack, noteName } from "../music.js";
import { FONT, SIZE, T, velocityOpacity } from "../theme.js";
import { type RollView, endTick, pitchToY, rowH, rowMetrics, tickToX } from "./geometry.js";
import { type NoteDrift, curveY } from "./edit.js";

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
  const top = Math.min(127, 127 - Math.floor(v.scrollY / rowH(v)));
  const bottom = Math.max(0, 127 - Math.floor((v.scrollY + v.height) / rowH(v)));
  return { top, bottom };
}

// ---------------------------------------------------------------------------
// Keyboard

/** What the active track's library card says about the keys (05/11/2026). */
export interface KeyboardCard {
  range?: { low: number; high: number };
  keyswitches: ReadonlyArray<{ pitch: number; name: string }>;
}

export function drawKeyboard(s: Surface, v: RollView, names: NoteNames, card?: KeyboardCard): void {
  const { ctx, width } = s;
  const { top, bottom } = visibleRows(v);
  const ROW = rowH(v);
  ctx.font = `${rowMetrics(ROW).font}px ${FONT.sans}`;
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
    const ks = card?.keyswitches.find((k) => k.pitch === p);
    if (p % 12 === 0 && !ks) {
      ctx.fillStyle = T.keyWhiteText;
      ctx.fillText(noteName(p, names), 6, y + ROW / 2);
    }
    if (!card) continue;
    // Library card: keyswitch keys carry their mark and name; keys outside the range dim; a line at each end.
    if (ks) {
      const right = width - (isBlack(p) ? SIZE.blackKeyGap : 0);
      ctx.fillStyle = T.keyswitch;
      ctx.fillRect(right - 6, y + 1, 4, ROW - 2);
      if (ROW >= 10) {
        ctx.fillStyle = isBlack(p) ? T.keyswitchTextOnBlack : T.keyswitchText;
        ctx.fillText(fitText(ctx, ks.name, right - 16), 6, y + ROW / 2);
      }
    } else if (card.range && (p < card.range.low || p > card.range.high)) {
      ctx.fillStyle = T.keyOutOfRange;
      ctx.fillRect(0, y, width, ROW);
    }
    if (card.range && (p === card.range.high || p === card.range.low)) {
      ctx.fillStyle = T.loop;
      ctx.fillRect(0, p === card.range.high ? y : y + ROW - 2, width, 2);
    }
  }
}

/** The text cut with "…" to fit `max` pixels. */
function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

// ---------------------------------------------------------------------------
// Grid, notes and playhead

export interface NotesLayer {
  notes: readonly Note[];
  ghosts: ReadonlyArray<{ note: Note; color: string }>;
  selected: ReadonlySet<string>;
  authorship: boolean;
  /**
   * Colour of the notes with the authorship layer off: the track's own colour (H3.2,
   * 15/10/2026; before, the neutral `--author-off`). Ghosts stay thin and faint, so they still read
   * as the other tracks.
   */
  offColor?: string | undefined;
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
  /** Notes following the mouse away from their snapped place (which shows as a target outline). */
  drift?: ReadonlyMap<string, NoteDrift> | null;
}

export function drawGrid(s: Surface, v: RollView, meter: Meter, scale: ReadonlySet<number> | null): void {
  const { ctx, width } = s;
  const { top, bottom } = visibleRows(v);
  const ROW = rowH(v);
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

function noteFill(note: Note, authorship: boolean, offColor: string = T.authorOff): string {
  if (!authorship) return offColor;
  return note.shapedBy.by === "ai" ? T.authorAi : T.authorUser;
}

export function drawNotes(s: Surface, v: RollView, layer: NotesLayer): void {
  const { ctx, width, height } = s;
  const start = v.startTick;
  const end = endTick(v);
  const beat = beatTicks(layer.song.meter);
  const ROW = rowH(v);
  const M = rowMetrics(ROW);

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
    roundRect(ctx, tickToX(v, note.start), y + (ROW - M.ghost) / 2, Math.max(2, note.duration * v.pxPerTick), M.ghost, 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.font = `${M.font}px ${FONT.sans}`;
  ctx.textBaseline = "middle";
  // Targets first: where notes following the mouse will land.
  if (layer.drift) {
    ctx.lineWidth = 1;
    for (const note of layer.notes) {
      const d = layer.drift.get(note.id);
      if (!d || (Math.abs(d.left) < 1 && Math.abs(d.right) < 1 && Math.abs(d.dy) < 1)) continue;
      const y = pitchToY(v, note.pitch);
      const x = tickToX(v, note.start);
      const w = Math.max(3, note.duration * v.pxPerTick);
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = noteFill(note, layer.authorship, layer.offColor);
      roundRect(ctx, x + 0.5, y + 1.5, w - 1, M.note - 1, 3);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  for (const note of layer.notes) {
    const d = layer.drift?.get(note.id);
    if (note.start + note.duration < start - (d ? Math.abs(d.left) / v.pxPerTick : 0) || note.start > end + (d ? Math.abs(d.right) / v.pxPerTick : 0)) continue;
    const y = pitchToY(v, note.pitch) + (d?.dy ?? 0);
    if (y < -ROW || y > height) continue;
    const x = tickToX(v, note.start) + (d?.left ?? 0);
    const w = Math.max(3, note.duration * v.pxPerTick + (d ? d.right - d.left : 0));
    const fade = layer.fresh?.get(note.id);
    ctx.globalAlpha = velocityOpacity(note.velocity) * (fade === undefined ? 1 : fade);
    ctx.fillStyle = noteFill(note, layer.authorship, layer.offColor);
    roundRect(ctx, x, y + 1, w, M.note, 3);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (note.duration >= beat * 1.9 && w >= 24) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y + 1, w - 2, M.note);
      ctx.clip();
      ctx.fillStyle = T.textOnLight;
      ctx.fillText(noteName(note.pitch, layer.names, keyAt(layer.song, note.start)), x + 4, y + 1 + M.note / 2);
      ctx.restore();
    }
    if (layer.selected.has(note.id)) {
      ctx.strokeStyle = T.selectNote;
      ctx.lineWidth = 2;
      roundRect(ctx, x - 1, y, w + 2, M.note + 2, 4);
      ctx.stroke();
    }
  }

  for (const note of layer.proposal ?? []) {
    const y = pitchToY(v, note.pitch);
    const x = tickToX(v, note.start);
    const w = Math.max(3, note.duration * v.pxPerTick);
    ctx.fillStyle = T.proposalFill;
    roundRect(ctx, x, y + 1, w, M.note, 3);
    ctx.fill();
    ctx.strokeStyle = T.proposalLine;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    roundRect(ctx, x + 0.75, y + 1.75, w - 1.5, M.note - 1.5, 3);
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

export function drawVelocity(s: Surface, v: RollView, notes: readonly Note[], selected: ReadonlySet<string>, authorship: boolean, offColor?: string): void {
  const { ctx, height } = s;
  const start = v.startTick;
  const end = endTick(v);
  for (const note of notes) {
    if (note.start < start - 1 || note.start > end) continue;
    const h = Math.round((note.velocity / 127) * SIZE.velocityMax);
    const x = tickToX(v, note.start);
    ctx.fillStyle = noteFill(note, authorship, offColor);
    ctx.globalAlpha = selected.size === 0 || selected.has(note.id) ? 1 : 0.45;
    roundRect(ctx, x - SIZE.velocityBar / 2, height - h, SIZE.velocityBar, h, 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** The freehand stroke while it is being drawn: what the bars will follow. */
export function drawStroke(s: Surface, points: readonly { x: number; y: number }[]): void {
  const { ctx } = s;
  if (points.length < 1) return;
  ctx.save();
  ctx.strokeStyle = T.text;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  if (points.length === 1) ctx.lineTo(points[0]!.x + 0.1, points[0]!.y);
  ctx.stroke();
  ctx.restore();
}

/** Sustain pedal: each pressed stretch as a band, neutral (the pedal has no author). */
export function drawPedal(s: Surface, v: RollView, spans: readonly { start: number; end: number }[]): void {
  const { ctx, height } = s;
  const top = 16;
  const h = height - 32;
  for (const p of spans) {
    const x0 = tickToX(v, p.start);
    const x1 = tickToX(v, p.end);
    if (x1 < 0 || x0 > s.width) continue;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = T.authorOff;
    roundRect(ctx, x0, top, Math.max(2, x1 - x0), h, 3);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = T.authorOff;
    ctx.fillRect(x0, top, Math.max(2, x1 - x0), 2);
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
  /** Tick at the left edge (arrangement zoom; 0 shows from the start). */
  startTick?: number;
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
  const t0 = layout.startTick ?? 0;
  const X = (tick: number) => (tick - t0) * px;
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
    const color = layout.colors.get(track.id) ?? T.text2;
    {
      // Colour as a surface (H3.2, option C, 15/10/2026): a tinted block for each section where
      // the track plays, or one block from its first to its last bar when the song has no sections.
      for (const [from, to] of trackBlocks(song, notes)) {
        const x0 = X(from) + 1;
        const w = Math.max(2, (to - from) * px - 2);
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = color;
        roundRect(ctx, x0, y0 + 2, w, layout.laneHeight - 5, 3);
        ctx.fill();
        ctx.globalAlpha = 0.7;
        ctx.fillRect(x0, y0 + 2, 2, layout.laneHeight - 5);
        ctx.globalAlpha = 1;
      }
    }
    ctx.fillStyle = color;
    const inner = layout.laneHeight - 1;
    for (const n of notes) {
      const y = y0 + inner * (0.12 + 0.7 * (1 - (n.pitch - lo) / range));
      ctx.fillRect(X(n.start), Math.round(y), Math.max(1.5, n.duration * px - 0.5), 2);
    }
  });
  if (layout.viewport && X(layout.viewport.end) > 0 && X(layout.viewport.start) < width) {
    const x0 = Math.max(0, X(layout.viewport.start));
    const x1 = Math.min(width, X(layout.viewport.end));
    const h = layout.stripHeight + tracks.length * layout.laneHeight;
    ctx.fillStyle = T.viewportFill;
    roundRect(ctx, x0, 0, x1 - x0, h, 3);
    ctx.fill();
    ctx.strokeStyle = T.viewport;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x0 + 0.75, 0.75, x1 - x0 - 1.5, h - 1.5, 3);
    ctx.stroke();
  }
}

/** Tick ranges of the arrangement blocks of a track: the sections where it has notes. */
function trackBlocks(song: Song, notes: readonly Note[]): Array<[number, number]> {
  const sections = orderedSections(song);
  const first = barStart(song.meter, barAt(song.meter, notes[0]!.start));
  const lastNote = notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
  const last = barStart(song.meter, barAt(song.meter, Math.max(0, lastNote - 1)) + 1);
  if (sections.length === 0) return [[first, last]];
  const out: Array<[number, number]> = [];
  for (const sec of sections) {
    const a = barStart(song.meter, sec.startBar);
    const b = barStart(song.meter, sec.endBar + 1);
    if (notes.some((n) => n.start < b && n.start + n.duration > a)) out.push([a, b]);
  }
  return out;
}

/**
 * Expression or modulation curve (H4): a step line (each value holds until the next point) over a
 * soft fill, neutral like the pedal (curves have no author). Without points, a dashed line at the
 * value the track plays with.
 */
export function drawCurve(s: Surface, v: RollView, points: readonly { tick: number; value: number }[], defaultValue: number): void {
  const { ctx, width, height } = s;
  const y = (value: number) => Math.round(curveY(value, height)) + 0.5;
  ctx.save();
  ctx.strokeStyle = T.authorOff;
  ctx.fillStyle = T.authorOff;
  if (!points.length) {
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y(defaultValue));
    ctx.lineTo(width, y(defaultValue));
    ctx.stroke();
    ctx.restore();
    return;
  }
  // From the left edge with the value in force there, then each point.
  let value = defaultValue;
  for (const p of points) {
    if (p.tick > v.startTick) break;
    value = p.value;
  }
  const path: [number, number][] = [[0, y(value)]];
  for (const p of points) {
    const x = tickToX(v, p.tick);
    if (x < 0) continue;
    if (x > width) break;
    path.push([x, path.at(-1)![1]], [x, y(p.value)]);
  }
  path.push([width, path.at(-1)![1]]);
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (const [px, py] of path) ctx.lineTo(px, py);
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  path.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.stroke();
  // The points themselves, when there is room to see them.
  // A dot where the curve starts or turns; inside a ramp the points are too close to tell apart.
  ctx.globalAlpha = 1;
  points.forEach((p, i) => {
    const x = tickToX(v, p.tick);
    if (x < 0 || x > width) return;
    const prev = points[i - 1];
    const next = points[i + 1];
    const near = (q: { tick: number } | undefined) => q !== undefined && Math.abs(tickToX(v, q.tick) - x) < 12;
    if (near(prev) && near(next)) return;
    ctx.beginPath();
    ctx.arc(x, y(p.value), 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}
