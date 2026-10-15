import { describe, expect, it } from "vitest";
import { centerOnPitches, gridTicks, pitchToY, snapFloor, tickToX, xToTick, yToPitch, zoomAt, type RollView } from "./roll/geometry.js";
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
