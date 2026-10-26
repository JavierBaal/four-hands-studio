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
    // Altered extensions (the Severance session, 20/10/2026): #11 is the raised fourth, not the natural one.
    expect([...chordPitchClasses("Dmaj7#11")!].sort((a, b) => a - b)).toEqual([1, 2, 6, 8, 9]);
    expect([...chordPitchClasses("Bbmaj7#11")!].sort((a, b) => a - b)).toEqual([2, 4, 5, 9, 10]);
    expect([...chordPitchClasses("A7b9")!].sort((a, b) => a - b)).toEqual([1, 4, 7, 9, 10]);
    expect([...chordPitchClasses("Cm9")!].sort((a, b) => a - b)).toEqual([0, 2, 3, 7, 10]);
    expect([...chordPitchClasses("Cadd9")!].sort((a, b) => a - b)).toEqual([0, 2, 4, 7]);
    expect([...chordPitchClasses("C7#5")!].sort((a, b) => a - b)).toEqual([0, 4, 8, 10]);
    expect([...chordPitchClasses("Dmaj7sus4")!].sort((a, b) => a - b)).toEqual([1, 2, 7, 9]);
    expect([...chordPitchClasses("C6")!].sort((a, b) => a - b)).toEqual([0, 4, 7, 9]);
    expect(chordPitchClasses("??")).toBeNull();
  });
});

