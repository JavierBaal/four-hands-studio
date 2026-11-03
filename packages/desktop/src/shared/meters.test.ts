import { describe, expect, it } from "vitest";
import { METER_FLOOR_DB, PEAK_HOLD_MS, SILENT_METER, fracToDb, meterFrac, stepMeter } from "./meters.js";

const half = { peak: 0.5, rms: 0.1, clips: 0 }; // −6 dB peak, −20 dB RMS

describe("the console's meters (F2.2 parte B)", () => {
  it("rise at once and fall about 20 dB a second", () => {
    const up = stepMeter(SILENT_METER, half, 1000, 967);
    expect(up.rmsDb).toBeCloseTo(-20, 5);
    expect(up.peakDb).toBeCloseTo(-6.02, 1);
    const down = stepMeter(up, null, 1500, 1000);
    expect(down.rmsDb).toBeCloseTo(-30, 5);
    // Never below the floor.
    expect(stepMeter(down, null, 9000, 1500).rmsDb).toBe(METER_FLOOR_DB);
  });

  it("hold the peak 1.5 s, then let it fall", () => {
    let m = stepMeter(SILENT_METER, half, 0, 0);
    m = stepMeter(m, { peak: 0.01, rms: 0.01, clips: 0 }, PEAK_HOLD_MS - 10, 0);
    expect(m.peakDb).toBeCloseTo(-6.02, 1);
    m = stepMeter(m, null, PEAK_HOLD_MS + 500, PEAK_HOLD_MS - 10);
    expect(m.peakDb).toBeLessThan(-6.02 - 9);
  });

  it("keep the clip light until it is reset", () => {
    const hot = stepMeter(SILENT_METER, { peak: 1.2, rms: 0.5, clips: 0 }, 0, 0);
    expect(hot.clip).toBe(true);
    expect(stepMeter(hot, null, 60_000, 0).clip).toBe(true);
    expect(stepMeter(SILENT_METER, { peak: 0.9, rms: 0.5, clips: 2 }, 0, 0).clip).toBe(true);
    expect(stepMeter({ ...hot, clip: false }, null, 1, 0).clip).toBe(false);
  });

  it("share one scale with the fader, which reads back", () => {
    expect(meterFrac(-Infinity)).toBe(0);
    expect(meterFrac(-24)).toBeCloseTo(0.3, 6);
    expect(meterFrac(6)).toBe(1);
    for (const db of [-48, -24, -12, -3.8, 0]) expect(fracToDb(meterFrac(db))).toBeCloseTo(db, 6);
    expect(fracToDb(0)).toBe(-Infinity);
  });
});
