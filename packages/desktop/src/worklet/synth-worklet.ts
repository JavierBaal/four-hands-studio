/**
 * Synth AudioWorklet: SpessaSynth (spessasynth_core, Apache-2.0) on the audio thread,
 * with a sample-accurate event queue (ARQUITECTURA.md, 7.1).
 *
 * - "now" events (keyboard, MIDI input) apply at the start of the next block.
 * - "sched" events (playback, metronome) apply at their exact frame.
 * - Every second it reports how much of the block budget the synth uses.
 */
import { SoundBankLoader, SpessaSynthProcessor } from "spessasynth_core";
import type { FromWorklet, SynthEvent, ToWorklet } from "../shared/messages.js";
import { EventQueue, renderBlock } from "./queue.js";

declare const sampleRate: number;
declare const currentFrame: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const BLOCK = 128;

const clockNow: () => number =
  typeof (globalThis as { performance?: { now(): number } }).performance?.now === "function"
    ? () => (globalThis as unknown as { performance: { now(): number } }).performance.now()
    : () => Date.now();
const clockName: "performance" | "date" =
  typeof (globalThis as { performance?: unknown }).performance === "object" ? "performance" : "date";

class FhSynthProcessor extends AudioWorkletProcessor {
  private synth: SpessaSynthProcessor | null = null;
  private queue = new EventQueue<SynthEvent>();
  private immediate: Array<{ ev: SynthEvent; id?: number }> = [];
  // stats
  private statBlocks = 0;
  private statBusy = 0;
  private statMax = 0;
  private statLate = 0;
  private lastReport = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => this.onMessage(e.data);
  }

  private send(msg: FromWorklet): void {
    this.port.postMessage(msg);
  }

  private async load(buf: ArrayBuffer, predecode: boolean): Promise<void> {
    try {
      const t0 = clockNow();
      const bank = SoundBankLoader.fromArrayBuffer(buf);
      const t1 = clockNow();
      const synth = new SpessaSynthProcessor(sampleRate, { maxBufferSize: BLOCK, effectsEnabled: true });
      synth.soundBankManager.addSoundBank(bank, "main");
      await synth.processorInitialized;
      const t2 = clockNow();
      // SF3 samples are Vorbis-compressed and decoded on first use, which can stall the audio
      // thread for several ms the first time a sound plays. Decoding them all up front avoids it.
      let samples = 0;
      if (predecode) {
        for (const s of bank.samples) {
          s.getAudioData();
          samples++;
        }
      }
      const t3 = clockNow();
      this.synth = synth;
      const presets = bank.presets.map((p) => {
        const anyP = p as unknown as { program?: number; bankMSB?: number; bank?: number; name: string };
        return { program: anyP.program ?? 0, bank: anyP.bankMSB ?? anyP.bank ?? 0, name: anyP.name };
      });
      this.send({ t: "ready", parseMs: t1 - t0, initMs: t2 - t1, decodeMs: t3 - t2, samples, presets });
    } catch (err) {
      this.send({ t: "error", message: String((err as Error)?.stack ?? err) });
    }
  }

  /** A bank the user installed, next to the main one. SF3 samples are decoded up front, as above. */
  private addBank(id: string, buf: ArrayBuffer, offset: number): void {
    try {
      if (!this.synth) throw new Error("Synth not ready");
      const bank = SoundBankLoader.fromArrayBuffer(buf);
      for (const s of bank.samples) s.getAudioData();
      this.synth.soundBankManager.addSoundBank(bank, id, offset);
      this.send({ t: "bankReady", id });
    } catch (err) {
      this.send({ t: "bankError", id, message: String((err as Error)?.message ?? err) });
    }
  }

  private onMessage(msg: ToWorklet): void {
    switch (msg.t) {
      case "load":
        void this.load(msg.soundfont, msg.predecode);
        break;
      case "bank":
        this.addBank(msg.id, msg.soundfont, msg.offset);
        break;
      case "now":
        this.immediate.push(msg.id === undefined ? { ev: msg.ev } : { ev: msg.ev, id: msg.id });
        break;
      case "sched":
        for (const { time, ev } of msg.events) this.queue.push(Math.round(time * sampleRate), ev);
        break;
      case "effects":
        // Effects can be switched off to compare load; spessasynth exposes it as a system parameter.
        try {
          (this.synth as unknown as { setSystemParameter(k: string, v: boolean): void })?.setSystemParameter("effectsEnabled", msg.enabled);
        } catch {
          /* not available in this version */
        }
        break;
    }
  }

  private apply(ev: SynthEvent): void {
    const s = this.synth;
    if (!s) return;
    switch (ev.kind) {
      case "on":
        s.noteOn(ev.ch, ev.note, ev.vel);
        break;
      case "off":
        s.noteOff(ev.ch, ev.note);
        break;
      case "prog":
        if (ev.bank !== undefined) s.controllerChange(ev.ch, 0 as never, ev.bank);
        s.programChange(ev.ch, ev.prog);
        break;
      case "cc":
        s.controllerChange(ev.ch, ev.cc as never, ev.value);
        break;
      case "panic":
        s.stopAllChannels(true);
        this.queue.clear();
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const left = out?.[0];
    const right = out?.[1] ?? left;
    if (!this.synth || !left || !right) return true;
    const synth = this.synth;
    const t0 = clockNow();

    // Live input first, at the very start of the block.
    if (this.immediate.length) {
      const now = this.immediate;
      this.immediate = [];
      for (const item of now) {
        this.apply(item.ev);
        if (item.id !== undefined) this.send({ t: "applied", id: item.id, frame: currentFrame });
      }
    }

    renderBlock(
      this.queue,
      currentFrame,
      BLOCK,
      (start, count) => synth.process(left, right, start, count),
      (ev) => this.apply(ev),
      () => this.statLate++,
    );

    const busy = clockNow() - t0;
    this.statBlocks++;
    this.statBusy += busy;
    if (busy > this.statMax) this.statMax = busy;
    const nowFrame = currentFrame;
    if (nowFrame - this.lastReport >= sampleRate) {
      const budget = (BLOCK / sampleRate) * 1000;
      this.send({
        t: "stats",
        avgLoad: this.statBusy / this.statBlocks / budget,
        maxLoad: this.statMax / budget,
        maxBlockMs: this.statMax,
        lateEvents: this.statLate,
        blocks: this.statBlocks,
        clock: clockName,
      });
      this.statBlocks = 0;
      this.statBusy = 0;
      this.statMax = 0;
      this.statLate = 0;
      this.lastReport = nowFrame;
    }
    return true;
  }
}

registerProcessor("fh-synth", FhSynthProcessor);
