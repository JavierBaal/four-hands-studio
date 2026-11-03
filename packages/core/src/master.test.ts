import { describe, expect, it } from "vitest";
import { changesText } from "./changes.js";
import { setSongProperties } from "./commands.js";
import { SongDocument } from "./document.js";
import { parseSongFile, serializeSong } from "./file.js";
import { USER, ai, emptySong } from "./model.js";

const CLAUDE = ai("claude-ai");

describe("the master fader (F2.2 parte B)", () => {
  it("is absent at 0 dB, is one undo step, and 0 dB removes the field again", () => {
    const d = new SongDocument(emptySong("Máster"), { now: () => 0 });
    expect(d.song.masterVolume).toBeUndefined();
    d.transact({ actor: CLAUDE, label: "máster" }, (tx) => setSongProperties(tx, { masterVolume: 0.9 }));
    expect(d.song.masterVolume).toBe(0.9);
    d.transact({ actor: USER, label: "máster" }, (tx) => setSongProperties(tx, { masterVolume: 1 }));
    expect("masterVolume" in d.song).toBe(false);
    d.undo(USER);
    expect(d.song.masterVolume).toBe(0.9);
    d.undo(USER);
    expect("masterVolume" in d.song).toBe(false);
  });

  it("refuses values out of 0–1", () => {
    const d = new SongDocument(emptySong("Máster"), { now: () => 0 });
    expect(() => d.transact({ actor: USER, label: "x" }, (tx) => setSongProperties(tx, { masterVolume: 1.2 }))).toThrow(/between 0 and 1/);
  });

  it("travels in the .fourhands file and shows in the changes", () => {
    const d = new SongDocument(emptySong("Máster"), { now: () => 0 });
    const before = structuredClone(d.song);
    d.transact({ actor: CLAUDE, label: "máster" }, (tx) => setSongProperties(tx, { masterVolume: 0.75 }));
    const back = parseSongFile(serializeSong({ song: d.song, history: d.history, proposals: [] }));
    expect(back.song.masterVolume).toBe(0.75);
    expect(changesText(before, d.song, { since: "r0", history: [] })).toMatch(/master vol 100 → 75/);
  });
});
