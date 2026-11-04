import { addBus, addInsert, addNotes, addTrack, SongDocument, setSend, starterSong, updateTrack, USER, setCurve, setPedal } from "@fourhands/core";
import { describe, expect, it } from "vitest";
import { audibleTracks, clickEvents, curveResetEvents, curveStateEvents, noteEvents, secondsPerTick, setupEvents, windowPieces } from "./schedule.js";

function song() {
  const doc = new SongDocument(starterSong());
  doc.transact({ actor: USER, label: "x" }, (tx) => {
    addTrack(tx, { name: "Chelo", program: 42 });
    addNotes(tx, "t1", [
      { pitch: 60, start: 0, duration: 960, velocity: 80 },
      { pitch: 64, start: 960, duration: 1920, velocity: 70 },
    ]);
    addNotes(tx, "t2", [{ pitch: 48, start: 0, duration: 3840, velocity: 90 }]);
    setPedal(tx, "t1", [{ start: 0, end: 1900 }]);
  });
  return doc;
}

describe("schedule", () => {
  it("converts ticks to seconds with the song's tempo", () => {
    expect(secondsPerTick({ tempo: 500_000 }) * 960).toBeCloseTo(0.5);
  });

  it("sends the notes that start in the window, with their note-offs", () => {
    const doc = song();
    const ev = noteEvents(doc.song, 0, 960);
    expect(ev.filter((e) => e.ev.kind === "on").map((e) => (e.ev as { note: number }).note).sort()).toEqual([48, 60]);
    expect(ev.find((e) => e.ev.kind === "off" && e.ev.note === 48)!.tick).toBe(3840);
    expect(ev.find((e) => e.ev.kind === "cc")).toMatchObject({ tick: 0, ev: { cc: 64, value: 127 } });
  });

  it("plays expression and modulation points in their window, and knows where they stand (H4)", () => {
    const doc = song();
    doc.transact({ actor: USER, label: "c" }, (tx) => {
      setCurve(tx, "t2", "expression", 0, 3840, [{ tick: 0, value: 40 }, { tick: 960, value: 80 }, { tick: 1920, value: 110 }]);
      setCurve(tx, "t2", "modulation", 0, 3840, [{ tick: 960, value: 30 }]);
    });
    const cc = noteEvents(doc.song, 900, 1920).filter((e) => e.ev.kind === "cc" && e.ev.cc !== 64).map((e) => [e.tick, (e.ev as { cc: number }).cc, (e.ev as { value: number }).value]);
    expect(cc).toEqual([[960, 11, 80], [960, 1, 30]]);
    expect(curveStateEvents(doc.song, 1500)).toEqual([
      { kind: "cc", ch: 1, cc: 11, value: 80, strip: 1 },
      { kind: "cc", ch: 1, cc: 1, value: 30, strip: 1 },
    ]);
    expect(curveResetEvents(doc.song)).toEqual([
      { kind: "cc", ch: 1, cc: 11, value: 127, strip: 1 },
      { kind: "cc", ch: 1, cc: 1, value: 0, strip: 1 },
    ]);
  });

  it("cuts notes at the loop end", () => {
    const doc = song();
    const ev = noteEvents(doc.song, 0, 960, 1920);
    expect(ev.find((e) => e.ev.kind === "off" && e.ev.note === 48)!.tick).toBe(1920);
  });

  it("follows mute and solo", () => {
    const doc = song();
    doc.transact({ actor: USER, label: "m" }, (tx) => updateTrack(tx, "t1", { mute: true }));
    expect([...audibleTracks(doc.song)]).toEqual(["t2"]);
    doc.transact({ actor: USER, label: "s" }, (tx) => updateTrack(tx, "t1", { solo: true }));
    expect([...audibleTracks(doc.song)]).toEqual(["t1"]);
  });

  it("clicks every beat, higher on the first", () => {
    const ev = clickEvents(song().song, 0, 3840).filter((e) => e.ev.kind === "on");
    expect(ev.map((e) => (e.ev as { note: number }).note)).toEqual([84, 77, 77, 77]);
  });

  it("prepares programs, volume, pan and reverb", () => {
    expect(setupEvents(song().song)).toContainEqual({ kind: "prog", ch: 1, prog: 42, bank: 0, strip: 1 });
    // Reverb send (CC91): 0 when the track has none, so it goes back to dry.
    expect(setupEvents(song().song)).toContainEqual({ kind: "cc", ch: 1, cc: 91, value: 0, strip: 1 });
    const doc = song();
    // Parte D: the send to the reverb bus is CC91 for the window's synth and for a DAW.
    doc.transact({ actor: USER, label: "r" }, (tx) => {
      const bus = addBus(tx, { name: "Reverb" });
      addInsert(tx, bus, { kind: "reverb" });
      setSend(tx, "t1", bus, { level: 0.5 });
    });
    const ch = doc.song.tracks.t1!.channel;
    expect(setupEvents(doc.song)).toContainEqual({ kind: "cc", ch, cc: 91, value: 64, strip: ch });
    // A track that plays a preset of an installed bank sends that bank's select and preset instead.
    const custom = setupEvents(song().song, (t) => (t.channel === 1 ? { bank: 20, prog: 2 } : null));
    expect(custom).toContainEqual({ kind: "prog", ch: 1, prog: 2, bank: 20, strip: 1 });
    expect(custom).not.toContainEqual({ kind: "prog", ch: 1, prog: 42, bank: 0, strip: 1 });
  });

  it("puts every event of a track on its strip, and the metronome on its own (A2, 03/11/2026)", () => {
    const doc = song();
    const stripOf = (t: { id: string }) => (t.id === "t2" ? 300 : 7);
    const setup = setupEvents(doc.song, () => null, stripOf, 99);
    expect(setup[0]).toMatchObject({ kind: "prog", ch: 15, strip: 99 });
    expect(setup.filter((e) => e.kind !== "panic" && e.ch === 1).every((e) => e.kind !== "panic" && e.strip === 300)).toBe(true);
    const notes = noteEvents(doc.song, 0, 3840, Infinity, stripOf);
    expect(notes.filter((e) => e.ev.kind !== "panic" && e.ev.ch === 1).every((e) => e.ev.kind !== "panic" && e.ev.strip === 300)).toBe(true);
    expect(clickEvents(doc.song, 0, 960, 99).every((e) => e.ev.kind !== "panic" && e.ev.strip === 99)).toBe(true);
  });

  it("wraps the window around the loop", () => {
    expect(windowPieces(3500, 600, { start: 0, end: 3840 })).toEqual([
      { from: 3500, to: 3840, offset: 0 },
      { from: 0, to: 260, offset: 340 },
    ]);
    expect(windowPieces(100, 200, null)).toEqual([{ from: 100, to: 300, offset: 0 }]);
    expect(windowPieces(5000, 200, { start: 0, end: 3840 })).toEqual([{ from: 5000, to: 5200, offset: 0 }]);
  });
});
