import { describe, expect, it } from "vitest";
import { analysisText, analyze, conceptDurations, conceptTempo } from "./analysis.js";
import { CONCEPT_MAX, addNotes, addTrack, setSongProperties } from "./commands.js";
import { SongDocument } from "./document.js";
import { parseSongFile, serializeSong } from "./file.js";
import { USER, ai, barStart, emptySong } from "./model.js";
import { PPQ } from "./time.js";

const CLAUDE = ai("claude-ai");

function doc() {
  const d = new SongDocument(emptySong("Mitades"), { now: () => 0 });
  d.transact({ actor: USER, label: "pista" }, (tx) => addTrack(tx, { name: "Piano" }));
  return d;
}

describe("the song concept (ESTUDIO_SKILLS_COMPOSICION.md, 6.3)", () => {
  it("is written with its author, rewritten, removed, and every change is one undo step", () => {
    const d = doc();
    d.transact({ actor: CLAUDE, label: "concepto" }, (tx) => setSongProperties(tx, { concept: "  Orquesta infectada. Dura 1:12.  " }));
    expect(d.song.concept).toEqual({ text: "Orquesta infectada. Dura 1:12.", author: CLAUDE });
    d.transact({ actor: USER, label: "concepto" }, (tx) => setSongProperties(tx, { concept: "Orquesta infectada. Dura 1:20." }));
    expect(d.song.concept).toEqual({ text: "Orquesta infectada. Dura 1:20.", author: USER });
    d.undo(USER);
    expect(d.song.concept?.author).toEqual(CLAUDE);
    d.transact({ actor: USER, label: "sin concepto" }, (tx) => setSongProperties(tx, { concept: "" }));
    expect(d.song.concept).toBeUndefined();
    d.undo(USER);
    d.undo(USER);
    expect("concept" in d.song).toBe(false);
  });

  it("refuses a concept that is a book", () => {
    const d = doc();
    expect(() => d.transact({ actor: USER, label: "x" }, (tx) => setSongProperties(tx, { concept: "a".repeat(CONCEPT_MAX + 1) }))).toThrow(/too long/);
  });

  it("travels in the .fourhands file, and files without one still open", () => {
    const d = doc();
    d.transact({ actor: CLAUDE, label: "concepto" }, (tx) => setSongProperties(tx, { concept: "Para los créditos: 45 s" }));
    const back = parseSongFile(serializeSong({ song: d.song, history: d.history, proposals: [] }));
    expect(back.song.concept).toEqual({ text: "Para los créditos: 45 s", author: CLAUDE });
    const none = parseSongFile(serializeSong({ song: doc().song, history: [], proposals: [] }));
    expect(none.song.concept).toBeUndefined();
  });
});

describe("analyze against the concept's limits", () => {
  it("reads durations and tempos the way people write them", () => {
    expect(conceptDurations("Dura 1:12, como los créditos")).toEqual([72]);
    expect(conceptDurations("una cabecera de 45 s")).toEqual([45]);
    expect(conceptDurations("unos 90 segundos")).toEqual([90]);
    expect(conceptDurations("2 min")).toEqual([120]);
    expect(conceptDurations("1 min 30 s")).toEqual([90]);
    expect(conceptDurations("1 minuto y 30 segundos")).toEqual([90]);
    expect(conceptDurations("tres sintes, sin palmas")).toEqual([]);
    expect(conceptTempo("a 140 BPM, sin cambiar")).toBe(140);
    expect(conceptTempo("lento")).toBeNull();
  });

  it("says when the music is longer than the concept allows, or at another tempo, only for the whole song", () => {
    const d = doc();
    // 24 bars of 4/4 at 120 BPM = 48 s.
    d.transact({ actor: USER, label: "notas" }, (tx) => {
      setSongProperties(tx, { tempo: 500_000, concept: "Cabecera de 40 s a 110 BPM" });
      addNotes(tx, "t1", [{ pitch: 60, start: 0, duration: 24 * 4 * PPQ, velocity: 80 }]);
    });
    const end = barStart(d.song.meter, 25);
    const found = analyze(d.song, { start: 0, end }).filter((f) => f.check === "concept");
    expect(found.map((f) => f.text)).toEqual([
      "the concept says 0:40; the music lasts 0:48 (last note ends in c. 24): 8 s longer",
      "the concept says 110 BPM; the song is at 120 BPM",
    ]);
    expect(analysisText(d.song, { start: 0, end })).toContain("Against the limits in the song concept:");
    expect(analyze(d.song, { start: barStart(d.song.meter, 5), end }).some((f) => f.check === "concept")).toBe(false);
    d.transact({ actor: USER, label: "ajuste" }, (tx) => setSongProperties(tx, { concept: "Cabecera de 47 s" }));
    expect(analysisText(d.song, { start: 0, end })).toMatch(/Nothing found for: the concept's limits/);
  });
});
