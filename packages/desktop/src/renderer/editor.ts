/**
 * Editing in the piano roll (ESPEC_PIANO_ROLL.md, 3–7): pointer gestures, actions on the selection
 * and the clipboard. A gesture draws a local preview while it lasts and sends one command list
 * when it ends: one gesture, one undo step (ESPEC, 1.4).
 */
import { type CommandData, type Note, type PedalSpan, type Song, barAt, barStart, barTicks } from "@fourhands/core";
import type { Strings, Translate } from "../shared/i18n.js";
import { activeTrack } from "./context.js";
import { barRange } from "./music.js";
import {
  type ClipNote,
  DRAG_THRESHOLD_PX,
  type GridSetting,
  applyMove,
  changeCommands,
  clampMove,
  duplicateOffset,
  hitTest,
  inRect,
  moveDelta,
  neighbour,
  newNoteAt,
  pasteAt,
  pencilLength,
  pointAt,
  quantize,
  resizeLeft,
  resizeRight,
  toClipboard,
  velocityAt,
  EDGE_PX,
  addPedalSpan,
  strokeColumns,
} from "./roll/edit.js";
import { type GridValue, ROW, type RollView, gridTicks, snapFloor, snapNearest, tickToX, xToTick, yToPitch } from "./roll/geometry.js";
import type { Replica } from "./replica.js";
import type { Tool, ViewStore } from "./view.js";

export interface MenuItem {
  label?: string;
  shortcut?: string;
  header?: boolean;
  separator?: boolean;
  active?: boolean;
  disabled?: boolean;
  run?: () => void;
}

export interface Overlay {
  preview: Map<string, Note> | null;
  hidden: Set<string> | null;
  creating: Note[];
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  menu: { x: number; y: number; items: MenuItem[] } | null;
  quantizeDialog: { x: number; y: number } | null;
  cursor: string;
  /** The freehand stroke being drawn in the velocity or pedal lane, in lane pixels. */
  stroke: { x: number; y: number }[] | null;
  /** Pedal spans as the current gesture would leave them. */
  pedalPreview: PedalSpan[] | null;
}

export interface QuantizeSettings {
  grid: GridValue;
  strength: number;
  ends: boolean;
}

type Mods = { shift: boolean; alt: boolean; mod: boolean };

type Gesture =
  | { kind: "pending"; x0: number; y0: number; mods: Mods; target: Note | null; zone: "body" | "left" | "right" | null; tool: Tool }
  | { kind: "move"; x0: number; y0: number; originals: Note[]; copy: boolean; constrain: "time" | "pitch" | null; lastPitch: number; anchor: Note }
  | { kind: "resize"; x0: number; side: "left" | "right"; originals: Note[] }
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number; add: boolean; base: string[] }
  | { kind: "pencil"; note: Note }
  | { kind: "erase"; ids: Set<string> }
  | { kind: "velocity"; x0: number; y0: number; originals: Note[]; bar: Note | null; height: number; path: { x: number; y: number }[]; columns: Map<number, number> }
  | { kind: "pedal"; mode: "draw" | "start" | "end" | "move"; x0: number; tick0: number; original: PedalSpan[]; index: number }
  | { kind: "loop"; tick0: number; tick1: number };

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = (e: { ctrlKey: boolean; metaKey: boolean }) => (isMac ? e.metaKey : e.ctrlKey);
export const modLabel = isMac ? "Cmd" : "Ctrl";

function loadQuantize(): QuantizeSettings {
  try {
    const saved = JSON.parse(localStorage.getItem("fh.quantize") ?? "null") as QuantizeSettings | null;
    if (saved && typeof saved.strength === "number") return saved;
  } catch {
    /* no storage */
  }
  return { grid: "1/16", strength: 1, ends: false };
}

