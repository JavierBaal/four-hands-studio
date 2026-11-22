import { SongDocument, USER, addSection, addTrack, emptySong } from "@fourhands/core";
import { describe, expect, it } from "vitest";
import { BANDS, REFERENCE_BANDS, TARGETS, parseAnalysis, tonalBalance, type AnalysisFrame, type EngineAnalysis } from "../../shared/analysis.js";
import { mixReport } from "./listen.js";

/** A song at 120 BPM in 4/4: a bar every 2 seconds, so a frame (1 s) is half a bar (2 quarter notes). */
function song() {
  const d = new SongDocument(emptySong("Escucha"), { now: () => 0 });
  d.transact({ actor: USER, label: "x" }, (tx) => {
    addTrack(tx, { name: "Violas" }); // t1
    addTrack(tx, { name: "Clarinete" }); // t2
    addTrack(tx, { name: "Bajo" }); // t3
    addTrack(tx, { name: "Arpa" }); // t4, silent
    addSection(tx, { name: "Intro", startBar: 1, endBar: 4 });
    addSection(tx, { name: "Coro", startBar: 5, endBar: 8 });
  });
  return d.song;
}

/** 16 frames (bars 1–8). `bands` per frame, in dB; quiet in the intro when `intro` is false. */
function frames(bands: number[], lufs: number, intro = true, peakDb = -6): AnalysisFrame[] {
  return Array.from({ length: 16 }, (_, i) => ({
    ppq: i * 2,
    lufs: !intro && i < 8 ? -120 : lufs,
    bands: !intro && i < 8 ? bands.map(() => -120) : bands,
    peakDb,
    correlation: 0.6,
    side: 0.2,
  }));
}

const reference = (offset: number) => REFERENCE_BANDS.map((r) => r + offset);
const at = (levels: number[], band: number, value: number) => levels.map((l, i) => (i === band ? value : l));

function analysis(): EngineAnalysis {
  // Violas and clarinet both strong in the low-mids, only in the chorus; the bass in the bass band.
  const violas = frames([-60, -40, -18, -24, -40, -50, -60], -22, false);
  const clarinete = frames([-70, -50, -19, -22, -35, -45, -60], -22, false);
  const bajo = frames([-25, -16, -35, -50, -70, -80, -90], -20);
  const masterBands = at(reference(-14), 2, -14 + REFERENCE_BANDS[2]! + 6); // +6 dB of low-mids
  const master = { integrated: -18, shortMax: -15.2, range: 6.5, peak: -0.5, truePeak: 0.3, seconds: 16, frames: frames(masterBands, -18, true, -0.5) };
  const ch = (f: AnalysisFrame[], strip: number) => ({ integrated: -22, shortMax: -20, range: 3, peak: -6, truePeak: -6, seconds: 16, frames: f, strip });
  return { strips: [ch(violas, 0), ch(clarinete, 1), ch(bajo, 2), ch(frames(BANDS.map(() => -120), -120), 3)], buses: [], master, gaps: 0 };
}

const ctx = () => ({ analysis: analysis(), at: Date.UTC(2026, 10, 4, 18, 30), strips: { t1: 0, t2: 1, t3: 2, t4: 3 }, buses: {} });

describe("the AI's ear (F2.3, 04/11/2026)", () => {
  it("reads the engine's rows of numbers", () => {
    const a = parseAnalysis({ strips: [{ strip: 2, integrated: -20, frames: [[4, -21.5, -30, -20, -25, -26, -40, -50, -60, -3]] }], buses: [], master: { integrated: -18, frames: [[4, -19, -30, -20, -25, -26, -40, -50, -60, -1, 0.5, 0.25]] }, gaps: 0 })!;
    expect(a.strips[0]).toMatchObject({ strip: 2, integrated: -20 });
    expect(a.strips[0]!.frames[0]).toEqual({ ppq: 4, lufs: -21.5, bands: [-30, -20, -25, -26, -40, -50, -60], peakDb: -3 });
    expect(a.master!.frames[0]).toMatchObject({ correlation: 0.5, side: 0.25 });
  });

  it("has a balanced reference that falls towards the highs, and measures against it", () => {
    expect(REFERENCE_BANDS[3]).toBe(0);
    expect(REFERENCE_BANDS[6]!).toBeLessThan(REFERENCE_BANDS[4]!);
    for (const d of tonalBalance(reference(-20))) expect(Math.abs(d)).toBeLessThan(1e-9);
  });

  it("says the loudness against the target, the tonal balance, the sections, the parts and who masks whom", () => {
    const text = mixReport(song(), ctx(), { target: TARGETS.streaming! });
    expect(text).toContain("bars 1–8, 16 s");
    expect(text).toContain("Master: -18.0 LUFS integrated (4.0 dB below target)");
    expect(text).toContain("true peak 0.3 dBTP (OVER the -1 ceiling: a limiter on the Master)");
    expect(text).toMatch(/low-mids \+\d\.\d \(muddy\)/);
    expect(text).toContain("Loudness by section (LUFS while playing): Intro c. 1–4 -18.0 · Coro c. 5–8 -18.0.");
    expect(text).toContain("- Bajo: -20.0 LUFS while playing (−2.0 against the master), energy in bass, peak -6.0 dBFS, sounding 16 of 16 s");
    expect(text).toContain("Silent there: Arpa.");
    expect(text).toMatch(/- Violas and Clarinete: low-mids \(250 Hz–500 Hz\), c\. 5–8 \(Coro\), 1\.0 dB apart/);
    expect(text).toMatch(/meter, not hearing/);
  });

  it("narrows to some bars, takes a target of the user's, and says when nothing was measured", () => {
    const text = mixReport(song(), ctx(), { target: { name: "the user's own", lufs: -16, truePeak: -1.5 }, fromBar: 1, toBar: 4 });
    expect(text).toContain("(the bars you asked for)");
    expect(text).toContain("Target: the user's own, -16 LUFS integrated, true peak ≤ -1.5 dBTP.");
    expect(text).toContain("Silent there: Violas, Clarinete, Arpa.");
    expect(text).not.toContain("Possible masking");
    expect(mixReport(song(), null, { target: TARGETS.none! })).toMatch(/Nothing measured yet/);
    expect(mixReport(song(), ctx(), { target: TARGETS.none!, fromBar: 20, toBar: 24 })).toMatch(/Nothing measured in c\. 20–24/);
  });
});
