import { describe, expect, it } from "vitest";
import { addNotes, addSection, addTrack, deleteNotes, moveNotes, removeTrack, setChord, setCurve, setSongProperties, updateNotes, updateTrack } from "./commands.js";
import { CommandError, type Patch, SongDocument } from "./document.js";
import { TRACK_COLOR_COUNT, USER, ai, barAt, barStart, beatTicks, curveValueAt, emptySong, notesOf } from "./model.js";
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

describe("curves: expression (CC11) and modulation (CC1), H4", () => {
  it("replace the points of a span, keep the rest, and undo in one step", () => {
    const { doc, t } = docWithTrack();
    doc.transact({ actor: USER, label: "expresión" }, (tx) => setCurve(tx, t, "expression", 0, 4 * PPQ, [{ tick: 0, value: 40 }, { tick: PPQ, value: 60 }]));
    doc.transact({ actor: USER, label: "más" }, (tx) => setCurve(tx, t, "expression", PPQ, 2 * PPQ, [{ tick: PPQ, value: 90 }, { tick: PPQ + 240, value: 100 }]));
    expect(doc.song.tracks[t]!.curves?.expression).toEqual([
      { tick: 0, value: 40 },
      { tick: PPQ, value: 90 },
      { tick: PPQ + 240, value: 100 },
    ]);
    expect(curveValueAt(doc.song.tracks[t]!.curves?.expression, "expression", PPQ + 300)).toBe(100);
    expect(curveValueAt(undefined, "expression", 0)).toBe(127);
    expect(curveValueAt(undefined, "modulation", 0)).toBe(0);
    doc.undo(USER);
    expect(doc.song.tracks[t]!.curves?.expression?.map((p) => p.value)).toEqual([40, 60]);
    doc.transact({ actor: USER, label: "borrar" }, (tx) => setCurve(tx, t, "expression", 0, 8 * PPQ, []));
    expect(doc.song.tracks[t]!.curves).toBeUndefined(); // nothing left: the field goes away
    doc.undo(USER);
    expect(doc.song.tracks[t]!.curves?.expression).toHaveLength(2);
  });

  it("refuse points outside the span, out of range or on the same tick", () => {
    const { doc, t } = docWithTrack();
    const run = (points: { tick: number; value: number }[]) => () => doc.transact({ actor: USER, label: "x" }, (tx) => setCurve(tx, t, "modulation", 0, PPQ, points));
    expect(run([{ tick: PPQ, value: 10 }])).toThrow(/outside/);
    expect(run([{ tick: 0, value: 128 }])).toThrow(/0-127/);
    expect(run([{ tick: 0, value: 1 }, { tick: 0, value: 2 }])).toThrow(/Two curve points/);
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

describe("sound banks", () => {
  it("a track takes a preset of another bank, and goes back to the default bank, each in one undo step", () => {
    const { doc, t } = docWithTrack();
    const sound = { bank: "Sonatina_Symphonic_Orchestra.sf2", program: 2, bankMSB: 0, name: "1st Violins Sustain" };
    doc.transact({ actor: USER, label: "Sonido" }, (tx) => updateTrack(tx, t, { sound }));
    expect(doc.song.tracks[t]!.sound).toEqual(sound);
    expect(doc.song.tracks[t]!.program).toBe(0); // the General MIDI program stays for MIDI export
    doc.transact({ actor: USER, label: "Banco de serie" }, (tx) => updateTrack(tx, t, { sound: null }));
    expect(doc.song.tracks[t]!.sound).toBeUndefined();
    doc.undo(USER);
    expect(doc.song.tracks[t]!.sound).toEqual(sound);
    doc.undo(USER);
    expect(doc.song.tracks[t]!.sound).toBeUndefined();
  });
  it("a new track can start with a sound of another bank", () => {
    const doc = new SongDocument(emptySong("Prueba"), { now: () => 1000 });
    const sound = { bank: "YDP-GrandPiano-20160804.sf2", program: 0, bankMSB: 0, name: "Grand Piano" };
    const t = doc.transact({ actor: USER, label: "Pista" }, (tx) => addTrack(tx, { name: "Piano", program: 0, sound }));
    expect(doc.song.tracks[t]!.sound).toEqual(sound);
    doc.undo(USER);
    expect(doc.song.tracks[t]).toBeUndefined();
  });
  it("rejects a preset out of range", () => {
    const { doc, t } = docWithTrack();
    expect(() => doc.transact({ actor: USER, label: "x" }, (tx) => updateTrack(tx, t, { sound: { bank: "a.sf2", program: 200, bankMSB: 0, name: "x" } }))).toThrow(CommandError);
  });
});

describe("groups: one AI intervention = one undo step", () => {
  const note = (start: number) => ({ pitch: 60, start, duration: PPQ, velocity: 80 });

  it("joins the calls of an intervention into one step and one history entry", () => {
    const { doc, t } = docWithTrack();
    const before = snapshot(doc);
    const meta = { actor: claude, label: "Contramelodía del chelo", group: "i1" };
    doc.transact(meta, (tx) => addNotes(tx, t, [note(0)]));
    expect(doc.lastChangeMerged).toBe(false);
    doc.transact(meta, (tx) => addNotes(tx, t, [note(PPQ)]));
    expect(doc.lastChangeMerged).toBe(true);
    const [, second] = doc.transact(meta, (tx) => addNotes(tx, t, [note(2 * PPQ), note(3 * PPQ)]));
    doc.transact(meta, (tx) => deleteNotes(tx, [second!]));
    // Every call is live: its own revision, so the window sees it at once.
    expect(doc.song.revision).toBe(5);
    expect(Object.keys(doc.song.notes)).toHaveLength(3);
    expect(doc.history).toHaveLength(2);
    expect(doc.history.at(-1)).toMatchObject({ revision: 5, kind: "edit", label: "Contramelodía del chelo", actor: claude });
    doc.undo(USER);
    expect(snapshot(doc)).toEqual(before);
    doc.redo(USER);
    expect(Object.keys(doc.song.notes)).toHaveLength(3);
  });

  it("starts a new step when the user edits in the middle, so linear undo stays correct", () => {
    const { doc, t } = docWithTrack();
    const meta = { actor: claude, label: "Bajo del verso", group: "i1" };
    const [a] = doc.transact(meta, (tx) => addNotes(tx, t, [note(0)]));
    doc.transact({ actor: USER, label: "moviste 1 nota" }, (tx) => moveNotes(tx, [a!], { ticks: PPQ }));
    doc.transact(meta, (tx) => addNotes(tx, t, [note(2 * PPQ)]));
    expect(doc.lastChangeMerged).toBe(false);
    expect(doc.history.map((h) => h.label)).toEqual(["Nueva pista", "Bajo del verso", "moviste 1 nota", "Bajo del verso"]);
    doc.undo(USER);
    doc.undo(USER);
    expect(doc.song.notes[a!]?.start).toBe(0);
    doc.undo(USER);
    expect(Object.keys(doc.song.notes)).toHaveLength(0);
  });

  it("never joins across an undo, a redo or a closed group", () => {
    const { doc, t } = docWithTrack();
    const meta = { actor: claude, label: "Melodía", group: "i1" };
    doc.transact(meta, (tx) => addNotes(tx, t, [note(0)]));
    doc.undo(USER);
    doc.transact(meta, (tx) => addNotes(tx, t, [note(PPQ)]));
    expect(doc.lastChangeMerged).toBe(false);
    doc.closeGroup("i1");
    doc.transact(meta, (tx) => addNotes(tx, t, [note(2 * PPQ)]));
    expect(doc.lastChangeMerged).toBe(false);
    doc.transact({ ...meta, group: "i2" }, (tx) => addNotes(tx, t, [note(3 * PPQ)]));
    expect(doc.lastChangeMerged).toBe(false);
  });

  it("a failed call leaves the step as it was", () => {
    const { doc, t } = docWithTrack();
    const meta = { actor: claude, label: "Melodía", group: "i1" };
    doc.transact(meta, (tx) => addNotes(tx, t, [note(0)]));
    expect(() => doc.transact(meta, (tx) => addNotes(tx, t, [note(PPQ), { ...note(0), pitch: 200 }]))).toThrow(CommandError);
    doc.transact(meta, (tx) => addNotes(tx, t, [note(2 * PPQ)]));
    expect(doc.lastChangeMerged).toBe(true);
    doc.undo(USER);
    expect(Object.keys(doc.song.notes)).toHaveLength(0);
  });
});

describe("Con / Sin: the last AI intervention, heard with and without it", () => {
  const note = (start: number) => ({ pitch: 60, start, duration: PPQ, velocity: 80 });

  it("is offered only once the intervention has ended, and gives the song as it was before it", () => {
    const { doc, t } = docWithTrack();
    doc.transact({ actor: USER, label: "Tu nota" }, (tx) => addNotes(tx, t, [note(0)]));
    const before = snapshot(doc);
    const meta = { actor: claude, label: "Contramelodía", group: "i1" };
    doc.transact(meta, (tx) => addNotes(tx, t, [note(PPQ)]));
    doc.transact(meta, (tx) => addNotes(tx, t, [note(2 * PPQ)]));
    expect(doc.lastAiStep).toBeNull(); // still writing
    const patches: Patch[] = [];
    doc.subscribe((p) => patches.push(p));
    doc.closeGroup("i1");
    expect(patches).toEqual([{ revision: doc.song.revision, ops: [] }]); // the window learns it can compare
    expect(doc.lastAiStep).toMatchObject({ label: "Contramelodía", author: claude, revision: doc.song.revision });
    const without = doc.songBeforeLastStep()!;
    const { revision: _r, counters: _c, ...rest } = without;
    expect(rest).toEqual(before);
    expect(Object.keys(doc.song.notes)).toHaveLength(3); // the song itself is untouched
  });

  it("is gone as soon as the user changes something, undoes it, or the last step is the user's", () => {
    const { doc, t } = docWithTrack();
    const meta = { actor: claude, label: "Bajo", group: "i1" };
    doc.transact(meta, (tx) => addNotes(tx, t, [note(0)]));
    doc.closeGroup("i1");
    expect(doc.lastAiStep).not.toBeNull();
    doc.transact({ actor: USER, label: "Tu nota" }, (tx) => addNotes(tx, t, [note(PPQ)]));
    expect(doc.lastAiStep).toBeNull();
    doc.undo(USER);
    expect(doc.lastAiStep).not.toBeNull(); // the AI's step is on top again
    doc.undo(USER);
    expect(doc.lastAiStep).toBeNull();
    doc.redo(USER);
    expect(doc.lastAiStep?.label).toBe("Bajo");
  });

  it("closing a group that is not open changes nothing and tells nobody", () => {
    const { doc } = docWithTrack();
    const patches: Patch[] = [];
    doc.subscribe((p) => patches.push(p));
    doc.closeGroup("nope");
    expect(patches).toEqual([]);
  });
});

describe("track colours (H3.2)", () => {
  it("give a new track the first colour nobody uses, and keep it when tracks are removed or reordered", () => {
    const doc = new SongDocument(emptySong("Colores"), { now: () => 1000 });
    const [a, b, c] = doc.transact({ actor: USER, label: "Pistas" }, (tx) => [addTrack(tx, { name: "A" }), addTrack(tx, { name: "B" }), addTrack(tx, { name: "C" })]);
    expect([a, b, c].map((id) => doc.song.tracks[id!]!.color)).toEqual([0, 1, 2]);
    doc.transact({ actor: USER, label: "Quitar B" }, (tx) => removeTrack(tx, b!));
    const d = doc.transact({ actor: USER, label: "D" }, (tx) => addTrack(tx, { name: "D" }));
    expect(doc.song.tracks[d]!.color).toBe(1);
    expect(doc.song.tracks[c!]!.color).toBe(2);
  });

  it("reuse the least used colour when the palette is full", () => {
    const doc = new SongDocument(emptySong("Llena"), { now: () => 1000 });
    const ids = doc.transact({ actor: USER, label: "Pistas" }, (tx) => Array.from({ length: TRACK_COLOR_COUNT + 1 }, (_, i) => addTrack(tx, { name: `P${i}` })));
    expect(ids.map((id) => doc.song.tracks[id]!.color)).toEqual([...Array.from({ length: TRACK_COLOR_COUNT }, (_, i) => i), 0]);
  });

  it("accept a chosen colour, change it in one undo step and refuse one outside the palette", () => {
    const doc = new SongDocument(emptySong("Elegir"), { now: () => 1000 });
    const t = doc.transact({ actor: claude, label: "Chelo" }, (tx) => addTrack(tx, { name: "Chelo", color: 6 }));
    expect(doc.song.tracks[t]!.color).toBe(6);
    doc.transact({ actor: USER, label: "Color" }, (tx) => updateTrack(tx, t, { color: 8 }));
    expect(doc.song.tracks[t]!.color).toBe(8);
    doc.undo(USER);
    expect(doc.song.tracks[t]!.color).toBe(6);
    expect(() => doc.transact({ actor: USER, label: "Mal" }, (tx) => updateTrack(tx, t, { color: TRACK_COLOR_COUNT }))).toThrow(CommandError);
    expect(() => doc.transact({ actor: USER, label: "Mal" }, (tx) => addTrack(tx, { name: "X", color: -1 }))).toThrow(CommandError);
  });
});
