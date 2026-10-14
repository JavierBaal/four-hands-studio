import { describe, expect, it } from "vitest";
import { addNotes, addSection, addTrack, deleteNotes, moveNotes, removeTrack, setChord, setSongProperties, updateNotes, updateTrack } from "./commands.js";
import { CommandError, type Patch, SongDocument } from "./document.js";
import { USER, ai, barAt, barStart, beatTicks, emptySong, notesOf } from "./model.js";
import { EIGHTH_TRIPLET, PPQ, SIXTEENTH, nominalGridPosition } from "./time.js";

const claude = ai("claude-ai");

function docWithTrack() {
  const doc = new SongDocument(emptySong("Prueba"), { now: () => 1000 });
  const t = doc.transact({ actor: USER, label: "Nueva pista" }, (tx) => addTrack(tx, { name: "Piano" }));
  return { doc, t };
}

function snapshot(doc: SongDocument) {
  const { revision: _r, counters: _c, ...rest } = structuredClone(doc.song);
  return rest;
}

describe("meter helpers", () => {
  it("measures bars and beats in 4/4 and 6/8", () => {
    expect(beatTicks({ numerator: 4, denominator: 4 })).toBe(PPQ);
    expect(beatTicks({ numerator: 6, denominator: 8 })).toBe(PPQ / 2);
    expect(barStart({ numerator: 4, denominator: 4 }, 17)).toBe(16 * 4 * PPQ);
    expect(barAt({ numerator: 6, denominator: 8 }, 3 * PPQ)).toBe(2);
  });
});

describe("transactions", () => {
  it("bump the revision once per transaction and sign the history", () => {
    const { doc, t } = docWithTrack();
    expect(doc.song.revision).toBe(1);
    doc.transact({ actor: USER, label: "Acorde" }, (tx) =>
      addNotes(tx, t, [
        { pitch: 57, start: 0, duration: PPQ, velocity: 80 },
        { pitch: 60, start: 0, duration: PPQ, velocity: 80 },
        { pitch: 64, start: 0, duration: PPQ, velocity: 80 },
      ]),
    );
    expect(doc.song.revision).toBe(2);
    expect(Object.keys(doc.song.notes)).toEqual(["n1", "n2", "n3"]);
    expect(doc.history.at(-1)).toEqual({ revision: 2, kind: "edit", actor: USER, author: USER, label: "Acorde", at: 1000 });
  });

  it("are atomic: a failing command leaves the song untouched", () => {
    const { doc, t } = docWithTrack();
    const before = snapshot(doc);
    expect(() =>
      doc.transact({ actor: claude, label: "Melodía" }, (tx) =>
        addNotes(tx, t, [
          { pitch: 60, start: 0, duration: PPQ, velocity: 80 },
          { pitch: 200, start: PPQ, duration: PPQ, velocity: 80 },
        ]),
      ),
    ).toThrow(CommandError);
    expect(snapshot(doc)).toEqual(before);
    expect(doc.song.revision).toBe(1);
    expect(doc.canUndo).toBe(true); // only the track
  });

  it("roll back earlier commands of the same transaction too", () => {
    const { doc, t } = docWithTrack();
    const before = snapshot(doc);
    expect(() =>
      doc.transact({ actor: USER, label: "x" }, (tx) => {
        addNotes(tx, t, [{ pitch: 60, start: 0, duration: PPQ, velocity: 80 }]);
        setChord(tx, 0, "Am");
        updateTrack(tx, t, { volume: 3 });
      }),
    ).toThrow(/Volume/);
    expect(snapshot(doc)).toEqual(before);
  });

  it("that change nothing create no revision and no undo step", () => {
    const { doc, t } = docWithTrack();
    doc.transact({ actor: USER, label: "Nada" }, (tx) => updateTrack(tx, t, { name: "Piano" }));
    expect(doc.song.revision).toBe(1);
    expect(doc.undoLabel).toBe("Nueva pista");
  });

  it("cannot be nested", () => {
    const { doc } = docWithTrack();
    expect(() => doc.transact({ actor: USER, label: "a" }, () => doc.transact({ actor: USER, label: "b" }, () => 0))).toThrow(/nested/);
  });
});

