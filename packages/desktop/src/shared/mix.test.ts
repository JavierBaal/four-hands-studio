import { describe, expect, it } from "vitest";
import { dbToVolume, formatDb, formatPan, formatReverb, parseDb, parsePan, parseReverb, volumeToDb } from "./mix.js";
import { trackColorByName, trackColorId, TRACK_PALETTE } from "./track-colors.js";
import { TRACK_COLOR_COUNT } from "@fourhands/core";

describe("volume in dB (H3.2)", () => {
  it("follows the General MIDI curve of CC7", () => {
    expect(volumeToDb(1)).toBe(0);
    expect(volumeToDb(0.8)).toBeCloseTo(-3.81, 2);
    expect(volumeToDb(0)).toBe(-Infinity);
    expect(formatDb(0.8, "es")).toBe("−3,8");
    expect(formatDb(0.8, "en")).toBe("−3.8");
    expect(formatDb(1, "es")).toBe("0,0");
    expect(formatDb(0, "en")).toBe("−∞");
  });

  it("reads what people type and lands on the same CC7", () => {
    for (const text of ["-6", "−6", "-6,0", "-6.0 dB", "6", "-6dB"]) {
      const v = parseDb(text);
      expect(v).not.toBeNull();
      expect(Math.round(v! * 127)).toBe(Math.round(dbToVolume(-6) * 127));
      expect(volumeToDb(v!)).toBeCloseTo(-6, 0);
    }
    expect(parseDb("0")).toBe(1);
    expect(parseDb("-inf")).toBe(0);
    expect(parseDb("−∞")).toBe(0);
    expect(parseDb("-200")).toBe(0);
    expect(parseDb("fuerte")).toBeNull();
    // What is shown is what is typed back.
    for (let cc = 1; cc <= 127; cc++) {
      const shown = formatDb(cc / 127, "es");
      expect(Math.round(parseDb(shown)! * 127)).toBe(cc);
    }
  });
});

describe("pan (H3.2)", () => {
  it("shows and reads C, L and R", () => {
    expect(formatPan(0)).toBe("C");
    expect(formatPan(-0.3)).toBe("L30");
    expect(formatPan(0.25)).toBe("R25");
    expect(parsePan("c")).toBe(0);
    expect(parsePan("L30")).toBe(-0.3);
    expect(parsePan("r 25")).toBe(0.25);
    expect(parsePan("I40")).toBe(-0.4);
    expect(parsePan("D40")).toBe(0.4);
    expect(parsePan("-15")).toBe(-0.15);
    expect(parsePan("L150")).toBe(-1);
    expect(parsePan("izquierda")).toBeNull();
  });
});

describe("track colours by name (H3.2)", () => {
  it("has one named colour per index the core allows", () => {
    expect(TRACK_PALETTE).toHaveLength(TRACK_COLOR_COUNT);
    expect(new Set(TRACK_PALETTE.map((c) => c.id)).size).toBe(TRACK_COLOR_COUNT);
  });

  it("finds a colour in English or Spanish, with or without accents", () => {
    expect(trackColorByName("sage")).toBe(2);
    expect(trackColorByName("Salvia")).toBe(2);
    expect(trackColorByName(" CIRUELA ")).toBe(6);
    expect(trackColorByName("brezo")).toBe(9);
    expect(trackColorByName("rojo")).toBeNull();
    expect(trackColorId(8)).toBe("water");
  });
});

describe("reverb send (H4)", () => {
  it("shows and reads 0 to 100", () => {
    expect(formatReverb(0)).toBe("0");
    expect(formatReverb(0.35)).toBe("35");
    expect(parseReverb("35")).toBe(0.35);
    expect(parseReverb("40 %")).toBe(0.4);
    expect(parseReverb("150")).toBe(1);
    expect(parseReverb("mucha")).toBeNull();
  });
});