export class Editor {
  overlay: Overlay = { preview: null, hidden: null, creating: [], marquee: null, menu: null, quantizeDialog: null, cursor: "default", stroke: null, pedalPreview: null };
  version = 0;
  v: RollView = { startTick: 0, pxPerTick: 0.02, scrollY: 0, width: 0, height: 0 };
  quantizeSettings: QuantizeSettings = loadQuantize();
  /** Sounds a note on the active track (set by the audio layer, H2.4). */
  audition: (pitch: number, velocity: number) => void = () => {};
  private gesture: Gesture | null = null;
  private clipboard: ClipNote[] = [];
  private lastVelocity = 80;
  private listeners = new Set<() => void>();

  constructor(
    private readonly replica: Replica,
    private readonly view: ViewStore,
    private readonly t: Translate,
  ) {}

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = (): number => this.version;

  private set(changes: Partial<Overlay>): void {
    this.overlay = { ...this.overlay, ...changes };
    this.version++;
    for (const l of this.listeners) l();
  }

  // -------------------------------------------------------------------------
  // What the gestures work on

  private get song(): Song {
    return this.replica.song;
  }

  private trackId(): string | null {
    return activeTrack(this.song)?.id ?? null;
  }

  /** Notes of the active track, ordered (the order they are drawn in). */
  ownNotes(): Note[] {
    const id = this.trackId();
    return Object.values(this.song.notes)
      .filter((n) => n.trackId === id)
      .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  }

  private selected(): Note[] {
    const id = this.trackId();
    return this.song.context.selection.map((s) => this.song.notes[s]).filter((n): n is Note => n !== undefined && n.trackId === id);
  }

  private grid(): GridSetting {
    const s = this.view.state;
    return { on: s.gridOn, step: gridTicks(s.grid) };
  }

  private tool(mods: Mods): Tool {
    const s = this.view.state;
    return s.tool === "arrow" && mods.mod ? "pencil" : s.tool;
  }

  private select(ids: string[]): void {
    void this.replica.setContext({ selection: ids });
  }

  private label(kind: string, notes: readonly { start: number; duration: number }[]): string {
    const n = notes.length;
    const start = Math.min(...notes.map((x) => x.start));
    const end = Math.max(...notes.map((x) => x.start + x.duration));
    const bars = barRange(this.song.meter, start, end);
    const key = `h${kind}${n === 1 ? "One" : "Many"}` as keyof Strings;
    return this.t(key, { n, bars });
  }

  private async run(label: string, commands: CommandData[]): Promise<(string[] | string | null)[] | null> {
    const reply = await this.replica.run(label, commands);
    return reply.ok ? reply.results : null;
  }

  // -------------------------------------------------------------------------
  // Pointer on the notes

  pointerDown(x: number, y: number, button: number, mods: Mods): void {
    if (this.overlay.menu || this.overlay.quantizeDialog) this.set({ menu: null, quantizeDialog: null });
    if (button !== 0) return;
    const tool = this.tool(mods);
    const hit = hitTest(this.ownNotes(), this.v, x, y);
    const selectedIds = new Set(this.song.context.selection);

    if (tool === "eraser") {
      const ids = hit ? (selectedIds.has(hit.note.id) ? [...selectedIds] : [hit.note.id]) : [];
      this.gesture = { kind: "erase", ids: new Set(ids) };
      this.set({ hidden: new Set(ids) });
      return;
    }

    if (hit) {
      if (mods.shift && hit.zone === "body") {
        const next = selectedIds.has(hit.note.id) ? [...selectedIds].filter((i) => i !== hit.note.id) : [...selectedIds, hit.note.id];
        this.select(next);
      } else if (!selectedIds.has(hit.note.id)) {
        this.select([hit.note.id]);
      }
      if (hit.zone === "body") this.audition(hit.note.pitch, hit.note.velocity);
      this.gesture = { kind: "pending", x0: x, y0: y, mods, target: hit.note, zone: hit.zone, tool };
      return;
    }

    if (tool === "pencil") {
      const id = this.trackId();
      if (!id) return;
      const { tick, pitch } = pointAt(this.v, x, y);
      const spec = newNoteAt(tick, pitch, this.grid(), this.lastVelocity);
      const note = this.draftNote(spec);
      this.gesture = { kind: "pencil", note };
      this.audition(note.pitch, note.velocity);
      this.set({ creating: [note] });
      return;
    }

    this.gesture = { kind: "pending", x0: x, y0: y, mods, target: null, zone: null, tool };
  }

