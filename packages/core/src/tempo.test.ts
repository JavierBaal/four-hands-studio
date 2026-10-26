import { describe, expect, it } from "vitest";
import { setKeyChanges, setSongProperties, setTempoChanges } from "./commands.js";
import { CommandError, SongDocument } from "./document.js";
import { parseSongFile, serializeSong } from "./file.js";
import { exportMidi, importMidi, tempoEvents } from "./midi.js";
import { USER, barStart, emptySong } from "./model.js";
import { MusicError, keyChangesText, parseKeyChanges, parseTempoChanges, tempoChangesText } from "./notation.js";
import { bpmAt, keyAt, secondsAt, secondsBetween, steadyTempo, tempoMarks, tickAtSeconds } from "./tempo.js";
import { PPQ } from "./time.js";

const BAR = 4 * PPQ;
const us = (bpm: number) => Math.round(60_000_000 / bpm);

function doc() {
  const song = emptySong("Marcha");
  song.tempo = us(120);
  return new SongDocument(song);
}

describe("tempo map (H4)", () => {
  it("keeps one tempo by default: a quarter is 0.5 s at 120", () => {
    const d = doc();
    expect(steadyTempo(d.song)).toBe(true);
    expect(secondsAt(d.song, PPQ)).toBeCloseTo(0.5);
    expect(tickAtSeconds(d.song, 2)).toBeCloseTo(4 * PPQ);
  });

  it("jumps: the time after a change runs at the new tempo", () => {
    const d = doc();
    d.transact({ actor: USER, label: "t" }, (tx) => setTempoChanges(tx, [{ tick: BAR, tempo: us(60) }]));
    expect(secondsAt(d.song, BAR)).toBeCloseTo(2);
    expect(secondsBetween(d.song, BAR, 2 * BAR)).toBeCloseTo(4);
    expect(bpmAt(d.song, BAR - 1)).toBe(120);
    expect(bpmAt(d.song, BAR)).toBeCloseTo(60);
    expect(tickAtSeconds(d.song, 4)).toBeCloseTo(BAR + 2 * PPQ);
  });

  it("glides in a ramp: between the two tempi, and the inverse agrees", () => {
    const d = doc();
    // 120 until bar 2, then a ritardando to 60 at bar 3.
    d.transact({ actor: USER, label: "t" }, (tx) => setTempoChanges(tx, [{ tick: BAR, tempo: us(120) }, { tick: 2 * BAR, tempo: us(60), ramp: true }]));
    const ramp = secondsBetween(d.song, BAR, 2 * BAR);
    expect(ramp).toBeGreaterThan(2);
    expect(ramp).toBeLessThan(4);
    // Exact: 60/(PPQ*k) * ln(60/120) with k = -60/BAR BPM per tick.
    expect(ramp).toBeCloseTo((60 / (PPQ * (-60 / BAR))) * Math.log(0.5), 9);
    expect(bpmAt(d.song, BAR + BAR / 2)).toBeCloseTo(90);
    for (const t of [BAR + 100, BAR + 1500, 2 * BAR - 1, 2 * BAR + 700]) expect(tickAtSeconds(d.song, secondsAt(d.song, t))).toBeCloseTo(t, 6);
  });

  it("is a command with its undo, and rejects what makes no sense", () => {
    const d = doc();
    d.transact({ actor: USER, label: "t" }, (tx) => setTempoChanges(tx, [{ tick: BAR, tempo: us(80) }]));
    d.transact({ actor: USER, label: "t" }, (tx) => setTempoChanges(tx, []));
    expect("tempoChanges" in d.song).toBe(false);
    d.undo(USER);
    expect(d.song.tempoChanges).toEqual([{ tick: BAR, tempo: us(80) }]);
    expect(() => d.transact({ actor: USER, label: "x" }, (tx) => setTempoChanges(tx, [{ tick: 0, tempo: us(80) }]))).toThrow(CommandError);
    expect(() => d.transact({ actor: USER, label: "x" }, (tx) => setTempoChanges(tx, [{ tick: BAR, tempo: us(80) }, { tick: BAR, tempo: us(70) }]))).toThrow(CommandError);
    expect(() => d.transact({ actor: USER, label: "x" }, (tx) => setTempoChanges(tx, [{ tick: BAR, tempo: us(3) }]))).toThrow(CommandError);
  });

  it("is read and written as text: jumps, ramps and fermatas", () => {
    const d = doc();
    const points = parseTempoChanges(d.song, "2.1 100\n3.1 rit 60\n4.1 accel 120\n5.3 fermata\n6.1 fermata 3 1/2");
    expect(points).toEqual([
      { tick: BAR, tempo: us(100) },
      { tick: 2 * BAR, tempo: us(60), ramp: true },
      { tick: 3 * BAR, tempo: us(120), ramp: true },
      { tick: 4 * BAR + 2 * PPQ, tempo: us(120) * 2 },
      { tick: 4 * BAR + 3 * PPQ, tempo: us(120) },
      { tick: 5 * BAR, tempo: us(120) * 3 },
      { tick: 5 * BAR + 2 * PPQ, tempo: us(120) },
    ]);
    d.transact({ actor: USER, label: "t" }, (tx) => setTempoChanges(tx, points.slice(0, 3)));
    expect(tempoChangesText(d.song)).toBe("2.1 100\n3.1 rit 60\n4.1 accel 120");
    expect(parseTempoChanges(d.song, tempoChangesText(d.song))).toEqual(d.song.tempoChanges);
  });

  it("reads as marks on a ruler: jumps, ramps and fermatas", () => {
    const d = doc();
    d.transact({ actor: USER, label: "t" }, (tx) => setTempoChanges(tx, parseTempoChanges(d.song, "2.1 100\n3.1 rit 60\n5.3 fermata 3")));
    expect(tempoMarks(d.song)).toEqual([
      { kind: "jump", tick: BAR, bpm: 100 },
      { kind: "ramp", tick: 2 * BAR, from: BAR, bpm: 60, slower: true },
      { kind: "fermata", tick: 4 * BAR + 2 * PPQ, end: 4 * BAR + 3 * PPQ, factor: 3 },
    ]);
  });

  it("explains what is wrong in a line", () => {
    const song = doc().song;
    expect(() => parseTempoChanges(song, "1.1 90")).toThrow(/set_song_properties/);
    expect(() => parseTempoChanges(song, "3.1 80\n2.1 70")).toThrow(/Line 2.*in order/);
    expect(() => parseTempoChanges(song, "3.1 rit 140")).toThrow(/ritardando goes slower than 120/);
    expect(() => parseTempoChanges(song, "3.1 accel 100")).toThrow(/accelerando goes faster/);
    expect(() => parseTempoChanges(song, "3.1 lento")).toThrow(MusicError);
    expect(() => parseTempoChanges(song, "3.1 fermata 20")).toThrow(/1.5 to 8 times/);
  });

  it("leaves the MIDI file as steps that last exactly what the song lasts", () => {
    const d = doc();
    d.transact({ actor: USER, label: "t" }, (tx) => setTempoChanges(tx, [{ tick: BAR, tempo: us(120) }, { tick: 2 * BAR, tempo: us(60), ramp: true }]));
    const events = tempoEvents(d.song);
    expect(events[0]).toEqual({ tick: 0, tempo: us(120) });
    expect(events.filter((e) => e.tick >= BAR && e.tick < 2 * BAR)).toHaveLength(BAR / (PPQ / 4));
    const back = importMidi(exportMidi(d.song)).song;
    expect(steadyTempo(back)).toBe(false);
    expect(secondsAt(back, 3 * BAR)).toBeCloseTo(secondsAt(d.song, 3 * BAR), 3);
  });
});

