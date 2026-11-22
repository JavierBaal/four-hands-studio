import { describe, expect, it } from "vitest";
import { addNotes, addTrack, setChord } from "./commands.js";
import { formatDuration, formatNotes, formatPosition, nominalDuration, pitchName } from "./compact.js";
import { SongDocument } from "./document.js";
import { importMidi } from "./midi.js";
import { USER, ai, barStart, emptySong } from "./model.js";
import { DILATACION } from "./test-support/dilatacion.js";
import { PPQ } from "./time.js";

const claude = ai("claude-ai");

describe("pitchName", () => {
  it("writes scientific pitch with middle C = C4, spelled by the key", () => {
    expect(pitchName(60)).toBe("C4");
    expect(pitchName(21)).toBe("A0");
    expect(pitchName(127)).toBe("G9");
    expect(pitchName(66, { fifths: 2, mode: "major" })).toBe("F#4");
    expect(pitchName(63, { fifths: -3, mode: "minor" })).toBe("Eb4");
    expect(pitchName(70, { fifths: 0, mode: "minor" })).toBe("A#4");
  });
});

describe("formatPosition", () => {
  const m44 = { numerator: 4, denominator: 4 };
  const m68 = { numerator: 6, denominator: 8 };
  it("writes bar.beat plus a fraction of the beat", () => {
    expect(formatPosition(m44, barStart(m44, 17))).toBe("17.1");
    expect(formatPosition(m44, barStart(m44, 17) + 2.5 * PPQ)).toBe("17.3+1/2");
    expect(formatPosition(m44, barStart(m44, 17) + PPQ + 320)).toBe("17.2+1/3");
    expect(formatPosition(m44, barStart(m44, 17) + PPQ + 720)).toBe("17.2+3/4");
  });
  it("counts beats in the meter's unit (eighths in 6/8)", () => {
    expect(formatPosition(m68, barStart(m68, 2) + 5 * (PPQ / 2))).toBe("2.6");
    expect(formatPosition(m68, barStart(m68, 2) + PPQ / 4)).toBe("2.1+1/2");
  });
});

describe("formatDuration", () => {
  it.each([
    [4 * PPQ, "1/1"],
    [PPQ, "1/4"],
    [PPQ / 4, "1/16"],
    [PPQ * 1.5, "1/4."],
    [PPQ * 0.75, "1/8."],
    [320, "1/8t"],
    [640, "1/4t"],
    [2.5 * PPQ, "1/2+1/8"],
    [1.25 * PPQ, "1/4+1/16"],
    [8 * PPQ, "1/1+1/1"],
    [6 * PPQ, "1/1."],
    [1600, "1/4+1/4t"],
  ])("%i ticks → %s", (ticks, text) => {
    expect(formatDuration(ticks)).toBe(text);
  });

  it("never rounds a duration down to nothing", () => {
    expect(nominalDuration(50)).toBe(240);
    expect(nominalDuration(300)).toBe(320);
  });
});