  private draftNote(spec: { pitch: number; start: number; duration: number; velocity: number }): Note {
    return { id: "new", trackId: this.trackId() ?? "", ...spec, createdBy: { by: "user" }, shapedBy: { by: "user" } };
  }

  pointerMove(x: number, y: number, mods: Mods): void {
    const g = this.gesture;
    if (!g) {
      this.updateCursor(x, y, mods);
      return;
    }
    if (g.kind === "pending") {
      if (Math.hypot(x - g.x0, y - g.y0) <= DRAG_THRESHOLD_PX) return;
      this.startDrag(g, x, y);
      this.pointerMove(x, y, mods);
      return;
    }
    switch (g.kind) {
      case "move": {
        const dx = x - g.x0;
        const dy = y - g.y0;
        if (mods.shift && g.constrain === null) g.constrain = Math.abs(dx) >= Math.abs(dy) ? "time" : "pitch";
        if (!mods.shift) g.constrain = null;
        const d = clampMove(g.originals, moveDelta(dx / this.v.pxPerTick, -dy / ROW, this.grid(), g.constrain));
        const moved = applyMove(g.originals, d);
        const anchorPitch = g.anchor.pitch + d.semitones;
        if (anchorPitch !== g.lastPitch) {
          g.lastPitch = anchorPitch;
          this.audition(anchorPitch, g.anchor.velocity);
        }
        if (g.copy) this.set({ creating: moved.map((n, i) => ({ ...n, id: `copy${i}` })) });
        else this.set({ preview: new Map(moved.map((n) => [n.id, n])) });
        return;
      }
      case "resize": {
        const dTicks = (x - g.x0) / this.v.pxPerTick;
        const grid = this.grid();
        const out = g.originals.map((n) =>
          g.side === "right" ? resizeRight(n, n.start + n.duration + dTicks, grid) : resizeLeft(n, n.start + dTicks, grid),
        );
        this.set({ preview: new Map(out.map((n) => [n.id, n])) });
        return;
      }
      case "marquee": {
        g.x1 = x;
        g.y1 = y;
        this.set({ marquee: { x0: g.x0, y0: g.y0, x1: x, y1: y } });
        return;
      }
      case "pencil": {
        const end = xToTick(this.v, x);
        const note = { ...g.note, duration: pencilLength(g.note.start, end, this.grid()) };
        g.note = note;
        this.set({ creating: [note] });
        return;
      }
      case "erase": {
        const hit = hitTest(this.ownNotes(), this.v, x, y);
        if (hit && !g.ids.has(hit.note.id)) {
          g.ids.add(hit.note.id);
          this.set({ hidden: new Set(g.ids) });
        }
        return;
      }
      default:
        return;
    }
  }

  private startDrag(g: Extract<Gesture, { kind: "pending" }>, x: number, y: number): void {
    if (g.target && (g.zone === "left" || g.zone === "right")) {
      const sel = this.selected();
      const originals = sel.some((n) => n.id === g.target!.id) ? sel : [g.target];
      this.gesture = { kind: "resize", x0: g.x0, side: g.zone, originals };
      return;
    }
    if (g.target) {
      const sel = this.selected();
      const originals = sel.some((n) => n.id === g.target!.id) ? sel : [g.target];
      this.gesture = { kind: "move", x0: g.x0, y0: g.y0, originals, copy: g.mods.alt, constrain: null, lastPitch: g.target.pitch, anchor: g.target };
      return;
    }
    this.gesture = { kind: "marquee", x0: g.x0, y0: g.y0, x1: x, y1: y, add: g.mods.shift, base: g.mods.shift ? [...this.song.context.selection] : [] };
  }

