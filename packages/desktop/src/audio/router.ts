/**
 * MIDI out (H4, Fran 20/10/2026): tracks set to sound in another program (Studio One, through a
 * virtual port such as loopMIDI) send their events out on their own channel instead of playing
 * the built-in sound. The player keeps scheduling as always; this sits between it and the synth
 * and splits by channel. Program changes never go out (they would change the preset loaded in the
 * other program); notes, pedal, expression, modulation, volume, pan and reverb send do.
 */
import type { EngineMidiEvent } from "../shared/engine.js";
import type { SynthEvent } from "../shared/messages.js";

/** What the player plays through: the synth itself, or this router around it. */
export interface SoundOut {
  readonly ctx: { readonly currentTime: number };
  now(ev: SynthEvent, inputTime?: number, source?: "keyboard" | "midi"): void;
  sched(events: Array<{ time: number; ev: SynthEvent }>): void;
  panic(): void;
}

/** A MIDI output port (Web MIDI's MIDIOutput has this shape). */
export interface MidiPort {
  send(data: number[], timestamp?: number): void;
}

/**
 * Is this MIDI input the other end of our own output? A virtual port (loopMIDI) has the same name
 * on both sides: listening to it would play back everything we send, send it again, and so on
 * (loopMIDI then mutes the port). Windows may add a number to a repeated name ("Four Hands 2").
 */
export function isOwnLoopback(inputName: string | null | undefined, outName: string | null): boolean {
  if (!inputName || !outName) return false;
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+\d+$/, "");
  return norm(inputName) === norm(outName);
}

/** The bytes of an event, or null when it does not go out (program changes, panic). */
export function midiBytes(ev: SynthEvent): number[] | null {
  switch (ev.kind) {
    case "on":
      return [0x90 | ev.ch, ev.note & 0x7f, Math.max(1, Math.min(127, ev.vel))];
    case "off":
      return [0x80 | ev.ch, ev.note & 0x7f, 0];
    case "cc":
      return [0xb0 | ev.ch, ev.cc & 0x7f, Math.max(0, Math.min(127, ev.value))];
    default:
      return null;
  }
}

/** Silence on a channel of the other program: sustain up, all notes off, all sound off. */
export function silenceBytes(ch: number): number[][] {
  return [
    [0xb0 | ch, 64, 0],
    [0xb0 | ch, 123, 0],
    [0xb0 | ch, 120, 0],
  ];
}

/**
 * The native engine (fase 2, prueba S2): a track that sounds through a plugin plays in the slot of
 * its channel. The plugin always hears MIDI channel 1 (a Kontakt instrument listens there, or on
 * all of them).
 */
export interface EnginePort {
  midi(events: EngineMidiEvent[]): void;
  panic(): void;
  /** Seconds from the engine receiving a note to its speakers. */
  latency(): number;
}

/** An event for a plugin slot: the same bytes on channel 1. */
export function engineBytes(ev: SynthEvent): number[] | null {
  const bytes = midiBytes(ev);
  if (bytes) bytes[0] = bytes[0]! & 0xf0;
  return bytes;
}

export interface RouterOptions {
  /** The built-in synth. */
  inner: SoundOut;
  /** Channels of the tracks that sound outside, read at every call (the song can change). */
  external: () => ReadonlySet<number>;
  /** The chosen port, or null (then external tracks are silent: nothing doubles). */
  port: () => MidiPort | null;
  /** Milliseconds, the clock MIDI timestamps use (performance.now in the window). */
  perfNow?: () => number;
  /**
   * Added to every scheduled event, in ms: the built-in sound leaves the speakers this late, so the
   * other program plays at the same moment.
   */
  delayMs?: () => number;
  /** Channels of the tracks that sound through a plugin of the engine. */
  plugin?: () => ReadonlySet<number>;
  engine?: () => EnginePort | null;
}

type Side = "inner" | "port" | "engine";

export class SoundRouter implements SoundOut {
  constructor(private readonly options: RouterOptions) {}

  get ctx(): { readonly currentTime: number } {
    return this.options.inner.ctx;
  }

  private side(ev: SynthEvent): Side {
    if (ev.kind === "panic") return "inner";
    if (this.options.plugin?.().has(ev.ch)) return "engine";
    return this.options.external().has(ev.ch) ? "port" : "inner";
  }

  now(ev: SynthEvent, inputTime?: number, source?: "keyboard" | "midi"): void {
    const side = this.side(ev);
    if (side === "inner") {
      this.options.inner.now(ev, inputTime, source);
      return;
    }
    if (side === "engine") {
      const data = engineBytes(ev);
      if (data) this.options.engine?.()?.midi([{ slot: ev.kind === "panic" ? 0 : ev.ch, delay: 0, data }]);
      return;
    }
    const bytes = midiBytes(ev);
    if (bytes) this.options.port()?.send(bytes);
  }

  sched(events: Array<{ time: number; ev: SynthEvent }>): void {
    const inside: Array<{ time: number; ev: SynthEvent }> = [];
    const toEngine: EngineMidiEvent[] = [];
    const port = this.options.port();
    const engine = this.options.engine?.() ?? null;
    const perfNow = (this.options.perfNow ?? (() => performance.now()))();
    const nowSec = this.ctx.currentTime;
    const delay = this.options.delayMs?.() ?? 0;
    // The plugin leaves the speakers at the same moment as the built-in sound: its own delay off.
    const engineShift = delay / 1000 - (engine?.latency() ?? 0);
    for (const e of events) {
      const side = this.side(e.ev);
      if (side === "inner") {
        inside.push(e);
        continue;
      }
      if (side === "engine") {
        const data = engineBytes(e.ev);
        if (data && engine && e.ev.kind !== "panic") toEngine.push({ slot: e.ev.ch, delay: Math.max(0, e.time - nowSec + engineShift), data });
        continue;
      }
      const bytes = midiBytes(e.ev);
      if (bytes && port) port.send(bytes, Math.max(perfNow, perfNow + (e.time - nowSec) * 1000 + delay));
    }
    if (inside.length) this.options.inner.sched(inside);
    if (toEngine.length) engine!.midi(toEngine);
  }

  panic(): void {
    this.options.inner.panic();
    this.options.engine?.()?.panic();
    const port = this.options.port();
    if (!port) return;
    for (const ch of this.options.external()) for (const bytes of silenceBytes(ch)) port.send(bytes);
  }

  /** A channel changed sides while something sounded: stop it everywhere. */
  silence(ch: number): void {
    for (const bytes of silenceBytes(ch)) this.options.port()?.send(bytes);
    this.options.engine?.()?.midi(silenceBytes(0).map((data) => ({ slot: ch, delay: 0, data })));
    this.options.inner.now({ kind: "cc", ch, cc: 64, value: 0 });
    this.options.inner.now({ kind: "cc", ch, cc: 123, value: 0 });
  }
}
