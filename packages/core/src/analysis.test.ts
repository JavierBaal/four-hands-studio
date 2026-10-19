import { describe, expect, it } from "vitest";
import { analysisText, analyze, chordPitchClasses } from "./analysis.js";
import { type Note, type Song, USER, barStart, emptySong } from "./model.js";
import { importMidi } from "./midi.js";
import { PPQ } from "./time.js";
import { DILATACION } from "./test-support/dilatacion.js";



/** A song with some tracks; notes as [track, pitch, startBeat, beats, velocity?]. */
function song(tracks: string[], notes: [string, number, number, number, number?][], extra: Partial<Song> = {}): Song {
  const s = emptySong("Test");
  tracks.forEach((name, i) => {
    const id = `t${i + 1}`;
    s.tracks[id] = { id, name, program: 48, channel: i, volume: 0.8, pan: 0, mute: false, solo: false, color: i % 10, pedal: [], extraEvents: [] };
    s.trackOrder.push(id);
  });
  notes.forEach(([track, pitch, beat, beats, velocity], i) => {
    const id = `n${i + 1}`;
    const note: Note = { id, trackId: track, pitch, start: beat * PPQ, duration: beats * PPQ, velocity: velocity ?? 80, createdBy: USER, shapedBy: USER };
    s.notes[id] = note;
  });
  return Object.assign(s, extra);
}

const whole = (s: Song, bars: number) => ({ start: 0, end: barStart(s.meter, bars + 1) });
const checks = (s: Song, bars: number, extra = {}) => analyze(s, { ...whole(s, bars), ...extra });

describe("analyze: low register", () => {
  it("finds a minor second too low and names both tracks", () => {
    // A1 + Bb1: 55 and 58 Hz, the Invasion case.
    const s = song(["Contrabajo", "Invasor"], [["t1", 33, 0, 4], ["t2", 34, 0, 4]]);
    const low = checks(s, 1).filter((f) => f.check === "low");
    expect(low).toHaveLength(1);
    expect(low[0]!.text).toMatch(/minor 2nd/);
    expect(low[0]!.text).toMatch(/Contrabajo, Invasor/);
    expect(low[0]!.text).toMatch(/comfortable from E3/);
  });

  it("does not hear a legato overlap as harmony", () => {
    // E1 still sounding for a 64th when F1 starts, in the same line.
    const s = song(["Bajo"], [["t1", 28, 0, 2.0625], ["t1", 29, 2, 2]]);
    expect(checks(s, 1).filter((f) => f.check === "low")).toHaveLength(0);
  });

  it("accepts the same clash opened to a minor ninth", () => {
    const s = song(["Contrabajo", "Invasor"], [["t1", 33, 0, 4], ["t2", 46, 0, 4]]);
    expect(checks(s, 1).filter((f) => f.check === "low")).toHaveLength(0);
  });

  it("counts too many notes below C3 at once", () => {
    const s = song(["A", "B", "C", "D"], [["t1", 36, 0, 4], ["t2", 40, 0, 4], ["t3", 43, 0, 4], ["t4", 45, 0, 4]]);
    expect(checks(s, 1).some((f) => f.check === "low" && /4 notes at once below C3/.test(f.text))).toBe(true);
  });

  it("leaves muted tracks and percussion out of what is heard", () => {
    const s = song(["Contrabajo", "Invasor"], [["t1", 33, 0, 4], ["t2", 34, 0, 4]]);
    s.tracks.t2!.mute = true;
    expect(checks(s, 1).filter((f) => f.check === "low")).toHaveLength(0);
    s.tracks.t2!.mute = false;
    s.tracks.t2!.channel = 9;
    expect(checks(s, 1).filter((f) => f.check === "low")).toHaveLength(0);
  });
});

describe("analyze: crowded register", () => {
  it("finds four tracks in the same octave", () => {
    const s = song(["Piano", "Órgano", "Violas", "Coro"], [["t1", 60, 0, 4], ["t2", 62, 0, 4], ["t3", 65, 0, 4], ["t4", 67, 0, 4]]);
    const f = checks(s, 1).filter((x) => x.check === "crowded");
    expect(f).toHaveLength(1);
    expect(f[0]!.text).toMatch(/4 tracks .*Piano, Órgano, Violas, Coro/);
  });

  it("is quiet when the parts are spread", () => {
    const s = song(["Bajo", "Piano", "Violas", "Violines"], [["t1", 36, 0, 4], ["t2", 55, 0, 4], ["t3", 67, 0, 4], ["t4", 84, 0, 4]]);
    expect(checks(s, 1).filter((x) => x.check === "crowded")).toHaveLength(0);
  });
});

describe("analyze: identical repeats", () => {
  it("finds a four-bar block copied twice (the Utopia draft)", () => {
    const block: [string, number, number, number][] = [];
    for (const b of [0, 4, 8]) for (let bar = 0; bar < 4; bar++) block.push(["t1", 38 + bar, (b + bar) * 4, 1]);
    const s = song(["Bajo"], block);
    const f = checks(s, 12).filter((x) => x.check === "repeats");
    expect(f).toHaveLength(1);
    expect(f[0]!.text).toMatch(/c\. 1–12 · Bajo: a 4-bar block played 3 times in a row/);
  });

  it("does not report a bar played only twice", () => {
    const s = song(["Bajo"], [["t1", 38, 0, 1], ["t1", 38, 4, 1]]);
    expect(checks(s, 2).filter((x) => x.check === "repeats")).toHaveLength(0);
  });

  it("sees that one changed note breaks the repeat", () => {
    const s = song(["Bajo"], [["t1", 38, 0, 1], ["t1", 38, 4, 1], ["t1", 39, 8, 1]]);
    expect(checks(s, 3).filter((x) => x.check === "repeats")).toHaveLength(0);
  });
});