  pointerUp(x: number, y: number): void {
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    const clear = { preview: null, hidden: null, creating: [], marquee: null, stroke: null, pedalPreview: null };
    switch (g.kind) {
      case "pending":
        // A click on an empty spot clears the selection; a click on a note was handled on press.
        if (!g.target && !g.mods.shift) this.select([]);
        break;
      case "move": {
        const dx = x - g.x0;
        const dy = y - g.y0;
        const d = clampMove(g.originals, moveDelta(dx / this.v.pxPerTick, -dy / ROW, this.grid(), g.constrain));
        if (d.ticks === 0 && d.semitones === 0) break;
        const moved = applyMove(g.originals, d);
        const trackId = this.trackId();
        if (g.copy && trackId) {
          void this.run(this.label("Copy", moved), [
            { type: "addNotes", trackId, notes: moved.map(({ pitch, start, duration, velocity }) => ({ pitch, start, duration, velocity })) },
          ]).then((r) => r && this.select(r[0] as string[]));
        } else {
          void this.run(this.label("Move", moved), [{ type: "moveNotes", ids: g.originals.map((n) => n.id), ticks: d.ticks, semitones: d.semitones }]);
        }
        break;
      }
      case "resize": {
        const after = g.originals.map((n) => this.overlay.preview?.get(n.id) ?? n);
        const commands = changeCommands(g.originals, after);
        if (commands.length) void this.run(this.label("Resize", after), commands);
        break;
      }
      case "marquee": {
        const touched = inRect(this.ownNotes(), this.v, g).map((n) => n.id);
        this.select([...new Set([...g.base, ...touched])]);
        break;
      }
      case "pencil":
        this.createNotes([g.note]);
        break;
      case "erase":
        if (g.ids.size > 0) this.deleteIds([...g.ids]);
        break;
      case "velocity": {
        const after = g.originals.map((n) => this.overlay.preview?.get(n.id) ?? n);
        const commands = changeCommands(g.originals, after);
        const changed = after.filter((n, i) => n.velocity !== g.originals[i]!.velocity);
        if (commands.length) {
          this.lastVelocity = changed.at(-1)?.velocity ?? this.lastVelocity;
          void this.run(this.label("Velocity", changed), commands);
        }
        break;
      }
      case "pedal": {
        const trackId = this.trackId();
        const after = this.overlay.pedalPreview;
        if (trackId && after && JSON.stringify(after) !== JSON.stringify(g.original)) {
          const name = this.song.tracks[trackId]?.name ?? "";
          void this.run(this.t("hPedal", { name }), [{ type: "setPedal", trackId, spans: after }]);
        }
        break;
      }
      case "loop":
        break;
    }
    this.set(clear);
  }

  /** Esc: cancels the gesture in progress, or clears the selection. */
  escape(): void {
    if (this.overlay.menu || this.overlay.quantizeDialog) {
      this.set({ menu: null, quantizeDialog: null });
      return;
    }
    if (this.gesture) {
      this.gesture = null;
      this.set({ preview: null, hidden: null, creating: [], marquee: null });
      return;
    }
    this.select([]);
  }

  doubleClick(x: number, y: number): void {
    if (this.view.state.tool !== "arrow") return;
    const hit = hitTest(this.ownNotes(), this.v, x, y);
    if (hit) return; // double click on a note: nothing destructive (ESPEC, choque A)
    // On a ghost: make its track the active one.
    const pitch = yToPitch(this.v, y);
    const tick = xToTick(this.v, x);
    const ghost = Object.values(this.song.notes).find(
      (n) => n.trackId !== this.trackId() && n.pitch === pitch && n.start <= tick && n.start + n.duration >= tick && !this.song.tracks[n.trackId]?.mute,
    );
    if (ghost) {
      void this.replica.setContext({ activeTrackId: ghost.trackId, selection: [ghost.id] });
      return;
    }
    const { tick: at, pitch: p } = pointAt(this.v, x, y);
    const spec = newNoteAt(at, p, this.grid(), this.lastVelocity);
    this.audition(spec.pitch, spec.velocity);
    this.createNotes([this.draftNote(spec)]);
  }