describe("undo and redo", () => {
  it("undo the last transaction whoever made it, as one step", () => {
    const { doc, t } = docWithTrack();
    const beforeAi = snapshot(doc);
    doc.transact({ actor: claude, label: "Claude añadió la melodía" }, (tx) => {
      addNotes(tx, t, [{ pitch: 64, start: 0, duration: PPQ, velocity: 70 }]);
      addNotes(tx, t, [{ pitch: 65, start: PPQ, duration: PPQ, velocity: 70 }]);
      setChord(tx, 0, "Am");
    });
    const afterAi = snapshot(doc);
    expect(doc.undo(USER)).toBe(true);
    expect(snapshot(doc)).toEqual(beforeAi);
    expect(doc.song.revision).toBe(3);
    expect(doc.history.at(-1)).toMatchObject({ kind: "undo", actor: USER, author: claude, label: "Claude añadió la melodía" });
    expect(doc.redo(USER)).toBe(true);
    expect(snapshot(doc)).toEqual(afterAi);
    expect(doc.song.revision).toBe(4);
  });

  it("never reuse ids after undo", () => {
    const { doc, t } = docWithTrack();
    doc.transact({ actor: USER, label: "a" }, (tx) => addNotes(tx, t, [{ pitch: 60, start: 0, duration: PPQ, velocity: 80 }]));
    doc.undo(USER);
    const [id] = doc.transact({ actor: USER, label: "b" }, (tx) => addNotes(tx, t, [{ pitch: 62, start: 0, duration: PPQ, velocity: 80 }]));
    expect(id).toBe("n2");
  });

  it("restore field changes and deleted tracks with their notes", () => {
    const { doc, t } = docWithTrack();
    doc.transact({ actor: USER, label: "a" }, (tx) => addNotes(tx, t, [{ pitch: 60, start: 0, duration: PPQ, velocity: 80 }]));
    const before = snapshot(doc);
    doc.transact({ actor: USER, label: "Borrar pista" }, (tx) => removeTrack(tx, t));
    expect(doc.song.notes).toEqual({});
    expect(doc.song.trackOrder).toEqual([]);
    doc.undo(USER);
    expect(snapshot(doc)).toEqual(before);
  });

  it("clear the redo stack after a new edit", () => {
    const { doc } = docWithTrack();
    doc.undo(USER);
    expect(doc.canRedo).toBe(true);
    doc.transact({ actor: USER, label: "x" }, (tx) => setSongProperties(tx, { title: "Otra" }));
    expect(doc.canRedo).toBe(false);
    expect(doc.redo(USER)).toBe(false);
  });
});

describe("patches", () => {
  it("are emitted after every change with the new revision", () => {
    const { doc, t } = docWithTrack();
    const patches: Patch[] = [];
    doc.subscribe((p) => patches.push(p));
    doc.transact({ actor: USER, label: "a" }, (tx) => addNotes(tx, t, [{ pitch: 60, start: 0, duration: PPQ, velocity: 80 }]));
    doc.undo(USER);
    expect(patches.map((p) => p.revision)).toEqual([2, 3]);
    expect(patches[0]!.ops[0]).toMatchObject({ op: "set", path: ["notes", "n1"] });
    expect(patches[1]!.ops[0]).toEqual({ op: "remove", path: ["notes", "n1"] });
  });
});