describe("analyze: formula dynamics", () => {
  it("finds a straight ramp", () => {
    const notes: [string, number, number, number, number][] = [];
    for (let i = 0; i < 10; i++) notes.push(["t1", 50, i, 1, 60 + i * 2]);
    const f = checks(song(["Timbal"], notes), 3).filter((x) => x.check === "dynamics");
    expect(f).toHaveLength(1);
    expect(f[0]!.text).toMatch(/10 notes in a straight ramp, \+2 each \(v60 → v78\)/);
  });

  it("does not report a shaped crescendo", () => {
    const vels = [60, 61, 63, 62, 66, 70, 69, 75, 84, 96];
    const notes = vels.map((v, i): [string, number, number, number, number] => ["t1", 50, i, 1, v]);
    expect(checks(song(["Timbal"], notes), 3).filter((x) => x.check === "dynamics")).toHaveLength(0);
  });
});

describe("analyze: abrupt changes", () => {
  it("finds three tracks stopping at the same bar line", () => {
    const s = song(
      ["Coro", "Violas", "Trompas", "Melodía"],
      [["t1", 60, 0, 4], ["t2", 64, 0, 4], ["t3", 67, 0, 4], ["t4", 72, 0, 8]],
    );
    const f = checks(s, 2).filter((x) => x.check === "abrupt");
    expect(f).toHaveLength(1);
    expect(f[0]!.text).toMatch(/c\. 1→2 · 3 tracks stop at once \(Coro, Violas, Trompas\)/);
  });

  it("treats a cut to silence as a decision", () => {
    const s = song(["A", "B", "C"], [["t1", 60, 0, 4], ["t2", 64, 0, 4], ["t3", 67, 0, 4], ["t1", 60, 8, 4]]);
    expect(checks(s, 3).filter((x) => x.check === "abrupt")).toHaveLength(0);
  });
});

describe("analyze: ranges, key and chords", () => {
  it("reports notes outside the range the app gives", () => {
    const s = song(["Contrabajos"], [["t1", 26, 0, 4]]);
    const f = checks(s, 1, { rangeOf: () => [28, 67] as const }).filter((x) => x.check === "range");
    expect(f[0]!.text).toMatch(/Contrabajos · 1 below E1 \(lowest D1\)/);
  });

  it("groups notes outside the key by pitch class", () => {
    const s = song(["Invasor"], [["t1", 46, 0, 1], ["t1", 46, 1, 1], ["t1", 57, 2, 1]], { key: { fifths: 0, mode: "minor" } });
    const f = checks(s, 1).filter((x) => x.check === "key");
    expect(f).toHaveLength(1);
    expect(f[0]!.text).toMatch(/^A# ×2 \(A minor\) · Invasor/);
  });

  it("accepts the raised 6th and 7th in minor", () => {
    const s = song(["Melodía"], [["t1", 68, 0, 1], ["t1", 66, 1, 1]], { key: { fifths: 0, mode: "minor" } });
    expect(checks(s, 1).filter((x) => x.check === "key")).toHaveLength(0);
  });

  it("finds long notes on the beat outside the chord, and ignores passing notes", () => {
    const s = song(["Melodía"], [["t1", 62, 0, 2], ["t1", 65, 2, 0.5], ["t1", 64, 3, 1]], { harmony: { "0": "Am" } });
    const f = checks(s, 1).filter((x) => x.check === "harmony");
    expect(f).toHaveLength(1);
    expect(f[0]!.text).toMatch(/c\. 1 · Am: D4 · Melodía · n1$/);
  });

  it("reads chord symbols", () => {
    expect([...chordPitchClasses("Am")!].sort()).toEqual([0, 4, 9]);
    expect([...chordPitchClasses("Ab/D")!].sort((a, b) => a - b)).toEqual([0, 2, 3, 8]);
    expect([...chordPitchClasses("E7sus4")!].sort((a, b) => a - b)).toEqual([2, 4, 9, 11]);
    expect([...chordPitchClasses("D5")!].sort((a, b) => a - b)).toEqual([2, 9]);
    expect([...chordPitchClasses("Bbmaj7")!].sort((a, b) => a - b)).toEqual([2, 5, 9, 10]);
    expect(chordPitchClasses("??")).toBeNull();
  });
});

describe("analysisText", () => {
  it("only looks at the tracks asked, but hears all of them", () => {
    const s = song(["Contrabajo", "Invasor", "Flauta"], [["t1", 33, 0, 4], ["t2", 34, 0, 4], ["t3", 84, 0, 4]]);
    expect(analysisText(s, { ...whole(s, 1), trackIds: ["t3"], label: "c. 1" })).not.toMatch(/minor 2nd/);
    expect(analysisText(s, { ...whole(s, 1), trackIds: ["t2"], label: "c. 1" })).toMatch(/minor 2nd/);
  });

  it("says what it found nothing for and what it cannot hear", () => {
    const s = song(["Piano"], [["t1", 60, 0, 4]]);
    const text = analysisText(s, { ...whole(s, 1), label: "c. 1" });
    expect(text).toMatch(/^Analysis of c\. 1, all tracks \(r0\)/);
    expect(text).toMatch(/Nothing found for: low register, crowded register, identical repeats/);
    expect(text).toMatch(/cannot hear sounds/);
  });

  it("stays short on a whole real song", () => {
    const { song: s } = importMidi(DILATACION);
    const text = analysisText(s, { start: 0, end: barStart(s.meter, 60), label: "whole song" });
    expect(text.split("\n").length).toBeLessThan(80);
    expect(text.length).toBeLessThan(9000);
  });
});