  private createNotes(notes: Note[]): void {
    const trackId = this.trackId();
    if (!trackId || notes.length === 0) return;
    this.lastVelocity = notes.at(-1)!.velocity;
    void this.run(this.label("Create", notes), [
      { type: "addNotes", trackId, notes: notes.map(({ pitch, start, duration, velocity }) => ({ pitch, start, duration, velocity })) },
    ]).then((r) => r && this.select(r[0] as string[]));
  }

  private deleteIds(ids: string[], kind = "Delete"): void {
    const notes = ids.map((i) => this.song.notes[i]).filter((n): n is Note => n !== undefined);
    if (notes.length === 0) return;
    void this.run(this.label(kind, notes), [{ type: "deleteNotes", ids: notes.map((n) => n.id) }]);
  }

  private updateCursor(x: number, y: number, mods: Mods): void {
    const tool = this.tool(mods);
    let cursor = "default";
    if (tool === "pencil") cursor = "crosshair";
    else if (tool === "eraser") cursor = "not-allowed";
    const hit = hitTest(this.ownNotes(), this.v, x, y);
    if (hit && tool !== "eraser") cursor = hit.zone === "body" ? "move" : "ew-resize";
    if (cursor !== this.overlay.cursor) this.set({ cursor });
  }

  // -------------------------------------------------------------------------
  // Velocity lane (ESPEC_PIANO_ROLL.md, 7)

  velocityDown(x: number, y: number, height: number, mods: Mods): void {
    const own = this.ownNotes();
    const sel = this.selected();
    const pool = sel.length > 0 ? sel : own;
    // A bar is grabbed by its head (the top 8 px); anywhere else starts a freehand stroke, so dense
    // passages can still be drawn over.
    const head = (n: Note) => height - (n.velocity / 127) * 56;
    const bar = pool.find((n) => Math.abs(tickToX(this.v, n.start) - x) <= 4 && Math.abs(y - head(n)) <= 8) ?? null;
    const originals = bar && sel.some((n) => n.id === bar.id) ? sel : bar ? [bar] : pool;
    this.gesture = { kind: "velocity", x0: x, y0: y, originals, bar, height, path: [{ x, y }], columns: new Map() };
    this.velocityMove(x, y, mods);
  }

  /**
   * Dragging a bar moves it (and the rest of the selection by the same amount). Starting away from
   * the bars draws freehand: every bar under the stroke takes its value, so curves come out as drawn.
   * Shift draws a straight line from where the stroke started.
   */
  velocityMove(x: number, y: number, mods: Mods): void {
    const g = this.gesture;
    if (!g || g.kind !== "velocity") return;
    let out: Note[];
    if (g.bar) {
      const target = velocityAt(y, g.height);
      const delta = target - g.bar.velocity;
      out = g.originals.map((n) => ({ ...n, velocity: Math.max(1, Math.min(127, n === g.bar ? target : n.velocity + delta)) }));
      this.set({ preview: new Map(out.map((n) => [n.id, n])) });
      return;
    }
    let path: { x: number; y: number }[];
    let columns: Map<number, number>;
    if (mods.shift) {
      path = [g.path[0]!, { x, y }];
      columns = strokeColumns(path);
    } else {
      g.path.push({ x, y });
      strokeColumns(g.path, g.columns, g.path.length - 1);
      path = g.path;
      columns = g.columns;
    }
    out = g.originals.map((n) => {
      const value = columns.get(Math.round(tickToX(this.v, n.start)));
      return value === undefined ? n : { ...n, velocity: velocityAt(value, g.height) };
    });
    this.set({ preview: new Map(out.map((n) => [n.id, n])), stroke: [...path] });
  }

  // -------------------------------------------------------------------------
  // Pedal lane (ESPEC_PIANO_ROLL.md, 7): drag on empty space draws a pressed stretch; drag an edge
  // to move it; drag the middle to move the whole stretch; double click removes it.

  private pedalSpans(): PedalSpan[] {
    const id = this.trackId();
    return id ? (this.song.tracks[id]?.pedal ?? []).map((p) => ({ ...p })) : [];
  }

