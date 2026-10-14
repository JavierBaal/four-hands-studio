import { readFileSync } from "node:fs";
import { importMidi } from "@fourhands/core";
import { describe, expect, it } from "vitest";
import { FRAGMENTS, fragmentEvents, pickPreset, presetsFor, shuffle } from "./fragments.js";

const song = importMidi(new Uint8Array(readFileSync(new URL("../../../core/test-data/Dilatacion.mid", import.meta.url)))).song;

describe("blind listening passages", () => {
  it("play the piano alone in bars 1–8", () => {
    const { setup, events } = fragmentEvents(song, FRAGMENTS[0]!);
    expect(setup[0]).toEqual({ kind: "prog", ch: 1, prog: 0, bank: 0 });
    expect(new Set(events.map((e) => (e.ev as { ch: number }).ch))).toEqual(new Set([1]));
    expect(events[0]!.at).toBe(0);
    expect(Math.max(...events.map((e) => e.at))).toBeLessThanOrEqual((8 * 4 * 60) / 72 + 0.001);
  });

  it("play melody and cello as strings in bars 9–16", () => {
    const { setup, events } = fragmentEvents(song, FRAGMENTS[1]!);
    expect(setup.filter((e) => e.kind === "prog")).toEqual([
      { kind: "prog", ch: 2, prog: 48, bank: 0 },
      { kind: "prog", ch: 3, prog: 42, bank: 0 },
    ]);
    expect(events.length).toBeGreaterThan(20);
  });

  it("shuffle keeps every item", () => {
    let k = 0;
    expect(shuffle(["a", "b", "c"], () => [0.1, 0.9][k++ % 2]!).sort()).toEqual(["a", "b", "c"]);
  });

  // The fault Fran heard (14/10/2026): Sonatina numbers its own way, and asking it for program 48
  // gave its first preset, a Steinway, in the strings passage.
  const sonatina = ["Steinway Concert Gra", "Concert Harp", "1st Violins Sustain", "1st Violins Pizz.", "2nd Violins Sustain", "2nd Violins Pizz.", "Viola Section Sustai", "Viola Section Pizz.", "Cello Section Sustai", "Cello Section Pizz."].map((name, program) => ({ name, program, bankMSB: 0 }));
  const gm = Array.from({ length: 128 }, (_, program) => ({ name: program === 48 ? "Strings" : program === 42 ? "Cello" : program === 0 ? "Grand Piano" : `P${program}`, program, bankMSB: 0 }));

  it("finds a bank's instruments by name when it does not follow General MIDI", () => {
    expect(pickPreset(sonatina, "piano")?.program).toBe(0);
    expect(pickPreset(sonatina, "strings")?.name).toBe("1st Violins Sustain");
    expect(pickPreset(sonatina, "cello")?.name).toBe("Cello Section Sustai");
    const { setup } = fragmentEvents(song, FRAGMENTS[1]!, presetsFor(sonatina, FRAGMENTS[1]!)!);
    expect(setup.filter((e) => e.kind === "prog").map((e) => (e as { prog: number }).prog)).toEqual([2, 8]);
  });

  it("uses General MIDI numbers in a General MIDI bank", () => {
    expect(pickPreset(gm, "strings")?.program).toBe(48);
    expect(pickPreset(gm, "cello")?.program).toBe(42);
  });

  it("leaves out of a passage a bank that lacks its instruments (a piano-only bank in the strings)", () => {
    const piano = [{ name: "Grand Piano", program: 0, bankMSB: 0 }];
    expect(presetsFor(piano, FRAGMENTS[0]!)).not.toBeNull();
    expect(presetsFor(piano, FRAGMENTS[1]!)).toBeNull();
  });
});
