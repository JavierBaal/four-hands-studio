import { describe, expect, it } from "vitest";
import { EIGHTH_TRIPLET, PPQ, SIXTEENTH, deviationInBeats, nominalGridPosition } from "./time.js";

describe("PPQ", () => {
  it("divides the grids the MVP needs exactly", () => {
    expect(PPQ).toBe(960);
    expect(SIXTEENTH).toBe(240);
    expect(EIGHTH_TRIPLET).toBe(320);
    expect(Number.isInteger(PPQ / 6)).toBe(true); // sixteenth triplet
  });

  it("takes MIDI files at 480 per quarter without rounding", () => {
    expect(PPQ % 480).toBe(0);
  });
});

describe("nominalGridPosition", () => {
  it("puts a note exactly on the grid with no deviation", () => {
    expect(nominalGridPosition(4 * PPQ)).toEqual({ gridTick: 3840, deviationTicks: 0, grid: "1/16" });
  });

  it("measures a late note against the nearest sixteenth", () => {
    const pos = nominalGridPosition(4 * PPQ + 29); // ~0.03 beats late
    expect(pos.grid).toBe("1/16");
    expect(pos.deviationTicks).toBe(29);
    expect(deviationInBeats(pos.deviationTicks)).toBe(0.03);
  });

  it("recognises the second note of an eighth-note triplet", () => {
    const pos = nominalGridPosition(PPQ + 320 + 5);
    expect(pos.grid).toBe("1/8t");
    expect(pos.gridTick).toBe(1280);
    expect(pos.deviationTicks).toBe(5);
  });

  it("keeps the deviation when a note moves by whole grid steps", () => {
    const played = 7 * PPQ + 240 - 19; // slightly early
    const moved = played + 3 * SIXTEENTH;
    expect(nominalGridPosition(moved).deviationTicks).toBe(nominalGridPosition(played).deviationTicks);
  });
});
