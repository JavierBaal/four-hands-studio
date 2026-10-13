/**
 * Piano roll geometry: ticks and pitches to pixels and back. Pure, so the gestures can be tested
 * without a window. Rows are 15 px (DIRECCION_ARTISTICA.md, 4); pitch 127 is the top row.
 */
import { PPQ } from "@fourhands/core";
import { SIZE } from "../theme.js";

export const ROW = SIZE.row;
export const TOTAL_ROWS = 128;
export const CONTENT_HEIGHT = TOTAL_ROWS * ROW;

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
}

export function tickToX(v: RollView, tick: number): number {
  return (tick - v.startTick) * v.pxPerTick;
}

export function xToTick(v: RollView, x: number): number {
  return v.startTick + x / v.pxPerTick;
}

export function pitchToY(v: RollView, pitch: number): number {
  return (127 - pitch) * ROW - v.scrollY;
}

export function yToPitch(v: RollView, y: number): number {
  return 127 - Math.floor((y + v.scrollY) / ROW);
}

export function endTick(v: RollView): number {
  return xToTick(v, v.width);
}

export function clampScrollY(v: RollView, scrollY: number): number {
  return Math.max(0, Math.min(CONTENT_HEIGHT - v.height, scrollY));
}

/** Scroll that puts a pitch range in the middle of the view. */
export function centerOnPitches(v: RollView, low: number, high: number): number {
  const middle = ((127 - high) * ROW + (128 - low) * ROW) / 2;
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