describe("shared context", () => {
  it("is not undoable and does not bump the revision", () => {
    const { doc, t } = docWithTrack();
    const [a, b] = doc.transact({ actor: USER, label: "a" }, (tx) =>
      addNotes(tx, t, [
        { pitch: 60, start: 0, duration: PPQ, velocity: 80 },
        { pitch: 62, start: PPQ, duration: PPQ, velocity: 80 },
      ]),
    );
    doc.setContext({ selection: [a!, b!], cursor: PPQ, loop: { start: 0, end: 4 * PPQ } });
    expect(doc.song.revision).toBe(2);
    expect(doc.undoLabel).toBe("a");
  });

  it("forgets deleted notes and tracks", () => {
    const { doc, t } = docWithTrack();
    const [a, b] = doc.transact({ actor: USER, label: "a" }, (tx) =>
      addNotes(tx, t, [
        { pitch: 60, start: 0, duration: PPQ, velocity: 80 },
        { pitch: 62, start: PPQ, duration: PPQ, velocity: 80 },
      ]),
    );
    doc.setContext({ selection: [a!, b!], activeTrackId: t });
    doc.transact({ actor: USER, label: "Borrar" }, (tx) => deleteNotes(tx, [a!]));
    expect(doc.song.context.selection).toEqual([b]);
    doc.transact({ actor: USER, label: "Borrar pista" }, (tx) => removeTrack(tx, t));
    expect(doc.song.context).toMatchObject({ selection: [], activeTrackId: null });
  });
});

describe("commands", () => {
  it("validate their input with readable errors", () => {
    const { doc, t } = docWithTrack();
    const tryAdd = (spec: { pitch: number; start: number; duration: number; velocity: number }) =>
      doc.transact({ actor: USER, label: "x" }, (tx) => addNotes(tx, t, [spec]));
    expect(() => tryAdd({ pitch: 60, start: -1, duration: PPQ, velocity: 80 })).toThrow(/start/);
    expect(() => tryAdd({ pitch: 60, start: 0, duration: 0, velocity: 80 })).toThrow(/duration/);
    expect(() => tryAdd({ pitch: 60, start: 0, duration: PPQ, velocity: 0 })).toThrow(/Velocity/);
    expect(() => tryAdd({ pitch: 60, start: 0.5, duration: PPQ, velocity: 80 })).toThrow(/start/);
    expect(() => doc.transact({ actor: USER, label: "x" }, (tx) => addNotes(tx, "t99", []))).toThrow(/Unknown track/);
    expect(() => doc.transact({ actor: USER, label: "x" }, (tx) => addSection(tx, { name: "Coro", startBar: 9, endBar: 8 }))).toThrow(/end bar/);
  });

  it("give new tracks a free channel and keep 9 for percussion", () => {
    const doc = new SongDocument(emptySong());
    doc.transact({ actor: USER, label: "x" }, (tx) => {
      for (let i = 0; i < 10; i++) addTrack(tx, { name: `P${i}` });
      addTrack(tx, { name: "Timbales", percussion: true });
    });
    const tracks = Object.values(doc.song.tracks);
    expect(tracks.map((tr) => tr.channel)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 9]);
    expect(tracks.at(-1)!.program).toBeNull();
  });

  it("keep each note's deviation when moving by whole grid steps (ESPEC_PIANO_ROLL.md, 5.3)", () => {
    const { doc, t } = docWithTrack();
    const played = [PPQ + 17, 2 * PPQ - 11, 2 * PPQ + 320 + 6];
    const ids = doc.transact({ actor: USER, label: "Toma" }, (tx) =>
      addNotes(tx, t, played.map((start) => ({ pitch: 60, start, duration: 200, velocity: 80 }))),
    );
    const deviations = () => ids.map((id) => nominalGridPosition(doc.song.notes[id]!.start).deviationTicks);
    const before = deviations();
    // Whole beats are whole steps of both grids.
    doc.transact({ actor: USER, label: "Mover" }, (tx) => moveNotes(tx, ids, { ticks: 4 * PPQ, semitones: 2 }));
    expect(deviations()).toEqual(before);
    // Sixteenth steps for the straight notes, eighth-triplet steps for the triplet.
    doc.transact({ actor: USER, label: "Mover" }, (tx) => {
      moveNotes(tx, ids.slice(0, 2), { ticks: 3 * SIXTEENTH });
      moveNotes(tx, ids.slice(2), { ticks: 2 * EIGHTH_TRIPLET });
    });
    expect(deviations()).toEqual(before);
    expect(notesOf(doc.song).map((n) => n.pitch)).toEqual([62, 62, 62]);
  });

  it("reject a move that would push a note out of range, without moving any", () => {
    const { doc, t } = docWithTrack();
    const ids = doc.transact({ actor: USER, label: "a" }, (tx) =>
      addNotes(tx, t, [
        { pitch: 60, start: 0, duration: PPQ, velocity: 80 },
        { pitch: 126, start: 0, duration: PPQ, velocity: 80 },
      ]),
    );
    expect(() => doc.transact({ actor: USER, label: "b" }, (tx) => moveNotes(tx, ids, { semitones: 3 }))).toThrow(/Pitch/);
    expect(notesOf(doc.song).map((n) => n.pitch)).toEqual([60, 126]);
  });

  it("change only what differs", () => {
    const { doc, t } = docWithTrack();
    const [id] = doc.transact({ actor: USER, label: "a" }, (tx) => addNotes(tx, t, [{ pitch: 60, start: 0, duration: PPQ, velocity: 80 }]));
    const patches: Patch[] = [];
    doc.subscribe((p) => patches.push(p));
    doc.transact({ actor: USER, label: "b" }, (tx) => updateNotes(tx, [{ id: id!, pitch: 60, velocity: 90 }]));
    expect(patches[0]!.ops.filter((op) => op.path[0] === "notes")).toEqual([{ op: "set", path: ["notes", "n1", "velocity"], value: 90 }]);
  });
});