  /** Which stretch and which part is under x (6 px edges, like the notes). */
  pedalHit(x: number): { index: number; part: "start" | "end" | "move" } | null {
    const spans = this.pedalSpans();
    for (let i = spans.length - 1; i >= 0; i--) {
      const a = tickToX(this.v, spans[i]!.start);
      const b = tickToX(this.v, spans[i]!.end);
      if (x < a - 3 || x > b + 3) continue;
      if (Math.abs(x - a) <= EDGE_PX) return { index: i, part: "start" };
      if (Math.abs(x - b) <= EDGE_PX) return { index: i, part: "end" };
      return { index: i, part: "move" };
    }
    return null;
  }

  pedalDown(x: number): void {
    const original = this.pedalSpans();
    const hit = this.pedalHit(x);
    const tick = Math.max(0, xToTick(this.v, x));
    this.gesture = { kind: "pedal", mode: hit ? hit.part : "draw", x0: x, tick0: tick, original, index: hit?.index ?? -1 };
    this.pedalMove(x);
  }

  pedalMove(x: number): void {
    const g = this.gesture;
    if (!g || g.kind !== "pedal") {
      const hit = this.pedalHit(x);
      const cursor = hit ? (hit.part === "move" ? "move" : "ew-resize") : "crosshair";
      if (cursor !== this.overlay.cursor) this.set({ cursor });
      return;
    }
    const grid = this.grid();
    const snap = (t: number) => Math.max(0, grid.on ? snapNearest(t, grid.step) : Math.round(t));
    const tick = xToTick(this.v, x);
    const spans = g.original.map((p) => ({ ...p }));
    if (g.mode === "draw") {
      const a = snap(Math.min(g.tick0, tick));
      const b = snap(Math.max(g.tick0, tick));
      this.set({ pedalPreview: b > a ? addPedalSpan(spans, { start: a, end: b }) : spans });
      return;
    }
    const span = spans[g.index]!;
    const others = spans.filter((_, i) => i !== g.index);
    const min = grid.on ? grid.step : 10;
    if (g.mode === "start") span.start = Math.min(snap(tick), span.end - min);
    else if (g.mode === "end") span.end = Math.max(snap(tick), span.start + min);
    else {
      const d = snap(g.original[g.index]!.start + (tick - g.tick0)) - g.original[g.index]!.start;
      span.start = Math.max(0, g.original[g.index]!.start + d);
      span.end = span.start + (g.original[g.index]!.end - g.original[g.index]!.start);
    }
    this.set({ pedalPreview: others.reduce((acc, p) => addPedalSpan(acc, p), [span]) });
  }

  pedalDoubleClick(x: number): void {
    const hit = this.pedalHit(x);
    const trackId = this.trackId();
    if (!hit || !trackId) return;
    const spans = this.pedalSpans().filter((_, i) => i !== hit.index);
    void this.run(this.t("hPedal", { name: this.song.tracks[trackId]?.name ?? "" }), [{ type: "setPedal", trackId, spans }]);
  }

  // -------------------------------------------------------------------------
  // Bar ruler: click places the cursor, drag draws the loop (in whole bars)

  rulerDown(x: number): void {
    const tick = Math.max(0, xToTick(this.v, x));
    this.gesture = { kind: "loop", tick0: tick, tick1: tick };
  }

  rulerMove(x: number): void {
    const g = this.gesture;
    if (!g || g.kind !== "loop") return;
    g.tick1 = Math.max(0, xToTick(this.v, x));
    const meter = this.song.meter;
    const a = barStart(meter, barAt(meter, Math.min(g.tick0, g.tick1)));
    const b = barStart(meter, barAt(meter, Math.max(g.tick0, g.tick1)) + 1);
    if (Math.abs(tickToX(this.v, g.tick1) - tickToX(this.v, g.tick0)) > DRAG_THRESHOLD_PX) void this.replica.setContext({ loop: { start: a, end: b } });
  }

