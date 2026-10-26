import { SongDocument, USER, addNotes, setCurve, setTempoChanges, starterSong } from "@fourhands/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SynthEvent } from "../shared/messages.js";
import type { Engine } from "./engine.js";
import { Player } from "./player.js";

// 120 BPM: a quarter note is 0.5 s.
function setup() {
  const song = starterSong();
  song.tempo = 500_000;
  const doc = new SongDocument(song);
  doc.transact({ actor: USER, label: "x" }, (tx) =>
    addNotes(tx, "t1", [
      { pitch: 60, start: 0, duration: 960, velocity: 80 },
      { pitch: 62, start: 960, duration: 960, velocity: 80 },
      { pitch: 64, start: 3840, duration: 960, velocity: 80 },
    ]),
  );
  const scheduled: { time: number; ev: SynthEvent }[] = [];
  const immediate: SynthEvent[] = [];
  const engine = {
    ctx: { currentTime: 10 },
    now: (ev: SynthEvent) => immediate.push(ev),
    sched: (evs: { time: number; ev: SynthEvent }[]) => scheduled.push(...evs),
    panic: () => immediate.push({ kind: "panic" }),
  };
  const player = new Player(() => doc.song, engine as unknown as Engine);
  const advance = (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.025) {
      engine.ctx.currentTime += 0.025;
      vi.advanceTimersByTime(25);
    }
  };
  return { doc, player, engine, scheduled, immediate, advance };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const ons = (evs: { time: number; ev: SynthEvent }[]) => evs.filter((e) => e.ev.kind === "on" && e.ev.ch === 0).map((e) => [(e.ev as { note: number }).note, Math.round(e.time * 1000) / 1000]);

