import { describe, expect, it } from "vitest";
import { addNotes, addSection, addTrack, setChord } from "./commands.js";
import { formatNotes } from "./compact.js";
import { SongDocument } from "./document.js";
import { importMidi } from "./midi.js";
import { USER, barStart, emptySong } from "./model.js";
import {
  MusicError,
  notesInRange,
  parseChordPosition,
  parseDuration,
  parseNewNotes,
  parseNoteEdits,
  parsePitch,
  parsePosition,
  parseShift,
  keyText,
  parseKey,
  parseMeter,
  tonicOf,
  transposeByDegrees,
  resolveRange,
  songBars,
} from "./notation.js";
import { DILATACION } from "./test-support/dilatacion.js";
import { PPQ } from "./time.js";

const m44 = { numerator: 4, denominator: 4 };
const m68 = { numerator: 6, denominator: 8 };

describe("parsePitch", () => {
  it.each([
    ["C4", 60],
    ["c4", 60],
    ["Eb5", 75],
    ["F#3", 54],
    ["A0", 21],
    ["G9", 127],
    ["C-1", 0],
    ["Cb4", 59],
    ["B#3", 60],
    ["Fx4", 67],
    ["Ebb4", 62],
  ])("%s → %i", (text, pitch) => expect(parsePitch(text)).toBe(pitch));

  it("refuses what is not a pitch or is out of range", () => {
    expect(() => parsePitch("H4")).toThrow(MusicError);
    expect(() => parsePitch("G#9")).toThrow(/outside the MIDI range/);
    expect(() => parsePitch("E#9")).not.toThrow(); // F9 = 125
    expect(() => parsePitch("A9")).toThrow(/outside/);
  });
});

describe("parsePosition", () => {
  it("reads bar.beat and fractions of a beat", () => {
    expect(parsePosition(m44, "17.1").tick).toBe(barStart(m44, 17));
    expect(parsePosition(m44, "17.3+1/2").tick).toBe(barStart(m44, 17) + 2.5 * PPQ);
    expect(parsePosition(m44, "17.2+1/3").tick).toBe(barStart(m44, 17) + PPQ + 320);
  });
  it("counts beats in the meter's unit", () => {
    expect(parsePosition(m68, "2.6").tick).toBe(barStart(m68, 2) + 5 * (PPQ / 2));
  });
  it("explains impossible beats", () => {
    expect(() => parsePosition(m44, "17.5")).toThrow(/beat 5 does not exist in 4\/4/);
    expect(() => parsePosition(m44, "0.1")).toThrow(/bars start at 1/);
    expect(() => parsePosition(m44, "17.1+3/2")).toThrow(/less than one beat/);
  });
});

describe("parseDuration", () => {
  it.each([
    ["1/1", 4 * PPQ],
    ["1/4", PPQ],
    ["1/8.", 720],
    ["1/8t", 320],
    ["1/2+1/8", 2.5 * PPQ],
    ["3/8", 1.5 * PPQ],
    ["1/4..", 1.75 * PPQ],
    ["1", 4 * PPQ],
    ["1+1+1", 12 * PPQ],
    ["2+1/2", 10 * PPQ],
  ])("%s → %i ticks", (text, ticks) => expect(parseDuration(text)).toBe(ticks));
  it("refuses nonsense", () => expect(() => parseDuration("1/0")).toThrow(MusicError));
});

