/**
 * Authorship rule (PRD_MVP.md, 4.5; ESTUDIO_INTERFAZ.md, 8.7):
 * a note belongs to whoever decided its current pitch, position and duration.
 */
import { describe, expect, it } from "vitest";
import { addNotes, addTrack, addAnnotation, moveNotes, updateNotes } from "./commands.js";
import { SongDocument } from "./document.js";
import { USER, ai, emptySong, type Note } from "./model.js";
import { PPQ } from "./time.js";

const claude = ai("claude-ai");
const otherAi = ai("chatgpt");

function setup() {
  const doc = new SongDocument(emptySong());
  const t = doc.transact({ actor: USER, label: "Pista" }, (tx) => addTrack(tx, { name: "Violines" }));
  const [userNote] = doc.transact({ actor: USER, label: "Mi nota" }, (tx) =>
    addNotes(tx, t, [{ pitch: 64, start: 0, duration: PPQ, velocity: 70 }]),
  );
  const [aiNote] = doc.transact({ actor: claude, label: "Claude añadió una nota" }, (tx) =>
    addNotes(tx, t, [{ pitch: 67, start: PPQ, duration: PPQ, velocity: 70 }]),
  );
  const note = (id: string | undefined): Note => doc.song.notes[id!]!;
  return { doc, t, userNote: userNote!, aiNote: aiNote!, note };
}

describe("authorship", () => {
  it("a new note belongs to whoever wrote it, AI client included", () => {
    const { userNote, aiNote, note } = setup();
    expect(note(userNote)).toMatchObject({ createdBy: USER, shapedBy: USER });
    expect(note(aiNote)).toMatchObject({ createdBy: claude, shapedBy: claude });
  });

  it.each([
    ["pitch", { pitch: 66 }],
    ["position", { start: 2 * PPQ }],
    ["duration", { duration: PPQ / 2 }],
  ])("changing the %s of an AI note makes it the user's", (_label, change) => {
    const { doc, aiNote, note } = setup();
    doc.transact({ actor: USER, label: "Editar" }, (tx) => updateNotes(tx, [{ id: aiNote, ...change }]));
    expect(note(aiNote).shapedBy).toEqual(USER);
    expect(note(aiNote).createdBy).toEqual(claude);
  });

  it("moving an AI note half a tone makes it the user's (ESTUDIO_INTERFAZ.md)", () => {
    const { doc, aiNote, note } = setup();
    doc.transact({ actor: USER, label: "Mover" }, (tx) => moveNotes(tx, [aiNote], { semitones: -1 }));
    expect(note(aiNote).shapedBy).toEqual(USER);
  });

  it("changing only the velocity does not change the author", () => {
    const { doc, aiNote, userNote, note } = setup();
    doc.transact({ actor: USER, label: "Dinámica" }, (tx) => updateNotes(tx, [{ id: aiNote, velocity: 100 }]));
    doc.transact({ actor: claude, label: "Dinámica" }, (tx) => updateNotes(tx, [{ id: userNote, velocity: 40 }]));
    expect(note(aiNote).shapedBy).toEqual(claude);
    expect(note(userNote).shapedBy).toEqual(USER);
  });

  it("moving a note to another track does not change the author", () => {
    const { doc, aiNote, note } = setup();
    const t2 = doc.transact({ actor: USER, label: "Pista" }, (tx) => addTrack(tx, { name: "Violas" }));
    doc.transact({ actor: USER, label: "Pasar a violas" }, (tx) => updateNotes(tx, [{ id: aiNote, trackId: t2 }]));
    expect(note(aiNote).shapedBy).toEqual(claude);
  });

  it("setting a field to its current value is not a change", () => {
    const { doc, aiNote, note } = setup();
    doc.transact({ actor: USER, label: "Nada" }, (tx) => updateNotes(tx, [{ id: aiNote, pitch: 67, start: PPQ }]));
    expect(note(aiNote).shapedBy).toEqual(claude);
  });

  it("the AI reshaping a user note makes it the AI's", () => {
    const { doc, userNote, note } = setup();
    doc.transact({ actor: claude, label: "Claude ajustó la nota" }, (tx) => updateNotes(tx, [{ id: userNote, pitch: 65 }]));
    expect(note(userNote).shapedBy).toEqual(claude);
    expect(note(userNote).createdBy).toEqual(USER);
  });

  it("tells AI clients apart", () => {
    const { doc, aiNote, note } = setup();
    doc.transact({ actor: otherAi, label: "Otra IA" }, (tx) => updateNotes(tx, [{ id: aiNote, duration: 2 * PPQ }]));
    expect(note(aiNote).shapedBy).toEqual(otherAi);
  });

  it("accepting a proposal keeps the AI as author, and the history says the user accepted it", () => {
    const { doc, t, userNote, note } = setup();
    // In H4 a proposal stores the AI's operations; accepting replays them as a user transaction
    // with the AI as author.
    const ids = doc.transact({ actor: USER, author: claude, label: "Aceptó la propuesta p1" }, (tx) => {
      updateNotes(tx, [{ id: userNote, pitch: 62 }]);
      return addNotes(tx, t, [{ pitch: 72, start: 2 * PPQ, duration: PPQ, velocity: 70 }]);
    });
    expect(note(ids[0]).shapedBy).toEqual(claude);
    expect(note(ids[0]).createdBy).toEqual(claude);
    expect(note(userNote).shapedBy).toEqual(claude);
    expect(doc.history.at(-1)).toMatchObject({ actor: USER, author: claude, label: "Aceptó la propuesta p1" });
  });

  it("undo restores the previous author", () => {
    const { doc, aiNote, note } = setup();
    doc.transact({ actor: USER, label: "Editar" }, (tx) => updateNotes(tx, [{ id: aiNote, pitch: 69 }]));
    doc.undo(USER);
    expect(note(aiNote)).toMatchObject({ pitch: 67, shapedBy: claude });
  });

  it("annotations carry their author too", () => {
    const { doc } = setup();
    const id = doc.transact({ actor: claude, label: "Nota" }, (tx) => addAnnotation(tx, { start: 0, end: PPQ, trackIds: [], text: "Aquí entra el chelo" }));
    expect(doc.song.annotations[id]!.author).toEqual(claude);
  });
});
