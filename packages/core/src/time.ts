/**
 * Time in Four Hands (ARQUITECTURA.md, 4.2).
 *
 * - Positions and durations are stored as integer ticks at 960 per quarter note.
 * - Ticks never leave the core: the AI sees "17.3+1/2" and "1/8", the UI sees pixels.
 * - The deviation from the grid is NOT stored. It is computed on read against the
 *   nearest nominal grid (sixteenth or eighth-note triplet, ESQUEMA_MCP.md, 3.1).
 *   Moving a note by a whole number of grid steps therefore keeps its deviation.
 */

/** Ticks per quarter note. Divides the sixteenth (240), eighth triplet (320) and sixteenth triplet (160). */
export const PPQ = 960;

export const SIXTEENTH = PPQ / 4; // 240
export const EIGHTH_TRIPLET = (PPQ / 2) * (2 / 3); // 320

export type NominalGrid = "1/16" | "1/8t";

export interface GridPosition {
  /** The nominal grid line the note belongs to, in ticks. */
  gridTick: number;
  /** Signed distance from that grid line, in ticks. Positive = late. */
  deviationTicks: number;
  /** Which nominal grid the note was snapped to. */
  grid: NominalGrid;
}

function nearestMultiple(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * Finds the nominal grid line closest to `tick`, choosing between the sixteenth
 * and the eighth-note triplet grids. Ties go to the sixteenth.
 */
export function nominalGridPosition(tick: number): GridPosition {
  const g16 = nearestMultiple(tick, SIXTEENTH);
  const g8t = nearestMultiple(tick, EIGHTH_TRIPLET);
  const d16 = tick - g16;
  const d8t = tick - g8t;
  if (Math.abs(d8t) < Math.abs(d16)) {
    return { gridTick: g8t, deviationTicks: d8t, grid: "1/8t" };
  }
  return { gridTick: g16, deviationTicks: d16, grid: "1/16" };
}

/** Deviation expressed in beats (quarter notes) rounded to two decimals, as the compact format shows it. */
export function deviationInBeats(deviationTicks: number): number {
  return Math.round((deviationTicks / PPQ) * 100) / 100;
}