describe("parseNewNotes", () => {
  it("takes whole numbers as whole notes, as the AI sometimes writes them (20/10/2026)", () => {
    expect(parseNewNotes(m44, "D2 1.1 1+1+1 v55")).toEqual([{ pitch: 38, start: 0, duration: 12 * PPQ, velocity: 55 }]);
  });

  it("reads one note per line with defaults and deviations", () => {
    const notes = parseNewNotes(m44, "E5 17.1 1/4 v72\nD5 17.2 1/8 ~s+0.25\n\nC5 17.2+1/2 1/8 ~d-0.25");
    expect(notes).toEqual([
      { pitch: 76, start: barStart(m44, 17), duration: PPQ, velocity: 72 },
      { pitch: 74, start: barStart(m44, 17) + PPQ + 240, duration: PPQ / 2, velocity: 80 },
      { pitch: 72, start: barStart(m44, 17) + 1.5 * PPQ, duration: PPQ / 2 - 240, velocity: 80 },
    ]);
  });

  it("accepts lines copied from read_notes but ignores the author", () => {
    expect(() => parseNewNotes(m44, "n482 E5 17.1 1/4 v72 @u")).toThrow(/new notes have no id/);
    expect(parseNewNotes(m44, "E5 17.1 1/4 v72 @u")[0]?.pitch).toBe(76);
  });

  it("rejects the whole call with the line and the reason", () => {
    expect(() => parseNewNotes(m44, "E5 17.1 1/4\nG#9 17.2 1/4")).toThrow('Line 2 ("G#9 17.2 1/4"): \'G#9\' is outside the MIDI range (C-1 to G9). Nothing was written.');
    expect(() => parseNewNotes(m44, "E5 17.1")).toThrow(/missing the duration/);
    expect(() => parseNewNotes(m44, "E5 1/4 v72")).toThrow(/missing the position/);
    expect(() => parseNewNotes(m44, "")).toThrow(/No notes/);
    expect(() => parseNewNotes(m44, "E5 17.1 1/4 v200")).toThrow(/v1 to v127/);
    expect(() => parseNewNotes(m44, "E5 17.1 1/4 forte")).toThrow(/'forte' is not a pitch/);
  });

  it("reads back exactly what read_notes writes (on the grid)", () => {
    const { song } = importMidi(DILATACION);
    const doc = new SongDocument(song);
    const track = song.trackOrder[2]!;
    const text = formatNotes(doc.song, { trackIds: [track], fromBar: 17, toBar: 18 });
    const original = Object.values(song.notes)
      .filter((n) => n.trackId === track)
      .filter((n) => n.start >= barStart(song.meter, 17) && n.start < barStart(song.meter, 19));
    const lines = text.split("\n").filter((l) => /^n\d+ /.test(l));
    expect(lines.length).toBe(original.length);
    for (const line of lines) {
      const id = line.split(" ")[0]!;
      const [spec] = parseNewNotes(song.meter, line.replace(/^n\d+ /, ""));
      const note = song.notes[id]!;
      expect(spec!.pitch).toBe(note.pitch);
      expect(spec!.start).toBe(note.start);
      // Durations come back within the 0.01-beat rounding of the deviation.
      expect(Math.abs(spec!.duration - note.duration)).toBeLessThanOrEqual(5);
    }
  });
});

describe("parseNoteEdits", () => {
  it("reads only the fields that change", () => {
    expect(parseNoteEdits(m44, "n482 F5\nn483 v40\nn484 17.3 1/2")).toEqual([
      { id: "n482", pitch: 77 },
      { id: "n483", velocity: 40 },
      { id: "n484", start: barStart(m44, 17) + 2 * PPQ, bar: 17, duration: 2 * PPQ },
    ]);
  });
  it("needs an id and something to change", () => {
    expect(() => parseNoteEdits(m44, "F5 17.1")).toThrow(/missing the note id/);
    expect(() => parseNoteEdits(m44, "n482")).toThrow(/nothing to change/);
    expect(() => parseNoteEdits(m44, "n482 F5 G5")).toThrow(/two values of the same kind/);
  });
});

