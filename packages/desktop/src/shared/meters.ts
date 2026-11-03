/**
 * The console's meters (F2.2 parte B, 03/11/2026): what the engine measured since the last reading
 * (linear peak and RMS per strip) turned into what the eye reads, as the DAWs do:
 * - the bar (RMS) rises at once and falls about 20 dB a second;
 * - the peak line holds 1.5 s, then falls at the same speed;
 * - the clip light stays on until it is clicked.
 * Pure: the console calls it about 30 times a second with the time.
 */

export const METER_FLOOR_DB = -60;
/** How fast a bar and a released peak fall. */
export const FALL_DB_PER_S = 20;
export const PEAK_HOLD_MS = 1500;

export interface MeterState {
  /** The bar (RMS), in dB, METER_FLOOR_DB for silence. */
  rmsDb: number;
  /** The peak line, in dB. */
  peakDb: number;
  /** When the peak line was last pushed up. */
  peakAt: number;
  clip: boolean;
}

export const SILENT_METER: MeterState = { rmsDb: METER_FLOOR_DB, peakDb: METER_FLOOR_DB, peakAt: 0, clip: false };

function toDb(linear: number): number {
  return linear > 0 ? Math.max(METER_FLOOR_DB, 20 * Math.log10(linear)) : METER_FLOOR_DB;
}

/**
 * The next state of one meter. `reading` is what the engine measured since the last call (null:
 * nothing came, it only falls). `now` and `last` in milliseconds.
 */
export function stepMeter(prev: MeterState, reading: { peak: number; rms: number; clips: number } | null, now: number, last: number): MeterState {
  const fall = (FALL_DB_PER_S * Math.max(0, now - last)) / 1000;
  const rmsIn = reading ? toDb(reading.rms) : METER_FLOOR_DB;
  const peakIn = reading ? toDb(reading.peak) : METER_FLOOR_DB;
  const rmsDb = Math.max(rmsIn, prev.rmsDb - fall, METER_FLOOR_DB);
  let peakDb = prev.peakDb;
  let peakAt = prev.peakAt;
  if (peakIn >= peakDb) {
    peakDb = peakIn;
    peakAt = now;
  } else if (now - peakAt > PEAK_HOLD_MS) {
    peakDb = Math.max(peakIn, peakDb - fall, METER_FLOOR_DB);
  }
  // A sample above 0 dBFS counts (the engine counts them), or a peak that reaches it.
  const clip = prev.clip || (!!reading && (reading.clips > 0 || reading.peak > 1));
  return { rmsDb, peakDb, peakAt, clip };
}

/**
 * One scale for the fader and the meter, as in the DAWs: from −24 to +6 dB takes the top 70 % of
 * the travel (where mixing happens), from −60 to −24 the bottom 30 %. 0 to 1, bottom to top.
 */
export function meterFrac(db: number): number {
  if (!Number.isFinite(db) || db <= METER_FLOOR_DB) return 0;
  const f = db >= -24 ? 0.3 + ((Math.min(db, 6) + 24) / 30) * 0.7 : ((db + 60) / 36) * 0.3;
  return Math.max(0, Math.min(1, f));
}

/** The dB at a point of that scale (the inverse of meterFrac), for dragging the fader. */
export function fracToDb(f: number): number {
  const x = Math.max(0, Math.min(1, f));
  if (x <= 0) return -Infinity;
  return x >= 0.3 ? ((x - 0.3) / 0.7) * 30 - 24 : (x / 0.3) * 36 - 60;
}
