import { addNotes, addTrack, setTempoChanges, SongDocument, starterSong, updateTrack, USER } from "@fourhands/core";
import { describe, expect, it } from "vitest";
import { SOUNDS_SLOT } from "../shared/engine.js";
import { chunks, exportMessages, exportRange } from "./export-plan.js";

// starterSong: 120 BPM, 4/4, a quarter note is 960 ticks (0.5 s).
function song() {
  const doc = new SongDocument(starterSong());
  doc.transact({ actor: USER, label: "x" }, (tx) => {
    addTrack(tx, { name: "Chelo", program: 42 }); // t2, built-in sound
    addNotes(tx, "t1", [
      { pitch: 60, start: 0, duration: 960, velocity: 80 },
      { pitch: 64, start: 3840, duration: 960, velocity: 70 },
    ]);
    addNotes(tx, "t2", [{ pitch: 48, start: 1920, duration: 3840, velocity: 90 }]);
  });
  return doc;
}

const routing = (over: Partial<Parameters<typeof exportMessages>[2]> = {}) => ({
  stripOf: (t: { channel: number }) => t.channel,
  soundFor: () => null,
  plugin: new Set<number>(),
  external: new Set<number>(),
  ...over,
});

const noteOns = (midi: { data: number[] }[]) => midi.filter((e) => (e.data[0]! & 0xf0) === 0x90 && e.data[2]! > 0);

describe("export plan", () => {
  it("covers the whole song, from bar 1 to the end of the last note", () => {
    const s = song().song;
    expect(exportRange(s, "song")).toEqual({ from: 0, to: 5760 });
    expect(exportRange(s, "loop")).toBeNull();
    expect(exportRange(new SongDocument(starterSong()).song, "song")).toBeNull();
  });

  it("times every event from the start, with the tempo map", () => {
    const doc = song();
    const plan = exportMessages(doc.song, exportRange(doc.song, "song")!, routing());
    expect(plan.seconds).toBeCloseTo(3);
    const ons = noteOns(plan.midi);
    expect(ons.map((e) => [e.data[1], e.delay])).toEqual([
      [60, 0],
      [48, 1],
      [64, 2],
    ]);
    // Built-in sounds: the engine's sounds slot, with the track's strip and full volume (the strip's fader does the mix).
    expect(ons.every((e) => e.slot === SOUNDS_SLOT)).toBe(true);
    expect(plan.midi.find((e) => e.data[0] === 0xb1 && e.data[1] === 7)?.data[2]).toBe(127);
    // Programs and volumes go before any note.
    const firstNote = plan.midi.indexOf(ons[0]!);
    expect(plan.midi.slice(0, firstNote).some((e) => (e.data[0]! & 0xf0) === 0xc0)).toBe(true);

    doc.transact({ actor: USER, label: "slower" }, (tx) => setTempoChanges(tx, [{ tick: 3840, tempo: 1_000_000 }]));
    const slower = exportMessages(doc.song, exportRange(doc.song, "song")!, routing());
    // 2 s at 120 BPM, then two quarter notes at 60 BPM.
    expect(slower.seconds).toBeCloseTo(4);
    expect(noteOns(slower.midi).find((e) => e.data[1] === 64)!.delay).toBeCloseTo(2);
  });

  it("sends a plugin track to its strip, and leaves out a track sent by MIDI to another program", () => {
    const doc = song();
    doc.transact({ actor: USER, label: "plugin" }, (tx) => updateTrack(tx, "t2", { output: "plugin", plugin: { id: "VST3-Kontakt", name: "Kontakt 8" } }));
    const ch = (id: string) => doc.song.tracks[id]!.channel;
    const viaPlugin = exportMessages(doc.song, exportRange(doc.song, "song")!, routing({ plugin: new Set([ch("t2")]) }));
    const cello = noteOns(viaPlugin.midi).find((e) => e.data[1] === 48)!;
    expect(cello.slot).toBe(ch("t2"));
    expect(cello.data[0]).toBe(0x90); // a plugin hears channel 1
    const viaMidi = exportMessages(doc.song, exportRange(doc.song, "song")!, routing({ external: new Set([ch("t2")]) }));
    expect(noteOns(viaMidi.midi).map((e) => e.data[1])).toEqual([60, 64]);
  });

  it("exports the loop from its start, cutting the notes at its end", () => {
    const doc = song();
    doc.setContext({ loop: { start: 1920, end: 3840 } });
    const range = exportRange(doc.song, "loop")!;
    expect(range).toEqual({ from: 1920, to: 3840 });
    const plan = exportMessages(doc.song, range, routing());
    expect(plan.seconds).toBeCloseTo(1);
    expect(noteOns(plan.midi).map((e) => [e.data[1], e.delay])).toEqual([[48, 0]]);
    const off = plan.midi.find((e) => (e.data[0]! & 0xf0) === 0x80 && e.data[1] === 48)!;
    expect(off.delay).toBeCloseTo(1);
    // The transport starts where the loop does.
    expect(plan.transport[0]).toMatchObject({ delay: 0, playing: true, ppq: 2, bpm: 120 });
  });

  it("tells the plugins where the song is at every quarter note", () => {
    const doc = song();
    const plan = exportMessages(doc.song, exportRange(doc.song, "song")!, routing());
    expect(plan.transport.map((p) => p.ppq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(plan.transport.map((p) => p.delay)).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
    expect(plan.transport.every((p) => p.playing && p.num === 4 && p.den === 4)).toBe(true);
  });

  it("goes to the engine in pieces", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
