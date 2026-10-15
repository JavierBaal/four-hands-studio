import { describe, expect, it } from "vitest";
import { centerOnPitches, fitRect, gridTicks, pitchToY, rowMetrics, snapFloor, stepRow, tickToX, xToTick, yToPitch, zoomAt, zoomClick, zoomRowsAt, type RollView } from "./roll/geometry.js";
import { barRange, durationName, isBlack, keyName, noteName, scalePitchClasses, transportPosition } from "./music.js";

const m44 = { numerator: 4, denominator: 4 };

describe("names", () => {
  it("names notes with middle C = 4, spelled by the key", () => {
    expect(noteName(60, "solfege")).toBe("Do4");
    expect(noteName(81, "solfege")).toBe("La5");
    expect(noteName(70, "solfege", { fifths: -1, mode: "major" })).toBe("Si♭4");
    expect(noteName(61, "letters")).toBe("C♯4");
    expect(isBlack(61)).toBe(true);
    expect(isBlack(64)).toBe(false);
  });

  it("names keys in Spanish and English", () => {
    expect(keyName({ fifths: 0, mode: "minor" }, "es")).toBe("La menor");
    expect(keyName({ fifths: -3, mode: "major" }, "es")).toBe("Mi♭ mayor");
    expect(keyName({ fifths: 2, mode: "minor" }, "en")).toBe("B minor");
    expect(keyName({ fifths: 6, mode: "major" }, "es")).toBe("Fa♯ mayor");
  });

  it("knows the scale of a key", () => {
    expect([...scalePitchClasses({ fifths: 0, mode: "minor" })].sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scalePitchClasses({ fifths: -1, mode: "major" }).has(10)).toBe(true);
  });

  it("writes the transport position as in the sketches", () => {
    expect(transportPosition(m44, 22 * 4 * 960)).toBe("023.1.1");
    expect(transportPosition(m44, 2 * 960 + 720)).toBe("001.3.4");
    expect(barRange(m44, 24 * 3840, 26 * 3840)).toBe("25–26");
  });
});

describe("roll geometry", () => {
  const v: RollView = { startTick: 3840, pxPerTick: 0.025, scrollY: 300, width: 1000, height: 450 };

  it("maps ticks and pitches to pixels and back", () => {
    expect(tickToX(v, 3840 + 960)).toBe(24);
    expect(xToTick(v, 24)).toBe(3840 + 960);
    expect(pitchToY(v, 107)).toBe(0);
    expect(yToPitch(v, 0)).toBe(107);
    expect(yToPitch(v, 14.9)).toBe(107);
    expect(yToPitch(v, 15)).toBe(106);
  });

  it("knows the grid values", () => {
    expect(gridTicks("1/8")).toBe(480);
    expect(gridTicks("1/8t")).toBe(320);
    expect(gridTicks("1/1")).toBe(3840);
    expect(snapFloor(1000, 480)).toBe(960);
  });

  it("zooms around the mouse", () => {
    const z = zoomAt(v, 2, 500);
    expect(z.pxPerTick).toBe(0.05);
    expect(xToTick({ ...v, ...z }, 500)).toBeCloseTo(xToTick(v, 500));
  });

  it("centres a range of pitches", () => {
    const y = centerOnPitches(v, 57, 86);
    const mid = (pitchToY({ ...v, scrollY: y }, 86) + pitchToY({ ...v, scrollY: y }, 57) + 15) / 2;
    expect(mid).toBeCloseTo(225);
  });
});

describe("durations as musicians say them (H3.2)", () => {
  it("names figures, dots and triplets, and approximates played lengths", () => {
    expect(durationName(960, "es")).toBe("negra");
    expect(durationName(1440, "es")).toBe("negra con puntillo");
    expect(durationName(320, "es")).toBe("corchea de tresillo");
    expect(durationName(3840, "en")).toBe("whole");
    expect(durationName(720, "en")).toBe("dotted eighth");
    expect(durationName(Math.round(1920 * 0.95), "es")).toBe("≈ blanca");
    expect(durationName(1150, "es")).toBe("1,2 tiempos");
    expect(durationName(1150, "en")).toBe("1.2 beats");
  });
});

describe("vertical zoom and the zoom tool (Fran, 15/10/2026)", () => {
  const base: RollView = { startTick: 0, pxPerTick: 0.025, scrollY: (127 - 84) * 15, width: 1000, height: 450 };

  it("moves by comfortable steps and stops at the ends", () => {
    expect(stepRow(15, 1)).toBe(18);
    expect(stepRow(15, -1)).toBe(12);
    expect(stepRow(24, 1)).toBe(24);
    expect(stepRow(12, -1)).toBe(12);
    expect(rowMetrics(15)).toEqual({ note: 13, ghost: 9, font: 10 });
    expect(rowMetrics(24).font).toBe(12);
  });

  it("keeps the pitch under the mouse in place when rows grow", () => {
    const anchorY = 200;
    const before = yToPitch(base, anchorY);
    const next = zoomRowsAt(base, 21, anchorY);
    const after: RollView = { ...base, ...next };
    expect(yToPitch(after, anchorY)).toBe(before);
    expect(pitchToY(after, 60) - pitchToY(after, 61)).toBe(21);
  });

  it("frames a rectangle: its bars fill the width and its pitches fit at a comfortable height", () => {
    // Bars 2–3 and the octave C5–C6 (13 rows) inside a 450 px tall view.
    const x0 = tickToX(base, 3840);
    const x1 = tickToX(base, 3 * 3840);
    const y0 = pitchToY(base, 84) + 2;
    const y1 = pitchToY(base, 72) + 2;
    const f = fitRect(base, x0, y0, x1, y1);
    expect(f.startTick).toBeCloseTo(3840, 0);
    expect(f.pxPerTick).toBeCloseTo(1000 / (2 * 3840), 6);
    expect(f.rowHeight).toBe(24); // 13 rows × 24 px = 312 ≤ 450: never taller than 24
    const after: RollView = { ...base, ...f };
    expect(pitchToY(after, 84)).toBeGreaterThanOrEqual(0);
    expect(pitchToY(after, 72) + 24).toBeLessThanOrEqual(450);
  });

  it("a click zooms in a step in time and rows; Alt+click zooms out", () => {
    const zin = zoomClick(base, 500, 200, false);
    expect(zin.pxPerTick).toBeCloseTo(base.pxPerTick * 1.5, 6);
    expect(zin.rowHeight).toBe(18);
    const zout = zoomClick(base, 500, 200, true);
    expect(zout.rowHeight).toBe(12);
    expect(xToTick({ ...base, ...zin }, 500)).toBeCloseTo(xToTick(base, 500), 3);
  });
});