describe("resolveRange", () => {
  const doc = new SongDocument(emptySong());
  const ids = doc.transact({ actor: USER, label: "setup" }, (tx) => {
    const t = addTrack(tx, { name: "Piano" });
    addSection(tx, { name: "Coro", startBar: 5, endBar: 8 });
    addSection(tx, { name: "Puente", startBar: 9, endBar: 12 });
    setChord(tx, 0, "Am");
    return addNotes(tx, t, [
      { pitch: 60, start: barStart(m44, 2), duration: PPQ, velocity: 80 },
      { pitch: 62, start: barStart(m44, 6) + PPQ, duration: PPQ, velocity: 80 },
    ]);
  });
  const song = doc.song;

  it("counts the bars of the song from notes and sections", () => expect(songBars(song)).toBe(12));

  it("reads bars, beats and sections", () => {
    expect(resolveRange(song, "5-8")).toMatchObject({ start: barStart(m44, 5), end: barStart(m44, 9), label: "c. 5–8" });
    expect(resolveRange(song, "6")).toMatchObject({ start: barStart(m44, 6), end: barStart(m44, 7) });
    expect(resolveRange(song, "5.3-6.2")).toMatchObject({ start: barStart(m44, 5) + 2 * PPQ, end: barStart(m44, 6) + 2 * PPQ });
    expect(resolveRange(song, "section:coro")).toMatchObject({ fromBar: 5, toBar: 8, label: "Coro (c. 5–8)" });
    expect(resolveRange(song, "section:Puénte").fromBar).toBe(9);
    expect(resolveRange(song, "all")).toMatchObject({ fromBar: 1, toBar: 12 });
  });

  it("explains what does not exist", () => {
    expect(() => resolveRange(song, "90")).toThrow("Bar 90 does not exist: the song has 12 bars");
    expect(() => resolveRange(song, "section:Verso")).toThrow("There is no section 'Verso'. Sections: Coro, Puente.");
    expect(() => resolveRange(song, "selection")).toThrow(/nothing selected/);
    expect(() => resolveRange(song, "loop")).toThrow(/no loop/);
    expect(() => resolveRange(song, "por ahí")).toThrow(/is not a range/);
  });

  it("lets writing go past the end and clips reading to it", () => {
    expect(resolveRange(song, "20-21", { allowBeyondEnd: true }).fromBar).toBe(20);
    expect(resolveRange(song, "10-30").toBar).toBe(12);
  });

  it("follows the shared context", () => {
    doc.setContext({ selection: [ids[1]!], loop: { start: barStart(m44, 5), end: barStart(m44, 7) } });
    expect(resolveRange(doc.song, "selection")).toMatchObject({ noteIds: [ids[1]], label: "selection, 1 notes (c. 6)" });
    expect(resolveRange(doc.song, "loop").label).toBe("loop (c. 5–6)");
    expect(notesInRange(doc.song, resolveRange(doc.song, "1-12"))).toEqual(ids);
  });
});

describe("parseShift", () => {
  it.each([
    ["+1 bar", 4 * PPQ],
    ["-2 beats", -2 * PPQ],
    ["+1/8", PPQ / 2],
    ["+1 bar 2 beats", 6 * PPQ],
    ["-1/2 beat", -PPQ / 2],
    ["2 compases", 8 * PPQ],
  ])("%s → %i", (text, ticks) => expect(parseShift(m44, text)).toBe(ticks));
  it("asks for a unit", () => expect(() => parseShift(m44, "+3")).toThrow(/say 'bar' or 'beat'/));
});

describe("parseChordPosition", () => {
  it("takes a bar or a beat", () => {
    expect(parseChordPosition(m44, "17")).toBe(barStart(m44, 17));
    expect(parseChordPosition(m44, "17.3")).toBe(barStart(m44, 17) + 2 * PPQ);
  });
});

describe("keys and degrees", () => {
  it("reads keys in English and Spanish", () => {
    expect(parseKey("A minor")).toEqual({ fifths: 0, mode: "minor" });
    expect(parseKey("Am")).toEqual({ fifths: 0, mode: "minor" });
    expect(parseKey("Eb major")).toEqual({ fifths: -3, mode: "major" });
    expect(parseKey("F# minor")).toEqual({ fifths: 3, mode: "minor" });
    expect(parseKey("La menor")).toEqual({ fifths: 0, mode: "minor" });
    expect(parseKey("Mi bemol mayor")).toEqual({ fifths: -3, mode: "major" });
    expect(parseKey("D# major")).toEqual({ fifths: -3, mode: "major" });
    expect(() => parseKey("H dur")).toThrow(MusicError);
    expect(keyText({ fifths: -3, mode: "major" })).toBe("Eb major");
    expect(tonicOf({ fifths: 0, mode: "minor" })).toBe(9);
  });

  it("transposes inside the key", () => {
    const am = { fifths: 0, mode: "minor" as const };
    expect(transposeByDegrees(69, 2, am)).toBe(72); // A4 → C5
    expect(transposeByDegrees(71, 2, am)).toBe(74); // B4 → D5
    expect(transposeByDegrees(69, 7, am)).toBe(81); // octave
    expect(transposeByDegrees(69, -1, am)).toBe(67); // A4 → G4
    expect(transposeByDegrees(68, 1, am)).toBe(70); // G#4 (outside) → A#4: keeps its alteration
    const eb = { fifths: -3, mode: "major" as const };
    expect(transposeByDegrees(63, 2, eb)).toBe(67); // Eb4 → G4
  });

  it("reads meters", () => {
    expect(parseMeter("6/8")).toEqual({ numerator: 6, denominator: 8 });
    expect(() => parseMeter("4/5")).toThrow(MusicError);
  });
});