describe("commands as data", () => {
  it("run as one transaction and return what they create", async () => {
    const { runCommands } = await import("./command-data.js");
    const doc = new SongDocument(emptySong());
    const results = doc.transact({ actor: USER, label: "Gesto" }, (tx) =>
      runCommands(tx, [
        { type: "addTrack", spec: { name: "Piano" } },
        { type: "addNotes", trackId: "t1", notes: [{ pitch: 60, start: 0, duration: PPQ, velocity: 80 }] },
        { type: "moveNotes", ids: ["n1"], semitones: 2 },
        { type: "setChord", tick: 0, symbol: "D" },
      ]),
    );
    expect(results).toEqual(["t1", ["n1"], null, null]);
    expect(doc.song.notes.n1!.pitch).toBe(62);
    expect(doc.song.revision).toBe(1);
  });

  it("reject unknown commands without changing anything", async () => {
    const { runCommands } = await import("./command-data.js");
    const doc = new SongDocument(emptySong());
    expect(() =>
      doc.transact({ actor: USER, label: "x" }, (tx) =>
        runCommands(tx, [{ type: "addTrack", spec: { name: "P" } }, { type: "explode" } as never]),
      ),
    ).toThrow(/Unknown command/);
    expect(doc.song.trackOrder).toEqual([]);
  });
});

describe("annotations", () => {
  it("can be edited and the edit undone", async () => {
    const { runCommands } = await import("./command-data.js");
    const doc = new SongDocument(emptySong());
    const [id] = doc.transact({ actor: USER, label: "a" }, (tx) => runCommands(tx, [{ type: "addAnnotation", spec: { start: 0, end: 3840, trackIds: [], text: "que respire" } }]));
    doc.transact({ actor: USER, label: "b" }, (tx) => runCommands(tx, [{ type: "updateAnnotation", id: id as string, changes: { text: "más aire", end: 7680 } }]));
    expect(doc.song.annotations[id as string]).toMatchObject({ text: "más aire", end: 7680 });
    doc.undo(USER);
    expect(doc.song.annotations[id as string]).toMatchObject({ text: "que respire", end: 3840 });
    expect(() => doc.transact({ actor: USER, label: "c" }, (tx) => runCommands(tx, [{ type: "updateAnnotation", id: id as string, changes: { end: -1 } }]))).toThrow();
  });
});
