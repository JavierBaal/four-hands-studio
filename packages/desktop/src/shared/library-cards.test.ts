import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LibraryCatalogFile } from "../main/library-catalog.js";
import { cleanCard, cleanCatalog, hostPitchName, newCardId, parseKeyswitches, parseRange, parseResponse, parseUserPitch } from "./library-cards.js";

describe("library cards (Fran, 05/11/2026)", () => {
  it("reads pitches as the user types them: Do Re Mi or letters, middle C = Do4", () => {
    expect(parseUserPitch("Do4")).toBe(60);
    expect(parseUserPitch("do♯1")).toBe(25);
    expect(parseUserPitch("Re♭3")).toBe(49);
    expect(parseUserPitch("sol 4")).toBe(67);
    expect(parseUserPitch("C2")).toBe(36);
    expect(parseUserPitch("f#3")).toBe(54);
    expect(parseUserPitch("Do")).toBeNull();
    expect(parseUserPitch("Mi11")).toBeNull();
  });

  it("names Kontakt's keys one octave lower, and no other plugin's", () => {
    expect(hostPitchName(36, "Kontakt 8")).toBe("C1");
    expect(hostPitchName(36, "Pianoteq 8")).toBeNull();
  });

  it("reads the AI's text and says what is wrong", () => {
    expect(parseResponse("weak: only above v80", "velocity")).toEqual({ state: "weak", note: "only above v80" });
    expect(parseResponse("Sí", "expression")).toEqual({ state: "yes" });
    expect(parseResponse("sin probar", "modulation")).toEqual({ state: "untested" });
    expect(() => parseResponse("mucho", "velocity")).toThrow(/yes, weak, no or untested/);
    expect(parseRange("C6-C2")).toEqual({ low: 36, high: 84 });
    expect(parseRange("none")).toBeNull();
    expect(() => parseRange("C2")).toThrow(/two pitches/);
    expect(parseKeyswitches("C#1 Staccato\nC1 Sustain")).toEqual([
      { pitch: 24, name: "Sustain" },
      { pitch: 25, name: "Staccato" },
    ]);
    expect(() => parseKeyswitches("C1 A, C1 B")).toThrow(/twice/);
  });

  it("cleans what comes from disk: bad fields fall back, cards without id or name go, ids are unique", () => {
    const card = cleanCard({ id: "lib1", name: " Violas ", velocity: { state: "loud" }, range: { low: 84, high: 36 }, keyswitches: [{ pitch: 25, name: "B" }, { pitch: 24, name: "A" }, { pitch: 24, name: "dup" }, { pitch: 200, name: "x" }], ownReverb: "maybe" })!;
    expect(card).toMatchObject({ name: "Violas", velocity: { state: "untested" }, range: { low: 36, high: 84 }, keyswitches: [{ pitch: 24, name: "A" }, { pitch: 25, name: "B" }] });
    expect(card.ownReverb).toBeUndefined();
    expect(cleanCatalog({ cards: [{ id: "a", name: "A" }, { id: "a", name: "B" }, { name: "no id" }] }).cards.map((c) => c.name)).toEqual(["A"]);
    expect(newCardId({ cards: [{ ...card, id: "lib1" }] }, 1)).toBe("lib2");
  });

  it("keeps the catalog in one file shared by every song, and tells who listens", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-lib-"));
    const file = path.join(dir, "libraries.json");
    const a = new LibraryCatalogFile(file);
    const heard: number[] = [];
    a.onChange((c) => heard.push(c.cards.length));
    expect(a.save({ id: "lib1", name: "Violas" })).toMatchObject({ id: "lib1", name: "Violas" });
    expect(a.save({ id: "", name: "x" })).toBeNull();
    a.save({ id: "lib1", name: "Violas (Symphonic)" });
    expect(heard).toEqual([1, 1]);
    expect(new LibraryCatalogFile(file).card("lib1")?.name).toBe("Violas (Symphonic)");
    fs.writeFileSync(file, "{ roto");
    expect(new LibraryCatalogFile(file).read().cards).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