describe("formatNotes", () => {
  it("reproduces the example of docs/mcp.md, 3.3", () => {
    const song = emptySong("Ejemplo");
    song.counters.t = 3;
    song.counters.n = 482;
    const doc = new SongDocument(song);
    const bar17 = barStart(song.meter, 17);
    const t = doc.transact({ actor: USER, label: "Pista" }, (tx) => addTrack(tx, { name: "Violines", program: 48 }));
    doc.transact({ actor: USER, label: "Melodía" }, (tx) => {
      setChord(tx, bar17, "Am");
      setChord(tx, barStart(song.meter, 18), "F");
      addNotes(tx, t, [
        { pitch: 76, start: bar17, duration: PPQ, velocity: 72 },
        { pitch: 74, start: bar17 + PPQ + 29, duration: PPQ / 2, velocity: 65 },
        { pitch: 72, start: bar17 + 1.5 * PPQ - 19, duration: PPQ / 2 + 38, velocity: 63 },
      ]);
    });
    doc.transact({ actor: claude, label: "Claude" }, (tx) => addNotes(tx, t, [{ pitch: 71, start: bar17 + 2 * PPQ, duration: 2 * PPQ, velocity: 70 }]));
    doc.transact({ actor: USER, label: "Final" }, (tx) => addNotes(tx, t, [{ pitch: 69, start: barStart(song.meter, 18), duration: 4 * PPQ, velocity: 68 }]));
    doc.song.revision = 1532;
    expect(formatNotes(doc.song)).toBe(
      [
        "Four Hands · r1532 · Violines (t3) · c. 17–18",
        "c17 · Am",
        "n482 E5 17.1 1/4 v72 @u",
        "n483 D5 17.2 1/8 v65 @u ~s+0.03",
        "n484 C5 17.2+1/2 1/8 v63 @u ~s-0.02 ~d+0.04",
        "n485 B4 17.3 1/2 v70 @ai",
        "c18 · F",
        "n486 A4 18.1 1/1 v68 @u",
      ].join("\n"),
    );
  });

  it("groups an early note with the bar it belongs to", () => {
    const doc = new SongDocument(emptySong());
    const t = doc.transact({ actor: USER, label: "x" }, (tx) => addTrack(tx, { name: "Piano" }));
    doc.transact({ actor: USER, label: "x" }, (tx) => addNotes(tx, t, [{ pitch: 60, start: 4 * PPQ - 20, duration: PPQ, velocity: 80 }]));
    expect(formatNotes(doc.song).split("\n").slice(1)).toEqual(["c2", "n1 C4 2.1 1/4 v80 @u ~s-0.02"]);
  });

  it("shows chords that change inside a bar and carries the previous one", () => {
    const doc = new SongDocument(emptySong());
    const t = doc.transact({ actor: USER, label: "x" }, (tx) => addTrack(tx, { name: "Piano" }));
    doc.transact({ actor: USER, label: "x" }, (tx) => {
      setChord(tx, 0, "Am");
      setChord(tx, 4 * PPQ + 2 * PPQ, "F/A");
      addNotes(tx, t, [
        { pitch: 57, start: 0, duration: PPQ, velocity: 80 },
        { pitch: 57, start: 4 * PPQ, duration: PPQ, velocity: 80 },
      ]);
    });
    expect(formatNotes(doc.song).split("\n").filter((l) => l.startsWith("c"))).toEqual(["c1 · Am", "c2 · Am, 2.3 F/A"]);
  });

  it("reads a range of bars of some tracks", () => {
    const { song } = importMidi(DILATACION);
    const text = formatNotes(song, { trackIds: ["t3"], fromBar: 17, toBar: 18 });
    const lines = text.split("\n");
    expect(lines[0]).toBe(`Four Hands · r0 · Melodia (cuerdas) (t3) · c. 17–18`);
    expect(lines.filter((l) => /^c\d+/.test(l))).toEqual(["c17", "c18"]);
    expect(lines.slice(1)).toEqual([
      "c17",
      "n718 A4 17.1 1/4 v80 @u ~d-0.05",
      "n719 D5 17.2 1/4 v80 @u ~d-0.05",
      "n720 F5 17.3 1/2 v80 @u ~d-0.10",
      "c18",
      "n721 E5 18.1 1/4 v80 @u ~d-0.05",
      "n722 F5 18.2 1/4 v80 @u ~d-0.05",
      "n723 A5 18.3 1/2 v80 @u ~d-0.10",
    ]);
  });

  it("says when a range has no notes", () => {
    const { song } = importMidi(DILATACION);
    expect(formatNotes(song, { trackIds: ["t1"], fromBar: 900, toBar: 900 })).toBe("Four Hands · r0 · Organo (t1) · c. 900\n(no notes)");
  });

  it("keeps the whole of Dilatación within the context budget (docs/mcp.md, 12)", () => {
    const { song } = importMidi(DILATACION);
    const text = formatNotes(song);
    expect(text.split("\n").filter((l) => /^n\d+ /.test(l))).toHaveLength(1024);
    // Measured: 33,360 characters, about 10,000 tokens.
    expect(text.length).toBeLessThan(36_000);
    // Written by a program: every start is on the grid; the notes are slightly shorter than their figures.
    expect(text).not.toMatch(/~s/);
  });
});
