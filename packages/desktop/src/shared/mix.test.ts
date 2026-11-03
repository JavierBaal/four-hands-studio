import { describe, expect, it } from "vitest";
import { dbToVolume, formatDb, formatPan, formatReverb, parseDb, parsePan, parseReverb, volumeToDb } from "./mix.js";
import { engineStrips, levelDb, levelsReport, stripGain } from "./mix.js";
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

describe("the engine's strips (F2.2, 03/11/2026)", () => {
  it("gives a plugin track its fader in the dB the window shows, its balance and its reverb send", () => {
    expect(stripGain(1)).toBe(1);
    expect(20 * Math.log10(stripGain(0.8))).toBeCloseTo(volumeToDb(0.8), 6);
    expect(stripGain(0)).toBe(0);
    const strips = engineStrips([
      { channel: 2, output: "plugin", volume: 0.8, pan: -0.5, reverb: 0.3 },
      { channel: 0, volume: 0.5, pan: 0.2, reverb: 0.4 },
    ]);
    expect(strips).toEqual([
      { ch: 2, gain: stripGain(0.8), pan: -0.5, reverb: 0.3 },
      // The built-in sounds keep volume, pan and reverb as MIDI: their strip stays neutral.
      { ch: 0, gain: 1, pan: 0, reverb: 0 },
    ]);
  });

  it("goes by the track's strip, says whose it is, and puts freed strips back to neutral (A2)", () => {
    const strips = engineStrips([{ id: "t9", channel: 0, strip: 37, output: "plugin", volume: 1, pan: 0.5 }], [12, 37]);
    expect(strips).toEqual([
      { ch: 12, gain: 1, pan: 0, reverb: 0 },
      { ch: 37, gain: 1, pan: 0.5, reverb: 0, track: "t9" },
    ]);
  });
});

describe("the levels the engine measured (F2.2)", () => {
  it("reads them per track in dB, with the master", () => {
    expect(levelDb(1)).toBe(0);
    expect(levelDb(0.5)).toBe(-6);
    expect(levelDb(0)).toBe(-Infinity);
    const channels = Array.from({ length: 16 }, () => ({ peak: 0, rms: 0, clips: 0 }));
    channels[2] = { peak: 0.5, rms: 0.1, clips: 3 };
    const r = levelsReport({ channels, master: { peak: 1, rms: 0.2, clips: 0 } }, [{ name: "Cuerdas", channel: 2 }]);
    expect(r.tracks).toEqual([{ track: "Cuerdas", strip: 2, peakDb: -6, rmsDb: -20, clips: 3 }]);
    // A2: by strip when the track has one.
    expect(levelsReport({ channels, master: { peak: 1, rms: 0.2, clips: 0 } }, [{ name: "Viola", channel: 0, strip: 2 }]).tracks[0]!.peakDb).toBe(-6);
    expect(r.master.peakDb).toBe(0);
  });
});