describe("key changes (H4)", () => {
  it("say which key is in force, on bar lines, with undo; a change to the same key is dropped", () => {
    const d = doc();
    d.transact({ actor: USER, label: "k" }, (tx) => setSongProperties(tx, { key: { fifths: 0, mode: "minor" } }));
    d.transact({ actor: USER, label: "k" }, (tx) =>
      setKeyChanges(tx, [
        { tick: 4 * BAR, key: { fifths: 0, mode: "minor" } },
        { tick: 8 * BAR, key: { fifths: 0, mode: "major" } },
      ]),
    );
    expect(d.song.keyChanges).toEqual([{ tick: 8 * BAR, key: { fifths: 0, mode: "major" } }]);
    expect(keyAt(d.song, 8 * BAR - 1)).toEqual({ fifths: 0, mode: "minor" });
    expect(keyAt(d.song, 8 * BAR)).toEqual({ fifths: 0, mode: "major" });
    expect(keyChangesText(d.song)).toBe("c. 9 C major");
    expect(() => d.transact({ actor: USER, label: "x" }, (tx) => setKeyChanges(tx, [{ tick: BAR + 1, key: { fifths: 1, mode: "major" } }]))).toThrow(CommandError);
    d.undo(USER);
    expect("keyChanges" in d.song).toBe(false);
  });

  it("are read by bar or by section", () => {
    const d = doc();
    d.song.sections.s1 = { id: "s1", name: "Coro", startBar: 17, endBar: 24 };
    expect(parseKeyChanges(d.song, "9 D major\nCoro Re menor")).toEqual([
      { tick: barStart(d.song.meter, 9), key: { fifths: 2, mode: "major" } },
      { tick: barStart(d.song.meter, 17), key: { fifths: -1, mode: "minor" } },
    ]);
    expect(() => parseKeyChanges(d.song, "1 D major")).toThrow(/set_song_properties/);
    expect(() => parseKeyChanges(d.song, "9 H major")).toThrow(/Line 1/);
  });

  it("travel in the .fourhands and in MIDI", () => {
    const d = doc();
    d.transact({ actor: USER, label: "k" }, (tx) => {
      setKeyChanges(tx, [{ tick: 8 * BAR, key: { fifths: -3, mode: "major" } }]);
      setTempoChanges(tx, [{ tick: 2 * BAR, tempo: us(90), ramp: true }]);
    });
    const opened = parseSongFile(serializeSong({ song: d.song, history: d.history, proposals: [] })).song;
    expect(opened.keyChanges).toEqual(d.song.keyChanges);
    expect(opened.tempoChanges).toEqual(d.song.tempoChanges);
    expect(importMidi(exportMidi(d.song)).song.keyChanges).toEqual(d.song.keyChanges);
  });
});