describe("Player", () => {
  it("schedules each note at its time and moves the playhead", () => {
    const { player, scheduled, advance } = setup();
    player.play(0);
    advance(2.2);
    expect(ons(scheduled)).toEqual([
      [60, 10.08],
      [62, 10.58],
      [64, 12.08],
    ]);
    expect(player.position()).toBeGreaterThan(3840);
  });

  it("starts a crescendo from where it stands, again at each loop, and resets it on stop (H4)", () => {
    const { doc, player, scheduled, immediate, advance } = setup();
    doc.transact({ actor: USER, label: "c" }, (tx) => setCurve(tx, "t1", "expression", 0, 3840, [{ tick: 0, value: 30 }, { tick: 960, value: 90 }]));
    doc.setContext({ loop: { start: 960, end: 1920 } });
    player.play(960);
    advance(1.2);
    const cc11 = scheduled.filter((e) => e.ev.kind === "cc" && e.ev.cc === 11).map((e) => (e.ev as { value: number }).value);
    expect(cc11.slice(0, 2)).toEqual([90, 90]); // the state at 960, then the point at 960
    expect(cc11.length).toBeGreaterThanOrEqual(4); // and again after the jump
    player.stop();
    expect(immediate).toContainEqual({ kind: "cc", ch: 0, cc: 11, value: 127 });
  });

  it("follows the tempo map: a jump and a ritardando delay what comes after (H4)", () => {
    const { doc, player, scheduled, advance } = setup();
    // 120 until beat 2, then 60: the note at beat 2 sounds 0.5 s after the first; the next bar
    // (3 more beats at 60) 3 s later.
    doc.transact({ actor: USER, label: "t" }, (tx) => setTempoChanges(tx, [{ tick: 960, tempo: 1_000_000 }]));
    player.play(0);
    advance(4);
    expect(ons(scheduled)).toEqual([
      [60, 10.08],
      [62, 10.58],
      [64, 13.58],
    ]);
    expect(player.position()).toBeGreaterThan(3840);
    expect(player.position()).toBeLessThan(3840 + 960);
  });

  it("keeps the tempo map inside a loop, lap after lap (H4)", () => {
    const { doc, player, scheduled, advance } = setup();
    // A ritardando inside the loop: 120 at 0, gliding to 60 at beat 2. Each lap lasts the same.
    doc.transact({ actor: USER, label: "t" }, (tx) => setTempoChanges(tx, [{ tick: 960, tempo: 1_000_000, ramp: true }]));
    doc.setContext({ loop: { start: 0, end: 1920 } });
    player.play(0);
    advance(5);
    const c = ons(scheduled).filter(([n]) => n === 60).map(([, t]) => t as number);
    const lap = 0.5 * Math.log(2) * 2 + 1; // ramp 120→60 over one beat (ln 2 / ... ) + one beat at 60
    expect(c.length).toBeGreaterThanOrEqual(2);
    expect(c[1]! - c[0]!).toBeCloseTo(lap, 2);
  });

  it("starts from the cursor", () => {
    const { player, scheduled, advance } = setup();
    player.play(960);
    advance(0.5);
    expect(ons(scheduled)).toEqual([[62, 10.08]]);
  });

  it("loops inside the loop region and cuts notes at its end", () => {
    const { doc, player, scheduled, advance } = setup();
    doc.setContext({ loop: { start: 0, end: 1920 } });
    player.play(0);
    advance(2.1);
    expect(ons(scheduled).map(([n]) => n)).toEqual([60, 62, 60, 62, 60]); // the fifth is already in the 200 ms lookahead
    expect(player.position()).toBeLessThan(1920);
  });

  it("applies a loop drawn while playing, and drops it when it is removed", () => {
    const { doc, player, scheduled, advance } = setup();
    player.play(0);
    advance(0.3);
    doc.setContext({ loop: { start: 0, end: 1920 } });
    advance(1.5);
    expect(player.position()).toBeLessThan(1920);
    expect(ons(scheduled).map(([n]) => n).slice(0, 4)).toEqual([60, 62, 60, 62]);
    doc.setContext({ loop: null });
    advance(1.2);
    expect(player.position()).toBeGreaterThan(1920);
  });

  it("ignores the loop while recording", () => {
    const { doc, player, advance } = setup();
    doc.setContext({ loop: { start: 0, end: 960 } });
    player.play(0, { noLoop: true });
    advance(0.8);
    expect(player.position()).toBeGreaterThan(960);
  });

  it("counts in one bar with the metronome before the first note", () => {
    const { player, scheduled, advance } = setup();
    player.play(0, { countIn: 1, metronome: true });
    advance(0.3);
    expect(player.countingIn()).toBe(true);
    advance(2);
    const clicks = scheduled.filter((e) => e.ev.kind === "on" && e.ev.ch === 15).map((e) => Math.round(e.time * 100) / 100);
    expect(clicks.slice(0, 4)).toEqual([10.08, 10.58, 11.08, 11.58]);
    expect(ons(scheduled)[0]).toEqual([60, 12.08]);
  });

  it("stops: silence everything and report it", () => {
    const { player, immediate } = setup();
    const stopped = vi.fn();
    player.onStop = stopped;
    player.play(0);
    player.stop();
    expect(immediate.at(-1)).toEqual({ kind: "panic" });
    expect(player.position()).toBeNull();
    expect(stopped).toHaveBeenCalled();
  });

  it("stops by itself a bar after the end of the song", () => {
    const { player, advance } = setup();
    player.play(0);
    advance(5);
    expect(player.playing).toBe(false);
  });

  it("tells live notes where they fall in the song", () => {
    const { player, advance } = setup();
    const live: [string, number, number | null][] = [];
    player.onLive = (kind, n) => live.push([kind, n.pitch, n.tick]);
    player.liveOn(67, 90, 0);
    player.play(0);
    advance(0.58);
    player.liveOn(69, 90, 0);
    expect(live[0]).toEqual(["on", 67, null]);
    expect(live[1]![2]).toBeGreaterThan(900);
    expect(live[1]![2]).toBeLessThan(1100);
  });
});
