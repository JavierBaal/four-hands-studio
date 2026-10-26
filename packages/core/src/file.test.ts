import { describe, expect, it } from "vitest";
import { addNotes, addTrack, setChord, updateNotes, updateTrack } from "./commands.js";
import { SongDocument } from "./document.js";
import { FILE_VERSION, FourHandsFileError, parseSongFile, serializeSong } from "./file.js";
import { DILATACION } from "./test-support/dilatacion.js";
import { exportMidi, importMidi } from "./midi.js";
import { USER, ai, emptySong } from "./model.js";
import { PPQ } from "./time.js";

const claude = ai("claude-ai");

function sampleDoc() {
  const doc = new SongDocument(emptySong("Nocturno"), { now: () => 42 });
  const t = doc.transact({ actor: USER, label: "Pista" }, (tx) => addTrack(tx, { name: "Piano" }));
  doc.transact({ actor: claude, label: "Claude añadió dos notas" }, (tx) => {
    addNotes(tx, t, [
      { pitch: 69, start: 0, duration: PPQ, velocity: 70 },
      { pitch: 72, start: PPQ + 13, duration: PPQ / 2, velocity: 60, releaseVelocity: 30 },
    ]);
    setChord(tx, 0, "Am");
  });
  doc.transact({ actor: USER, label: "Cambié una nota" }, (tx) => updateNotes(tx, [{ id: "n1", pitch: 71 }]));
  doc.setContext({ selection: ["n2"], cursor: PPQ, activeTrackId: t });
  return doc;
}

describe(".fourhands", () => {
  it("saves and opens a song without losing anything", () => {
    const doc = sampleDoc();
    const text = serializeSong({ song: doc.song, history: doc.history, proposals: [] });
    const opened = parseSongFile(text);
    expect(opened.song).toEqual(doc.song);
    expect(opened.history).toEqual(doc.history);
    expect(opened.proposals).toEqual([]);
    expect(serializeSong(opened)).toBe(text);
  });

  it("keeps the reverb of a track and opens files without it", () => {
    const doc = sampleDoc();
    doc.transact({ actor: USER, label: "Reverb" }, (tx) => updateTrack(tx, "t1", { reverb: 0.35 }));
    const opened = parseSongFile(serializeSong({ song: doc.song, history: doc.history, proposals: [] }));
    expect(opened.song.tracks.t1!.reverb).toBe(0.35);
    const before = parseSongFile(serializeSong({ song: sampleDoc().song, history: [], proposals: [] }));
    expect(before.song.tracks.t1!.reverb).toBeUndefined();
  });

  it("keeps the sound a track takes from a bank the user installed", () => {
    const doc = sampleDoc();
    const sound = { bank: "YDP-GrandPiano-20160804.sf2", program: 0, bankMSB: 0, name: "Grand Piano" };
    doc.transact({ actor: USER, label: "Sonido" }, (tx) => updateTrack(tx, "t1", { sound }));
    const opened = parseSongFile(serializeSong({ song: doc.song, history: doc.history, proposals: [] }));
    expect(opened.song.tracks.t1!.sound).toEqual(sound);
    expect(opened.song.tracks.t1!.program).toBe(0);
  });

  it("is readable JSON with its format and version first, one note per line", () => {
    const doc = sampleDoc();
    const text = serializeSong({ song: doc.song, history: doc.history, proposals: [] });
    const lines = text.split("\n");
    expect(lines[1]).toBe('  "format": "fourhands",');
    expect(lines[2]).toBe(`  "version": ${FILE_VERSION},`);
    expect(lines.some((l) => l.trim().startsWith('"n2": {"id":"n2"'))).toBe(true);
  });

  it("keeps Dilatacion identical through a save and an open (H1 closing test)", () => {
    const { song } = importMidi(DILATACION);
    const opened = parseSongFile(serializeSong({ song, history: [], proposals: [] }));
    expect(Buffer.from(exportMidi(opened.song)).equals(Buffer.from(DILATACION))).toBe(true);
  });

  it("carries on numbering after opening: ids are never reused", () => {
    const doc = sampleDoc();
    const opened = parseSongFile(serializeSong({ song: doc.song, history: doc.history, proposals: [] }));
    const again = new SongDocument(opened.song, { history: opened.history });
    const [id] = again.transact({ actor: USER, label: "Nota" }, (tx) => addNotes(tx, "t1", [{ pitch: 60, start: 0, duration: PPQ, velocity: 80 }]));
    expect(id).toBe("n3");
    expect(again.song.revision).toBe(doc.song.revision + 1);
    expect(again.history).toHaveLength(doc.history.length + 1);
  });

  it("repairs counters that would reuse an id", () => {
    const doc = sampleDoc();
    const data = JSON.parse(serializeSong({ song: doc.song, history: [], proposals: [] }));
    data.song.counters.n = 1;
    expect(parseSongFile(JSON.stringify(data)).song.counters.n).toBe(3);
  });

  describe("refuses with a clear reason", () => {
    const valid = () => JSON.parse(serializeSong({ song: sampleDoc().song, history: [], proposals: [] }));
    const refuse = (text: string, reason: RegExp) => expect(() => parseSongFile(text)).toThrow(reason);

    it("damaged or foreign files", () => {
      refuse('{"format": "fourhands", "vers', /not valid JSON/);
      refuse('{"hello": 1}', /not a Four Hands Studio song/);
      expect(() => parseSongFile("[]")).toThrow(FourHandsFileError);
    });

    it("songs from a newer version", () => {
      refuse(JSON.stringify({ ...valid(), version: FILE_VERSION + 1 }), /newer version/);
    });

    it("invalid values, saying where", () => {
      const data = valid();
      data.song.notes.n1.pitch = 300;
      refuse(JSON.stringify(data), /song\.notes\.n1\.pitch/);
    });

    it("broken references", () => {
      const data = valid();
      data.song.notes.n1.trackId = "t9";
      refuse(JSON.stringify(data), /note n1 is on a missing track/);
      const other = valid();
      other.song.notes.n1.id = "n7";
      refuse(JSON.stringify(other), /notes\.n1/);
      const order = valid();
      order.song.trackOrder = [];
      refuse(JSON.stringify(order), /track order/);
    });
  });
});
