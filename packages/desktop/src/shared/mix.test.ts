import { describe, expect, it } from "vitest";
import { dbToVolume, formatDb, formatPan, formatReverb, parseDb, parsePan, parseReverb, volumeToDb } from "./mix.js";
import { SongDocument, USER, addBus, addTrack, audible, setOutput, setSend, starterSong, updateBus, updateTrack, withDefaultBuses } from "@fourhands/core";
import { busChainKey, engineBuses, engineLoad, addCost, costReport, engineRouting, engineStrips, levelDb, levelsReport, masterGain, stripGain } from "./mix.js";
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
  it("gives every track its fader in the dB the window shows; a plugin also its balance (parte D)", () => {
    expect(stripGain(1)).toBe(1);
    expect(20 * Math.log10(stripGain(0.8))).toBeCloseTo(volumeToDb(0.8), 6);
    expect(stripGain(0)).toBe(0);
    const strips = engineStrips([
      { channel: 2, output: "plugin", volume: 0.8, pan: -0.5 },
      { channel: 0, volume: 0.5, pan: 0.2 },
      { channel: 3, output: "external", volume: 0.5, pan: 0.2 },
    ]);
    expect(strips).toEqual([
      { ch: 2, gain: stripGain(0.8), pan: -0.5 },
      // A built-in sound: its volume in the strip (the synth gets CC7 at 127), its pan stays CC10.
      { ch: 0, gain: stripGain(0.5), pan: 0 },
      // Outside Four Hands: nothing to do in the engine.
      { ch: 3, gain: 1, pan: 0 },
    ]);
  });

  it("goes by the track's strip, says whose it is, and puts freed strips back to neutral (A2)", () => {
    const strips = engineStrips([{ id: "t9", channel: 0, strip: 37, output: "plugin", volume: 1, pan: 0.5 }], [12, 37]);
    expect(strips).toEqual([
      { ch: 12, gain: 1, pan: 0 },
      { ch: 37, gain: 1, pan: 0.5, track: "t9" },
    ]);
  });
});

describe("mute, solo and the master in the engine (F2.2 parte B)", () => {
  it("turns off muted strips, and with a solo every strip but the soloed ones; built-in sounds too", () => {
    const tracks = [
      { channel: 0, output: "plugin", volume: 1, pan: 0, mute: true },
      { channel: 1, volume: 1, pan: 0 },
    ];
    expect(engineStrips(tracks).map((s) => s.on)).toEqual([false, undefined]);
    // Solo wins over mute, as in the player.
    const soloed = [
      { channel: 0, output: "plugin", volume: 1, pan: 0, mute: true, solo: true },
      { channel: 1, volume: 1, pan: 0 },
      { channel: 2, volume: 1, pan: 0, solo: true },
    ];
    expect(engineStrips(soloed).map((s) => s.on)).toEqual([undefined, false, undefined]);
  });

  it("gives the master the same curve as a track, 0 dB when the song has none", () => {
    expect(masterGain(undefined)).toBe(1);
    expect(masterGain(0.8)).toBe(stripGain(0.8));
    expect(masterGain(0)).toBe(0);
  });

  it("reads the engine's load and counts a cut once when the driver also saw it", () => {
    expect(engineLoad({ avgLoad: 0.23, maxLoad: 0.4, overruns: 1, xruns: 1 })).toEqual({ avgLoad: 0.23, maxLoad: 0.4, dropouts: 1 });
    expect(engineLoad({ avgLoad: 0.1, maxLoad: 0.2, overruns: 0, xruns: -1 }).dropouts).toBe(0);
    expect(engineLoad({}).avgLoad).toBe(0);
  });

  it("adds up where a playback's time went, per track and stage, as shares of a block (09/11/2026)", () => {
    const reading = (kontakt: number, worst: number) =>
      engineLoad({ blocks: 100, budgetMs: 10, overruns: 1, avgLoad: 0.5, maxLoad: 1.2, strips: [[0, kontakt, worst], [3, 50, 1]], wait: [10, 0.5], sounds: [40, 0.6], mix: [20, 0.3], analysis: [5, 0.1], late: 2, gaps: 1, gapMax: kontakt / 10, messageStall: worst * 40 }).cost!;
    const total = addCost(addCost(null, reading(300, 4)), reading(500, 9));
    const report = costReport(total, [{ name: "Violas", strip: 0 }, { name: "Arpa", strip: 3 }]);
    expect(report).toMatchObject({ blocks: 200, budgetMs: 10, overruns: 2, late: 4, gaps: 2, gapMaxMs: 50, messageStallMs: 360 });
    expect(report.tracks[0]).toEqual({ track: "Violas", avg: 0.4, max: 0.9 });
    expect(report.tracks[1]).toEqual({ track: "Arpa", avg: 0.05, max: 0.1 });
    expect(report.stages.wait).toEqual({ avg: 0.01, max: 0.05 });
    expect(report.avgLoad).toBeCloseTo(0.525, 3);
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

describe("buses in the engine (F2.2 parte D)", () => {
  function song() {
    const doc = new SongDocument(withDefaultBuses(starterSong("Buses")), { now: () => 0 });
    doc.transact({ actor: USER, label: "buses" }, (tx) => {
      addTrack(tx, { name: "Voz" }); // t2
      addTrack(tx, { name: "Fuera" }); // t3
      updateTrack(tx, "t3", { output: "external" });
      const voces = addBus(tx, { name: "Voces" }); // b2
      const mix = addBus(tx, { name: "Mix bus", index: 0 }); // b3
      setOutput(tx, voces, mix);
      setOutput(tx, "t2", voces);
      setSend(tx, "t2", "b1", { level: 0.3 });
      setSend(tx, "t1", voces, { level: 0.5, pre: true });
      setSend(tx, "t3", "b1", { level: 0.4 });
      updateBus(tx, mix, { volume: 0.8, mute: true });
    });
    return doc.song;
  }
  const index = (id: string) => ({ b1: 0, b2: 1, b3: 2 })[id] ?? -1;

  it("sends every strip's and bus's output and sends, each bus after those that feed it", () => {
    const s = song();
    const r = engineRouting(s, (t) => ({ t1: 0, t2: 1, t3: 2 })[t.id]!, index);
    expect(r.strips).toEqual([
      { ch: 0, out: -1, sends: [{ bus: 1, level: 0.5, pre: true }] },
      { ch: 1, out: 1, sends: [{ bus: 0, level: 0.3, pre: false }] },
    ]);
    expect(r.buses).toEqual([
      { bus: 2, out: -1, sends: [] },
      { bus: 0, out: -1, sends: [] },
      { bus: 1, out: 2, sends: [] },
    ]);
    // Voces (1) before Mix bus (2); the instruments' own reverb stays in the engine (no bus).
    expect(r.order.indexOf(1)).toBeLessThan(r.order.indexOf(2));
    expect(r.instrumentReverb).toBe(-1);
  });

  it("gives the buses their faders, off when muted", () => {
    const s = song();
    expect(engineBuses(s, index, audible(s))).toEqual([
      { bus: 2, gain: stripGain(0.8), pan: 0, on: false, id: "b3" },
      { bus: 0, gain: 1, pan: 0, id: "b1" },
      { bus: 1, gain: 1, pan: 0, id: "b2" },
    ]);
    expect(busChainKey(0)).toBe(-2);
    expect(busChainKey(5)).toBe(-7);
  });
});
