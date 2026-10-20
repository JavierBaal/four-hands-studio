import { describe, expect, it } from "vitest";
import type { SynthEvent } from "../shared/messages.js";
import { SoundRouter, midiBytes } from "./router.js";

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
