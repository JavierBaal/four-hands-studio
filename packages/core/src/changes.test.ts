import { describe, expect, it } from "vitest";
import { changesText } from "./changes.js";
import { addAnnotation, addNotes, addSection, moveNotes, setChord, setSongProperties, updateTrack } from "./commands.js";
import { SongDocument } from "./document.js";
import { USER, ai, notesOf, orderedTracks } from "./model.js";
import { importMidi } from "./midi.js";
import { summaryText } from "./summary.js";
import { PPQ } from "./time.js";
import { DILATACION } from "./test-support/dilatacion.js";

const claude = ai("claude-ai");
const BAR = 4 * PPQ;

function dilatacion() {
  const doc = new SongDocument(importMidi(DILATACION).song, { now: () => 1000 });
  const cello = orderedTracks(doc.song).find((t) => /chelo|cello/i.test(t.name))!;
  return { doc, cello };
}

describe("get_changes_since: what changed between two versions", () => {
  it("lists the history, the notes per track with every note when they are few, and the rest by kind", () => {
    const { doc, cello } = dilatacion();
    const before = structuredClone(doc.song);
    const from = doc.history.length;
    const [moved] = notesOf(doc.song, cello.id);
    doc.transact({ actor: USER, label: "moviste 1 nota (c. 9)" }, (tx) => moveNotes(tx, [moved!.id], { ticks: PPQ }));
    doc.transact({ actor: claude, label: "Contracanto", group: "i1" }, (tx) => addNotes(tx, cello.id, [{ pitch: 50, start: 20 * BAR, duration: PPQ, velocity: 70 }]));
    doc.transact({ actor: USER, label: "acorde" }, (tx) => setChord(tx, 20 * BAR, "Dm9"));
    doc.transact({ actor: USER, label: "tempo" }, (tx) => setSongProperties(tx, { tempo: 750_000 }));
    doc.transact({ actor: USER, label: "sección" }, (tx) => addSection(tx, { name: "Coda", startBar: 53, endBar: 56 }));
    doc.transact({ actor: USER, label: "mezcla" }, (tx) => updateTrack(tx, cello.id, { volume: 0.5, pan: -0.3 }));
    doc.transact({ actor: USER, label: "nota" }, (tx) => addAnnotation(tx, { start: 0, end: BAR, trackIds: [], text: "más aire" }));
    const text = changesText(before, doc.song, { since: "since your last call", history: doc.history.slice(from), aiName: () => "Claude" });
    expect(text).toMatch(/^Four Hands · changes r\d+ → r\d+ \(since your last call\)/);
    expect(text).toContain("user · moviste 1 nota (c. 9)");
    expect(text).toContain("Claude (claude-ai) · Contracanto");
    expect(text).toContain("Notes: 1 added, 1 changed, 0 removed");
    expect(text).toContain(`${cello.name} (${cello.id}): 1 added c. 21 (AI) · 1 changed c. 17 (timing; user)`);
    expect(text).toMatch(/\+ n\d+ D3 21\.1 1\/4 v70 @ai/);
    expect(text).toMatch(/~ n\d+ .* → /);
    expect(text).toContain("c21:");
    expect(text).toContain("→ Dm9");
    expect(text).toContain("tempo: 72 → 80 BPM");
    expect(text).toContain("+ Coda c. 53–56");
    expect(text).toContain("vol 80 → 50");
    expect(text).toContain("pan 0 → -30");
    expect(text).toContain('+ "más aire" c. 1 (user)');
  });

  it("says when nothing changed, and does not list hundreds of notes", () => {
    const { doc } = dilatacion();
    const before = structuredClone(doc.song);
    expect(changesText(before, doc.song, { since: "x", history: [] })).toContain("Nothing changed.");
    const piano = orderedTracks(doc.song).find((t) => /piano/i.test(t.name))!;
    const ids = notesOf(doc.song, piano.id).map((n) => n.id);
    doc.transact({ actor: USER, label: "transportaste" }, (tx) => moveNotes(tx, ids, { semitones: 2 }));
    const text = changesText(before, doc.song, { since: "x", history: doc.history.slice(-1) });
    expect(text).toContain(`${ids.length} changed`);
    expect(text).toContain("Too many to list");
  });
});

describe("summarize: the song by section and track", () => {
  it("describes each section and track: density, register, figure, contour, dynamics and author", () => {
    const { doc } = dilatacion();
    const text = summaryText(doc.song);
    expect(text).toMatch(/^Four Hands · r\d+ · summary · c\. 1–\d+/);
    expect(text).toMatch(/\nIntro c\. 1–8 · /);
    expect(text).toMatch(/cello/i);
    expect(text).toMatch(/: silent/); // the cello waits for the verse
    expect(text).toMatch(/\d+ \(\d+(\.\d)?\) · [A-G][#b]?\d–[A-G][#b]?\d, most .* · 1\/\d+\.?t? \d+%, on the beat \d+% · (rising|falling|arch|valley|level|too short) · v\d+ \(\d+–\d+\) · user/);
  });

  it("takes a range and some tracks", () => {
    const { doc, cello } = dilatacion();
    const text = summaryText(doc.song, { fromBar: 17, toBar: 24, trackIds: [cello.id] });
    expect(text).toContain("summary · c. 17–24");
    expect(text.split("\n").filter((l) => l.startsWith("  "))).toHaveLength(text.split("\n").filter((l) => /^\S.* c\. \d/.test(l) && !l.startsWith("Four")).length);
  });
});
