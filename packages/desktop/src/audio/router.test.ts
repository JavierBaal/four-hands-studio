import { describe, expect, it } from "vitest";
import type { SynthEvent } from "../shared/messages.js";
import { SoundRouter, engineBytes, isOwnLoopback, midiBytes, soundsBytes } from "./router.js";
import type { EngineMidiEvent } from "../shared/engine.js";

function setup(external = new Set([3])) {
  const inner = { ctx: { currentTime: 10 }, nowed: [] as SynthEvent[], scheduled: [] as { time: number; ev: SynthEvent }[], panics: 0 };
  const sent: { data: number[]; at?: number }[] = [];
  let port: { send(d: number[], t?: number): void } | null = { send: (data, at) => sent.push(at === undefined ? { data } : { data, at }) };
  const router = new SoundRouter({
    inner: { ctx: inner.ctx, now: (ev) => inner.nowed.push(ev), sched: (evs) => inner.scheduled.push(...evs), panic: () => inner.panics++ },
    external: () => external,
    port: () => port,
    perfNow: () => 5000,
    delayMs: () => 40,
  });
  return { router, inner, sent, unplug: () => (port = null) };
}

describe("MIDI out to another program (H4)", () => {
  it("turns events into MIDI bytes; program changes and panic never go out", () => {
    expect(midiBytes({ kind: "on", ch: 3, note: 60, vel: 90 })).toEqual([0x93, 60, 90]);
    expect(midiBytes({ kind: "off", ch: 3, note: 60 })).toEqual([0x83, 60, 0]);
    expect(midiBytes({ kind: "cc", ch: 3, cc: 11, value: 70 })).toEqual([0xb3, 11, 70]);
    expect(midiBytes({ kind: "prog", ch: 3, prog: 42 })).toBeNull();
    expect(midiBytes({ kind: "panic" })).toBeNull();
  });

  it("sends the external channels out at their time (plus the built-in sound's delay) and the rest to the synth", () => {
    const { router, inner, sent } = setup();
    router.sched([
      { time: 10.5, ev: { kind: "on", ch: 3, note: 48, vel: 80 } },
      { time: 10.5, ev: { kind: "on", ch: 0, note: 60, vel: 80 } },
      { time: 10.5, ev: { kind: "prog", ch: 3, prog: 42 } },
    ]);
    expect(inner.scheduled.map((e) => e.ev)).toEqual([{ kind: "on", ch: 0, note: 60, vel: 80 }]);
    expect(sent).toEqual([{ data: [0x93, 48, 80], at: 5000 + 500 + 40 }]);
    router.now({ kind: "on", ch: 3, note: 50, vel: 70 });
    router.now({ kind: "on", ch: 1, note: 50, vel: 70 });
    expect(sent.at(-1)).toEqual({ data: [0x93, 50, 70] });
    expect(inner.nowed).toEqual([{ kind: "on", ch: 1, note: 50, vel: 70 }]);
  });

  it("silences the other program on stop, and keeps external tracks silent without a port (nothing doubles)", () => {
    const { router, inner, sent, unplug } = setup();
    router.panic();
    expect(inner.panics).toBe(1);
    expect(sent.map((s) => s.data)).toEqual([[0xb3, 64, 0], [0xb3, 123, 0], [0xb3, 120, 0]]);
    unplug();
    router.sched([{ time: 10.1, ev: { kind: "on", ch: 3, note: 48, vel: 80 } }]);
    expect(inner.scheduled).toEqual([]);
  });
});

describe("never listen to our own output (loopMIDI feedback, Fran 20/10/2026)", () => {
  it("recognises the other end of the chosen port, also with a number added", () => {
    expect(isOwnLoopback("Four Hands", "Four Hands")).toBe(true);
    expect(isOwnLoopback("four hands 2", "Four Hands")).toBe(true);
    expect(isOwnLoopback("Arturia KeyLab", "Four Hands")).toBe(false);
    expect(isOwnLoopback("Four Hands", null)).toBe(false);
  });
});

describe("tracks through a plugin of the engine (prueba S2)", () => {
  function withEngine() {
    const inner = { ctx: { currentTime: 10 }, nowed: [] as SynthEvent[], scheduled: [] as { time: number; ev: SynthEvent }[], panics: 0 };
    const batches: { slot: number; delay: number; data: number[] }[][] = [];
    let panics = 0;
    const router = new SoundRouter({
      inner: { ctx: inner.ctx, now: (ev) => inner.nowed.push(ev), sched: (evs) => inner.scheduled.push(...evs), panic: () => inner.panics++ },
      external: () => new Set([3]),
      port: () => null,
      delayMs: () => 40,
      plugin: () => new Set([5]),
      engine: () => ({ midi: (e) => batches.push(e), panic: () => panics++, latency: () => 0.015 }),
    });
    return { router, inner, batches, panics: () => panics };
  }

  it("sends the plugin channels to their slot on MIDI channel 1, in one batch, timed with the built-in sound", () => {
    const { router, inner, batches } = withEngine();
    router.sched([
      { time: 10.5, ev: { kind: "on", ch: 5, note: 48, vel: 80 } },
      { time: 10.5, ev: { kind: "on", ch: 0, note: 60, vel: 80 } },
      { time: 11, ev: { kind: "off", ch: 5, note: 48 } },
      { time: 10.5, ev: { kind: "prog", ch: 5, prog: 42 } },
    ]);
    expect(inner.scheduled.map((e) => e.ev)).toEqual([{ kind: "on", ch: 0, note: 60, vel: 80 }]);
    expect(batches).toHaveLength(1);
    const [on, off] = batches[0]!;
    expect(on).toMatchObject({ slot: 5, data: [0x90, 48, 80] });
    // 0.5 s ahead, plus the built-in sound's 40 ms, minus the engine's own 15 ms.
    expect(on!.delay).toBeCloseTo(0.525, 6);
    expect(off).toMatchObject({ slot: 5, data: [0x80, 48, 0] });
    expect(off!.delay).toBeCloseTo(1.025, 6);
  });

  it("plays the keyboard at once, and stops the plugin on panic or when the track changes side", () => {
    const { router, batches, panics } = withEngine();
    router.now({ kind: "on", ch: 5, note: 50, vel: 70 });
    expect(batches.at(-1)).toEqual([{ slot: 5, delay: 0, data: [0x90, 50, 70] }]);
    router.panic();
    expect(panics()).toBe(1);
    router.silence(5);
    expect(batches.at(-1)!.map((e) => e.data[1])).toEqual([64, 123, 120]);
    expect(batches.at(-1)!.every((e) => e.slot === 5 && e.data[0] === 0xb0)).toBe(true);
  });
});

