import { describe, expect, it } from "vitest";
import { OWN_EFFECTS, defaultParams, paramToUnit, parseParamValue, unitToParam } from "@fourhands/core";
import { compressorOut, eqResponse, logFreqs } from "./effect-curves.js";

const def = (kind: "eq" | "compressor" | "limiter", id: string) => OWN_EFFECTS[kind].params.find((p) => p.id === id)!;

describe("the effect window's curves (F2.2 parte C2)", () => {
  it("draws a flat EQ flat, and a bell where it is", () => {
    const flat = eqResponse(defaultParams("eq"), [50, 1000, 10000]);
    for (const v of flat) expect(Math.abs(v)).toBeLessThan(1e-6);
    const bell = eqResponse({ ...defaultParams("eq"), highMidFreq: 2500, highMidGain: 6, highMidQ: 1 }, [2500, 100, 18000]);
    expect(bell[0]).toBeCloseTo(6, 1);
    expect(Math.abs(bell[1]!)).toBeLessThan(0.2);
  });

  it("cuts: 3 dB down at the cut frequency, far less below it", () => {
    const [at, below] = eqResponse({ ...defaultParams("eq"), lowCut: 1, lowCutFreq: 100 }, [100, 25]);
    expect(at).toBeCloseTo(-3, 0);
    expect(below!).toBeLessThan(-20);
  });

  it("spreads frequencies on a log scale", () => {
    const f = logFreqs(4, 20, 20000);
    expect(f[0]).toBeCloseTo(20);
    expect(f[1]).toBeCloseTo(200);
    expect(f[3]).toBeCloseTo(20000);
  });

  it("follows the compressor's curve: untouched below, divided by the ratio above", () => {
    const p = { threshold: -20, ratio: 4, knee: 0 };
    expect(compressorOut(p, -30)).toBe(-30);
    expect(compressorOut(p, 0)).toBe(-15);
    // The knee rounds the corner: at the threshold, already a little lower.
    expect(compressorOut({ ...p, knee: 6 }, -20)).toBeLessThan(-20);
  });

  it("puts parameters on a fader (log for frequencies) and reads typed values", () => {
    const f = def("eq", "lowCutFreq");
    expect(paramToUnit(f, 20)).toBe(0);
    expect(paramToUnit(f, 1000)).toBe(1);
    expect(unitToParam(f, paramToUnit(f, 141))).toBeCloseTo(141, 0);
    expect(parseParamValue(def("eq", "highMidFreq"), "2,5 kHz")).toBe(2500);
    expect(parseParamValue(def("eq", "highMidFreq"), "2.5")).toBe(2500);
    expect(parseParamValue(def("compressor", "threshold"), "−24 dB")).toBe(-24);
    expect(parseParamValue(def("compressor", "ratio"), "4:1")).toBe(4);
    expect(parseParamValue(def("compressor", "threshold"), "-90")).toBeNull();
    expect(parseParamValue(def("eq", "lowCut"), "on")).toBe(1);
  });
});
