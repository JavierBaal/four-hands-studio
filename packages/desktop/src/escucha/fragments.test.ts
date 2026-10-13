import { readFileSync } from "node:fs";
import { importMidi } from "@fourhands/core";
import { describe, expect, it } from "vitest";
import { FRAGMENTS, fragmentEvents, shuffle } from "./fragments.js";

const song = importMidi(new Uint8Array(readFileSync(new URL("../../../core/test-data/Dilatacion.mid", import.meta.url)))).song;

describe("blind listening passages", () => {
  it("play the piano alone in bars 1–8", () => {
    const { setup, events } = fragmentEvents(song, FRAGMENTS[0]!);
    expect(setup[0]).toEqual({ kind: "prog", ch: 1, prog: 0 });
    expect(new Set(events.map((e) => (e.ev as { ch: number }).ch))).toEqual(new Set([1]));
    expect(events[0]!.at).toBe(0);
    expect(Math.max(...events.map((e) => e.at))).toBeLessThanOrEqual((8 * 4 * 60) / 72 + 0.001);
  });

  it("play melody and cello as strings in bars 9–16", () => {
    const { setup, events } = fragmentEvents(song, FRAGMENTS[1]!);
    expect(setup.filter((e) => e.kind === "prog")).toEqual([
      { kind: "prog", ch: 2, prog: 48 },
      { kind: "prog", ch: 3, prog: 42 },
    ]);
    expect(events.length).toBeGreaterThan(20);
  });

  it("shuffle keeps every item", () => {
    let k = 0;
    expect(shuffle(["a", "b", "c"], () => [0.1, 0.9][k++ % 2]!).sort()).toEqual(["a", "b", "c"]);
  });
});