describe("the built-in sounds in the engine (F2.1, Fran 01/11/2026)", () => {
  function withEngine(ready: { value: boolean }) {
    const inner = { ctx: { currentTime: 10 }, nowed: [] as SynthEvent[], scheduled: [] as { time: number; ev: SynthEvent }[], panics: 0 };
    const midi: EngineMidiEvent[] = [];
    const port = { midi: (e: EngineMidiEvent[]) => midi.push(...e), panic: () => {}, latency: () => 0.02 };
    const router = new SoundRouter({
      inner: { ctx: inner.ctx, now: (ev) => inner.nowed.push(ev), sched: (evs) => inner.scheduled.push(...evs), panic: () => inner.panics++ },
      external: () => new Set([3]),
      port: () => null,
      delayMs: () => 40,
      plugin: () => new Set([2]),
      engine: () => port,
      builtin: () => (ready.value ? port : null),
    });
    return { router, inner, midi };
  }

  it("sends programs with their bank, unlike the plugins and the MIDI out", () => {
    expect(soundsBytes({ kind: "prog", ch: 4, prog: 48, bank: 20 })).toEqual([[0xb4, 0, 20], [0xc4, 48]]);
    expect(soundsBytes({ kind: "prog", ch: 4, prog: 48 })).toEqual([[0xc4, 48]]);
    expect(soundsBytes({ kind: "on", ch: 4, note: 60, vel: 90 })).toEqual([[0x94, 60, 90]]);
    expect(soundsBytes({ kind: "panic" })).toEqual([]);
  });

  it("plays the built-in tracks in slot 16 on their own channel, at the plugins' moment", () => {
    const { router, inner, midi } = withEngine({ value: true });
    router.sched([
      { time: 10.5, ev: { kind: "on", ch: 0, note: 60, vel: 80 } },
      { time: 10.5, ev: { kind: "on", ch: 2, note: 62, vel: 80 } },
      { time: 10.5, ev: { kind: "prog", ch: 0, prog: 40, bank: 0 } },
    ]);
    expect(inner.scheduled).toEqual([]);
    // 0.5 s ahead, plus the window's 40 ms, minus the engine's own 20 ms.
    expect(midi).toEqual([
      { slot: 16, delay: 0.52, data: [0x90, 60, 80] },
      { slot: 2, delay: 0.52, data: [0x90, 62, 80] },
      { slot: 16, delay: 0.52, data: [0xb0, 0, 0] },
      { slot: 16, delay: 0.52, data: [0xc0, 40] },
    ]);
    router.now({ kind: "cc", ch: 5, cc: 11, value: 90 });
    expect(midi.at(-1)).toEqual({ slot: 16, delay: 0, data: [0xb5, 11, 90] });
    expect(inner.nowed).toEqual([]);
  });

  it("falls back to the window's synth while the engine has no sounds (not built, starting, restarting)", () => {
    const ready = { value: false };
    const { router, inner, midi } = withEngine(ready);
    router.now({ kind: "on", ch: 0, note: 60, vel: 80 });
    expect(inner.nowed).toEqual([{ kind: "on", ch: 0, note: 60, vel: 80 }]);
    expect(midi).toEqual([]);
    ready.value = true;
    router.silence(0);
    expect(midi.filter((e) => e.slot === 16).map((e) => e.data)).toEqual([[0xb0, 64, 0], [0xb0, 123, 0], [0xb0, 120, 0]]);
  });
});

describe("plugins get their volume, pan and reverb from their strip (F2.2, 03/11/2026)", () => {
  it("stops sending CC7, CC10 and CC91 to a plugin, and keeps the rest", () => {
    expect(engineBytes({ kind: "cc", ch: 2, cc: 7, value: 100 })).toBeNull();
    expect(engineBytes({ kind: "cc", ch: 2, cc: 10, value: 64 })).toBeNull();
    expect(engineBytes({ kind: "cc", ch: 2, cc: 91, value: 40 })).toBeNull();
    expect(engineBytes({ kind: "cc", ch: 2, cc: 11, value: 90 })).toEqual([0xb0, 11, 90]);
    expect(engineBytes({ kind: "cc", ch: 2, cc: 1, value: 30 })).toEqual([0xb0, 1, 30]);
    expect(engineBytes({ kind: "cc", ch: 2, cc: 64, value: 127 })).toEqual([0xb0, 64, 127]);
  });
});
