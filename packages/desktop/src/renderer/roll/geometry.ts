/**
 * Piano roll geometry: ticks and pitches to pixels and back. Pure, so the gestures can be tested
 * without a window. Rows are 15 px by default (DIRECCION_ARTISTICA.md, 4) and change with the
 * vertical zoom; pitch 127 is the top row.
 */
import { PPQ } from "@fourhands/core";
import { SIZE } from "../theme.js";

/** Default row height (DIRECCION_ARTISTICA.md, 4). */
export const ROW = SIZE.row;
export const TOTAL_ROWS = 128;

/**
 * Vertical zoom (Fran, 15/10/2026): a few comfortable row heights, not a free stretch. 15 px is
 * the approved size; 12 shows more octaves, 18–24 give room to read and aim. Beyond 24 a note is
 * taller than it is useful and an octave no longer fits a laptop screen with its context.
 */
export const ROW_STEPS = [12, 15, 18, 21, 24] as const;

export function rowH(v: Pick<RollView, "rowHeight">): number {
  return v.rowHeight ?? ROW;
}

export function contentHeight(v: Pick<RollView, "rowHeight">): number {
  return TOTAL_ROWS * rowH(v);
}

/** The next comfortable row height up (dir 1) or down (-1); stays at the ends. */
export function stepRow(current: number, dir: 1 | -1): number {
  if (dir > 0) return ROW_STEPS.find((r) => r > current + 0.5) ?? ROW_STEPS[ROW_STEPS.length - 1]!;
  return [...ROW_STEPS].reverse().find((r) => r < current - 0.5) ?? ROW_STEPS[0];
}

/** Sizes inside a row, kept in proportion: note, ghost and the note name's font. */
export function rowMetrics(row: number): { note: number; ghost: number; font: number } {
  return { note: row - 2, ghost: Math.max(5, Math.round(row * 0.6)), font: row >= 21 ? 12 : row >= 18 ? 11 : 10 };
}

export type GridValue = "1/1" | "1/2" | "1/4" | "1/8" | "1/16" | "1/4t" | "1/8t" | "1/16t";
export const GRID_VALUES: readonly GridValue[] = ["1/1", "1/2", "1/4", "1/8", "1/16", "1/4t", "1/8t", "1/16t"];

export function gridTicks(value: GridValue): number {
  const triplet = value.endsWith("t");
  const d = Number(value.slice(2, triplet ? -1 : undefined));
  const ticks = (4 * PPQ) / d;
  return triplet ? (ticks * 2) / 3 : ticks;
}

/** What the piano roll shows: a window over time and pitch. */
export interface RollView {
  /** Tick at the left edge. */
  startTick: number;
  pxPerTick: number;
  /** Pixels scrolled from the top of the 128 rows. */
  scrollY: number;
  /** Size of the note area, in CSS pixels. */
  width: number;
  height: number;
  /** Row height in CSS pixels (vertical zoom); 15 if not given. */
  rowHeight?: number;
}

export function tickToX(v: RollView, tick: number): number {
  return (tick - v.startTick) * v.pxPerTick;
}

export function xToTick(v: RollView, x: number): number {
  return v.startTick + x / v.pxPerTick;
}

export function pitchToY(v: RollView, pitch: number): number {
  return (127 - pitch) * rowH(v) - v.scrollY;
}

export function yToPitch(v: RollView, y: number): number {
  return 127 - Math.floor((y + v.scrollY) / rowH(v));
}

export function endTick(v: RollView): number {
  return xToTick(v, v.width);
}

export function clampScrollY(v: RollView, scrollY: number): number {
  return Math.max(0, Math.min(contentHeight(v) - v.height, scrollY));
}

/** Scroll that puts a pitch range in the middle of the view. */
export function centerOnPitches(v: RollView, low: number, high: number): number {
  const middle = ((127 - high) * rowH(v) + (128 - low) * rowH(v)) / 2;
  return clampScrollY(v, middle - v.height / 2);
}

/** Snaps a tick to the grid line at or before it (creating notes: the grid is absolute). */
export function snapFloor(tick: number, step: number): number {
  return Math.floor(tick / step) * step;
}

/** Snaps to the nearest grid line (resizing). */
export function snapNearest(tick: number, step: number): number {
  return Math.round(tick / step) * step;
}

/** Zoom keeping the tick under `anchorX` in place. */
export function zoomAt(v: RollView, factor: number, anchorX: number, limits = { min: 0.004, max: 1.2 }): Pick<RollView, "startTick" | "pxPerTick"> {
  const pxPerTick = Math.max(limits.min, Math.min(limits.max, v.pxPerTick * factor));
  const anchorTick = xToTick(v, anchorX);
  return { pxPerTick, startTick: Math.max(0, anchorTick - anchorX / pxPerTick) };
}

/**
 * Vertical zoom keeping the pitch under `anchorY` in place: the new row height and scroll.
 */
export function zoomRowsAt(v: RollView, rowHeight: number, anchorY: number): { rowHeight: number; scrollY: number } {
  const contentY = (v.scrollY + anchorY) / rowH(v);
  const scrollY = contentY * rowHeight - anchorY;
  return { rowHeight, scrollY: Math.max(0, Math.min(TOTAL_ROWS * rowHeight - v.height, scrollY)) };
}

export const ZOOM_LIMITS = { min: 0.004, max: 1.2 } as const;

/**
 * Zoom tool, rectangle (Fran, 15/10/2026): the time and pitches inside the rectangle fill the view.
 * Time fits exactly; rows take the tallest comfortable step (ROW_STEPS) at which those pitches fit,
 * never more than 24 px, and the pitches are centred.
 */
export function fitRect(v: RollView, x0: number, y0: number, x1: number, y1: number): { startTick: number; pxPerTick: number; rowHeight: number; scrollY: number } {
  const t0 = xToTick(v, Math.min(x0, x1));
  const t1 = xToTick(v, Math.max(x0, x1));
  const pxPerTick = Math.max(ZOOM_LIMITS.min, Math.min(ZOOM_LIMITS.max, v.width / Math.max(1, t1 - t0)));
  const high = Math.min(127, yToPitch(v, Math.min(y0, y1)));
  const low = Math.max(0, yToPitch(v, Math.max(y0, y1)));
  const rows = high - low + 1;
  const rowHeight = [...ROW_STEPS].reverse().find((r) => rows * r <= v.height) ?? ROW_STEPS[0];
  const middle = ((127 - high) * rowHeight + (128 - low) * rowHeight) / 2;
  const scrollY = Math.max(0, Math.min(TOTAL_ROWS * rowHeight - v.height, middle - v.height / 2));
  return { startTick: Math.max(0, t0), pxPerTick, rowHeight, scrollY };
}

/** Zoom tool, click: one step in (or out, with Alt) in time and rows, around the point clicked. */
export function zoomClick(v: RollView, x: number, y: number, out: boolean): { startTick: number; pxPerTick: number; rowHeight: number; scrollY: number } {
  const time = zoomAt(v, out ? 1 / 1.5 : 1.5, x, ZOOM_LIMITS);
  const rows = zoomRowsAt(v, stepRow(rowH(v), out ? -1 : 1), y);
  return { ...time, ...rows };
}
