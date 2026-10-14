import { addNotes, addTrack, SongDocument, starterSong, updateTrack, USER, setPedal } from "@fourhands/core";
import { describe, expect, it } from "vitest";
import { audibleTracks, clickEvents, noteEvents, secondsPerTick, setupEvents, windowPieces } from "./schedule.js";

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

  it("prepares programs, volume and pan", () => {
    expect(setupEvents(song().song)).toContainEqual({ kind: "prog", ch: 1, prog: 42, bank: 0 });
    // A track that plays a preset of an installed bank sends that bank's select and preset instead.
    const custom = setupEvents(song().song, (t) => (t.channel === 1 ? { bank: 20, prog: 2 } : null));
    expect(custom).toContainEqual({ kind: "prog", ch: 1, prog: 2, bank: 20 });
    expect(custom).not.toContainEqual({ kind: "prog", ch: 1, prog: 42, bank: 0 });
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
