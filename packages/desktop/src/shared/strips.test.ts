import { describe, expect, it } from "vitest";
import { METRONOME_KEY, MAX_STRIPS, StripMap } from "./strips.js";

const tracks = (n: number, channel = (i: number) => (i < 9 ? i : i < 15 ? i + 1 : 0)) => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, channel: channel(i) }));

describe("strips per track (A2, 03/11/2026)", () => {
  it("keeps a song of up to 15 tracks on its channels' numbers, as before, with the metronome on 15", () => {
    const m = new StripMap();
    m.sync(tracks(15, (i) => (i < 9 ? i : i + 1)));
    expect(tracks(15, (i) => (i < 9 ? i : i + 1)).map((t) => m.of(t.id, -1))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15]);
    // The 15th track took channel 15 when the song was made: the metronome goes past them.
    expect(m.of(METRONOME_KEY, -1)).toBe(16);
  });

  it("gives every track a strip of its own, past 16 and on shared channels", () => {
    const m = new StripMap();
    const list = tracks(40);
    m.sync(list);
    const strips = list.map((t) => m.of(t.id, -1));
    expect(new Set([...strips, m.of(METRONOME_KEY, -1)]).size).toBe(41);
    expect(strips.slice(0, 9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Math.max(...strips)).toBeLessThan(MAX_STRIPS);
  });

  it("keeps each track's strip when others are reordered, removed or added, and frees the removed one", () => {
    const m = new StripMap();
    const list = tracks(20);
    m.sync(list);
    const before = new Map(list.map((t) => [t.id, m.of(t.id, -1)]));
    const t5 = before.get("t5")!;
    const left = list.filter((t) => t.id !== "t5").reverse();
    const { freed } = m.sync(left);
    expect(freed).toEqual([t5]);
    for (const t of left) expect(m.of(t.id, -1)).toBe(before.get(t.id));
    // A new track on that channel takes the strip back (its number is its channel's).
    m.sync([...left, { id: "t99", channel: 4 }]);
    expect(m.of("t99", -1)).toBe(t5);
  });
});
