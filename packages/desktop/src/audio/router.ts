/**
 * MIDI out (H4, Fran 20/10/2026): tracks set to sound in another program (Studio One, through a
 * virtual port such as loopMIDI) send their events out on their own channel instead of playing
 * the built-in sound. The player keeps scheduling as always; this sits between it and the synth
 * and splits by channel. Program changes never go out (they would change the preset loaded in the
 * other program); notes, pedal, expression, modulation, volume, pan and reverb send do.
 */
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
}

export class SoundRouter implements SoundOut {
  constructor(private readonly options: RouterOptions) {}

  get ctx(): { readonly currentTime: number } {
    return this.options.inner.ctx;
  }

  private outside(ev: SynthEvent): boolean {
    return ev.kind !== "panic" && this.options.external().has(ev.ch);
  }

  now(ev: SynthEvent, inputTime?: number, source?: "keyboard" | "midi"): void {
    if (!this.outside(ev)) {
      this.options.inner.now(ev, inputTime, source);
      return;
    }
    const bytes = midiBytes(ev);
    if (bytes) this.options.port()?.send(bytes);
  }

  sched(events: Array<{ time: number; ev: SynthEvent }>): void {
    const inside: Array<{ time: number; ev: SynthEvent }> = [];
    const port = this.options.port();
    const perfNow = (this.options.perfNow ?? (() => performance.now()))();
    const nowSec = this.ctx.currentTime;
    const delay = this.options.delayMs?.() ?? 0;
    for (const e of events) {
      if (!this.outside(e.ev)) {
        inside.push(e);
        continue;
      }
      const bytes = midiBytes(e.ev);
      if (bytes && port) port.send(bytes, Math.max(perfNow, perfNow + (e.time - nowSec) * 1000 + delay));
    }
    if (inside.length) this.options.inner.sched(inside);
  }

  panic(): void {
    this.options.inner.panic();
    const port = this.options.port();
    if (!port) return;
    for (const ch of this.options.external()) for (const bytes of silenceBytes(ch)) port.send(bytes);
  }

  /** A channel changed sides while something sounded: stop it on both. */
  silence(ch: number): void {
    for (const bytes of silenceBytes(ch)) this.options.port()?.send(bytes);
    this.options.inner.now({ kind: "cc", ch, cc: 64, value: 0 });
    this.options.inner.now({ kind: "cc", ch, cc: 123, value: 0 });
  }
}