  rulerUp(x: number): void {
    const g = this.gesture;
    this.gesture = null;
    if (!g || g.kind !== "loop") return;
    if (Math.abs(x - tickToX(this.v, g.tick0)) <= DRAG_THRESHOLD_PX) {
      const grid = this.grid();
      const tick = grid.on ? snapFloor(g.tick0, grid.step) : Math.round(g.tick0);
      void this.replica.setContext({ cursor: tick });
    }
  }

  clearLoop(): void {
    void this.replica.setContext({ loop: null });
  }

  // -------------------------------------------------------------------------
  // Actions on the selection (keyboard, menus)

  private targets(fallback?: Note | null): Note[] {
    const sel = this.selected();
    return sel.length > 0 ? sel : fallback ? [fallback] : [];
  }

  deleteSelection(fallback?: Note | null): void {
    this.deleteIds(this.targets(fallback).map((n) => n.id));
  }

  copy(fallback?: Note | null): void {
    const notes = this.targets(fallback);
    if (notes.length) this.clipboard = toClipboard(notes);
  }

  cut(fallback?: Note | null): void {
    const notes = this.targets(fallback);
    if (!notes.length) return;
    this.clipboard = toClipboard(notes);
    this.deleteIds(notes.map((n) => n.id), "Cut");
  }

  paste(): void {
    const trackId = this.trackId();
    if (!trackId || this.clipboard.length === 0) return;
    const specs = pasteAt(this.clipboard, this.song.context.cursor);
    void this.run(this.label("Paste", specs), [{ type: "addNotes", trackId, notes: specs }]).then((r) => r && this.select(r[0] as string[]));
  }

  duplicate(fallback?: Note | null): void {
    const notes = this.targets(fallback);
    const trackId = this.trackId();
    if (!notes.length || !trackId) return;
    const offset = duplicateOffset(notes, this.grid());
    const specs = notes.map((n) => ({ pitch: n.pitch, start: n.start + offset, duration: n.duration, velocity: n.velocity }));
    void this.run(this.label("Duplicate", specs), [{ type: "addNotes", trackId, notes: specs }]).then((r) => r && this.select(r[0] as string[]));
  }

  selectAll(): void {
    this.select(this.ownNotes().map((n) => n.id));
  }

  selectPitch(pitch: number): void {
    this.select(this.ownNotes().filter((n) => n.pitch === pitch).map((n) => n.id));
  }

  transpose(semitones: number, fallback?: Note | null): void {
    const notes = this.targets(fallback);
    if (!notes.length) return;
    const d = clampMove(notes, { ticks: 0, semitones });
    if (d.semitones === 0) return;
    void this.run(this.label("Transpose", notes), [{ type: "moveNotes", ids: notes.map((n) => n.id), semitones: d.semitones }]);
    if (notes.length === 1) this.audition(notes[0]!.pitch + d.semitones, notes[0]!.velocity);
  }

  /** Alt + arrows: one grid step, keeping each note's deviation. */
  nudge(direction: 1 | -1): void {
    const notes = this.selected();
    if (!notes.length) return;
    const d = clampMove(notes, { ticks: direction * this.grid().step, semitones: 0 });
    if (d.ticks === 0) return;
    void this.run(this.label("Move", applyMove(notes, d)), [{ type: "moveNotes", ids: notes.map((n) => n.id), ticks: d.ticks }]);
  }

  selectNeighbour(direction: 1 | -1): void {
    const sel = this.selected();
    const current = direction === 1 ? sel.at(-1) : sel[0];
    const next = neighbour(this.ownNotes(), current ?? null, direction);
    if (!next) return;
    this.select([next.id]);
    this.audition(next.pitch, next.velocity);
  }

  quantizeSelection(settings: QuantizeSettings = this.quantizeSettings, fallback?: Note | null): void {
    const notes = this.targets(fallback);
    if (!notes.length) return;
    const after = quantize(notes, gridTicks(settings.grid), settings.strength, settings.ends);
    const commands = changeCommands(notes, after);
    if (commands.length) void this.run(this.label("Quantize", after), commands);
  }