describe("analyze: leftovers, loops and shape (the Severance sessions, 20/10/2026)", () => {
  it("finds chords and annotations past the music, and empty tracks", () => {
    const s = song(["Piano", "Sin uso"], [["t1", 60, 0, 4]], { harmony: { "0": "C", [String(5 * 4 * PPQ)]: "G" } });
    s.annotations.a1 = { id: "a1", start: 8 * 4 * PPQ, end: 10 * 4 * PPQ, trackIds: [], text: "versión vieja", author: USER };
    const f = checks(s, 10).filter((x) => x.check === "leftovers");
    expect(f[0]!.text).toMatch(/^c\. 2–10 · 1 chord, annotation a1 after the last note: the song reads 10 bars \(0:20\) but the music ends at c\. 1 \(0:02\)/);
    expect(f[1]!.text).toBe("Sin uso · no notes");
  });

  it("finds a progression looped three or more times, but not a pedal of a few bars", () => {
    const chords = ["Dmaj7#11", "Bbmaj7#11", "Gmaj7", "Fmaj7#11"];
    const harmony: Record<string, string> = {};
    const notes: [string, number, number, number][] = [];
    for (let bar = 0; bar < 12; bar++) {
      harmony[String(bar * 4 * PPQ)] = chords[bar % 4]!;
      notes.push(["t1", 62, bar * 4, 4]);
    }
    const f = checks(song(["Pad"], notes, { harmony }), 12).filter((x) => x.check === "loops");
    expect(f).toHaveLength(1);
    expect(f[0]!.text).toBe("c. 1–12 · the same 4-bar progression 3 times in a row: Dmaj7#11 | Bbmaj7#11 | Gmaj7 | Fmaj7#11");
    const pedal = song(["Pad"], [["t1", 62, 0, 16]], { harmony: { "0": "D" } });
    expect(checks(pedal, 4).filter((x) => x.check === "loops")).toHaveLength(0);
  });

  it("describes the shape section by section, with the busiest bar", () => {
    const s = song(["A", "B"], [["t1", 60, 0, 1], ["t1", 62, 4, 1], ["t2", 64, 4, 1], ["t1", 65, 5, 1]]);
    s.sections.s1 = { id: "s1", name: "Intro", startBar: 1, endBar: 1 };
    s.sections.s2 = { id: "s2", name: "Coro", startBar: 2, endBar: 2 };
    const text = analysisText(s, { ...whole(s, 2), label: "c. 1–2" });
    expect(text).toContain("Shape (notes per bar · tracks · average velocity): Intro 1·1·v80 → Coro 3·2·v80. Busiest bar: c. 2 (3 notes, 2 tracks).");
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
    expect(text).toMatch(/Nothing found for: leftovers, low register, crowded register, tracks sharing a register, identical repeats, harmonic loops/);
    expect(text).toMatch(/crossed parts, parallel 5ths and octaves\./);
    expect(text).toMatch(/cannot hear sounds/);
  });

  it("finds two tracks in one register and one place in the stereo, and not when panned apart (H4)", () => {
    // Violas and clarinet around E4 for two bars, both in the centre.
    const s = song(["Violas", "Clarinete"], [["t1", 64, 0, 4], ["t1", 64, 4, 4], ["t2", 65, 0, 4], ["t2", 62, 4, 4]]);
    const found = checks(s, 2).filter((f) => f.check === "masking");
    expect(found).toHaveLength(1);
    expect(found[0]!.text).toMatch(/^c\. 1–2 · Violas, Clarinete around E4 · pan C and C · vol 80 and 80$/);
    s.tracks.t2!.pan = -0.5;
    expect(checks(s, 2).filter((f) => f.check === "masking")).toHaveLength(0);
    // A single bar is a passing meeting, not a register shared.
    const one = song(["Violas", "Clarinete"], [["t1", 64, 0, 4], ["t2", 65, 0, 4]]);
    expect(checks(one, 1).filter((f) => f.check === "masking")).toHaveLength(0);
  });

  it("finds a lower part crossing above the one usually above it (H4)", () => {
    // Cello around C3, violas around C4; in beat 3 the cello climbs to E4 over the violas' C4.
    const s = song(["Chelo", "Violas"], [
      ["t1", 48, 0, 1], ["t1", 50, 1, 1], ["t1", 64, 2, 1], ["t1", 47, 3, 1],
      ["t2", 60, 0, 1], ["t2", 62, 1, 1], ["t2", 60, 2, 1], ["t2", 59, 3, 1],
    ]);
    const found = checks(s, 1).filter((f) => f.check === "crossings");
    expect(found).toHaveLength(1);
    expect(found[0]!.text).toMatch(/^c\. 1 · Chelo above Violas \(E4 over C4\) ×1 · n3$/);
  });

  it("finds parallel fifths and octaves between two lines, and calls a long run a doubling (H4)", () => {
    // Bass and tenor: C3/G3 → D3/A3 (5ths), then E3/B3 → F3/C4 (contrary... no: oblique) .
    const s = song(["Bajo", "Tenor"], [
      ["t1", 48, 0, 1], ["t1", 50, 1, 1], ["t1", 52, 2, 1], ["t1", 53, 3, 1],
      ["t2", 55, 0, 1], ["t2", 57, 1, 1], ["t2", 55, 2, 1], ["t2", 57, 3, 1],
    ]);
    const found = checks(s, 1).filter((f) => f.check === "parallels");
    expect(found.map((f) => f.text)).toEqual(["c. 1 · Bajo, Tenor · parallel 5ths ×1"]);
    // Five notes together at the octave: a doubling, said once, not five slips.
    const d = song(["Violines", "Flauta"], [0, 1, 2, 3, 4].flatMap((b) => [["t1", 60 + b, b, 1], ["t2", 72 + b, b, 1]] as [string, number, number, number][]));
    const dd = checks(d, 2).filter((f) => f.check === "parallels");
    expect(dd.map((f) => f.text)).toEqual(["c. 1–2 · Violines, Flauta move together at the octave or unison for 5 notes (a doubling)"]);
    // Chords are not lines: a piano's block chords are left out.
    const chords = song(["Piano", "Bajo"], [["t1", 60, 0, 1], ["t1", 64, 0, 1], ["t1", 62, 1, 1], ["t1", 65, 1, 1], ["t2", 48, 0, 1], ["t2", 50, 1, 1]]);
    expect(checks(chords, 1).filter((f) => f.check === "parallels")).toHaveLength(0);
  });

  it("stays short on a whole real song", () => {
    const { song: s } = importMidi(DILATACION);
    const text = analysisText(s, { start: 0, end: barStart(s.meter, 60), label: "whole song" });
    expect(text.split("\n").length).toBeLessThan(80);
    expect(text.length).toBeLessThan(9000);
  });
});