  setQuantizeSettings(settings: QuantizeSettings): void {
    this.quantizeSettings = settings;
    try {
      localStorage.setItem("fh.quantize", JSON.stringify(settings));
    } catch {
      /* no storage */
    }
  }

  openQuantizeDialog(x: number, y: number): void {
    this.set({ menu: null, quantizeDialog: { x, y } });
  }

  closeMenus(): void {
    this.set({ menu: null, quantizeDialog: null });
  }

  // -------------------------------------------------------------------------
  // Menus

  /** Right click: tools on top, then actions on the selection or the note under the mouse. Never deletes. */
  contextMenu(x: number, y: number, clientX: number, clientY: number): void {
    this.gesture = null;
    const hit = hitTest(this.ownNotes(), this.v, x, y)?.note ?? null;
    const pitch = yToPitch(this.v, y);
    const t = this.t;
    const tool = this.view.state.tool;
    const has = this.targets(hit).length > 0;
    const setTool = (tool: Tool) => () => this.view.set({ tool });
    const close = (fn: () => void) => () => {
      this.closeMenus();
      fn();
    };
    const items: MenuItem[] = [
      { label: t("ctxTools"), header: true },
      { label: t("arrow"), shortcut: "1", active: tool === "arrow", run: close(setTool("arrow")) },
      { label: t("pencil"), shortcut: "2", active: tool === "pencil", run: close(setTool("pencil")) },
      { label: t("eraser"), shortcut: "3", active: tool === "eraser", run: close(setTool("eraser")) },
      { separator: true },
      { label: t("ctxCut"), shortcut: `${modLabel}+X`, disabled: !has, run: close(() => this.cut(hit)) },
      { label: t("ctxCopy"), shortcut: `${modLabel}+C`, disabled: !has, run: close(() => this.copy(hit)) },
      { label: t("ctxPaste"), shortcut: `${modLabel}+V`, disabled: this.clipboard.length === 0, run: close(() => this.paste()) },
      { label: t("ctxDuplicate"), shortcut: `${modLabel}+D`, disabled: !has, run: close(() => this.duplicate(hit)) },
      { label: t("ctxDelete"), shortcut: t("keyDelete"), disabled: !has, run: close(() => this.deleteSelection(hit)) },
      { separator: true },
      { label: t("ctxQuantize"), shortcut: "Q", disabled: !has, run: () => this.openQuantizeDialog(clientX, clientY) },
      { label: t("ctxOctaveUp"), shortcut: `${t("keyShift")}+↑`, disabled: !has, run: close(() => this.transpose(12, hit)) },
      { label: t("ctxOctaveDown"), shortcut: `${t("keyShift")}+↓`, disabled: !has, run: close(() => this.transpose(-12, hit)) },
      { label: t("ctxSelectPitch"), run: close(() => this.selectPitch(pitch)) },
    ];
    this.set({ menu: { x: clientX, y: clientY, items } });
  }

  gridMenu(clientX: number, clientY: number): void {
    const s = this.view.state;
    const values: GridValue[] = ["1/1", "1/2", "1/4", "1/8", "1/16", "1/4t", "1/8t", "1/16t"];
    const items: MenuItem[] = [
      { label: this.t("gridActive"), shortcut: "N", active: s.gridOn, run: () => (this.view.set({ gridOn: !this.view.state.gridOn }), this.closeMenus()) },
      { separator: true },
      { label: this.t("gridValues"), header: true },
      ...values.map((g) => ({ label: g, active: s.gridOn && s.grid === g, run: () => (this.view.set({ grid: g, gridOn: true }), this.closeMenus()) })),
    ];
    this.set({ menu: { x: clientX, y: clientY, items } });
  }

  /** Notes being recorded, drawn while the take lasts. */
  showDraft(notes: Note[]): void {
    if (this.gesture) return;
    this.set({ creating: notes });
  }

  /** Length of one bar, for scrolling by bars. */
  barLength(): number {
    return barTicks(this.song.meter);
  }
}
