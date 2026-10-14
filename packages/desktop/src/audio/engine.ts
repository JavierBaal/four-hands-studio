/**
 * Audio engine for the window: AudioContext + synth worklet + lookahead scheduler.
 * The scheduler sends the next 200 ms of events every 25 ms, like the real app will
 * during playback (ARQUITECTURA.md, 7.1), so UI stalls longer than the lookahead show up as late events.
 */
import type { FromWorklet, SynthEvent, ToWorklet, WorkletStats } from "../shared/messages.js";

export interface LatencySample {
  source: "keyboard" | "midi";
  ms: number;
}

export interface Instrument {
  id: string;
  name: string;
  prog: number;
  ch: number;
}

export const INSTRUMENTS: readonly Instrument[] = [
  { id: "piano", name: "Piano", prog: 0, ch: 0 },
  { id: "strings", name: "Cuerdas (conjunto)", prog: 48, ch: 1 },
  { id: "violin", name: "Violín", prog: 40, ch: 2 },
  { id: "viola", name: "Viola", prog: 41, ch: 3 },
  { id: "cello", name: "Chelo", prog: 42, ch: 4 },
  { id: "bass", name: "Contrabajo", prog: 43, ch: 5 },
  { id: "pizz", name: "Pizzicato", prog: 45, ch: 6 },
  { id: "organ", name: "Órgano", prog: 19, ch: 7 },
  { id: "pad", name: "Pad", prog: 89, ch: 8 },
  { id: "timpani", name: "Timbales", prog: 47, ch: 10 },
];

export interface ReadyInfo {
  parseMs: number;
  initMs: number;
  decodeMs: number;
  samples: number;
  presetCount: number;
}

/** Banks next to the main one take bank select 20, 30, 40… (room for their own variations). */
export const BANK_OFFSET_FIRST = 20;
export const BANK_OFFSET_STEP = 10;
export const MAX_EXTRA_BANKS = 10;

export class Engine {
  ctx!: AudioContext;
  private node!: AudioWorkletNode;
  private nextId = 1;
  private pending = new Map<number, { t: number; source: LatencySample["source"] }>();
  onLatency: (s: LatencySample) => void = () => {};
  onStats: (s: WorkletStats) => void = () => {};
  onError: (m: string) => void = () => {};

  /** `presetInstruments`: the S0 test sets its own palette; the app sends each track's program. */
  async init(soundfont: ArrayBuffer, workletUrl: string, presetInstruments = true): Promise<ReadyInfo> {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    await this.ctx.audioWorklet.addModule(workletUrl);
    this.node = new AudioWorkletNode(this.ctx, "fh-synth", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    this.node.connect(this.ctx.destination);
    const ready = new Promise<ReadyInfo>((resolve, reject) => {
      this.node.port.onmessage = (e: MessageEvent<FromWorklet>) => {
        const m = e.data;
        if (m.t === "ready") {
          resolve({ parseMs: m.parseMs, initMs: m.initMs, decodeMs: m.decodeMs, samples: m.samples, presetCount: m.presets.length });
        } else if (m.t === "error") {
          reject(new Error(m.message));
          this.onError(m.message);
        } else if (m.t === "applied") {
          this.onApplied(m.id, m.frame);
        } else if (m.t === "stats") {
          this.onStats(m);
        } else if (m.t === "bankReady" || m.t === "bankError") {
          const wait = this.bankWaits.get(m.id);
          this.bankWaits.delete(m.id);
          if (m.t === "bankReady") wait?.resolve();
          else wait?.reject(new Error(m.message));
        }
      };
    });
    this.post({ t: "load", soundfont, predecode: true }, [soundfont]);
    const info = await ready;
    if (presetInstruments) for (const inst of INSTRUMENTS) this.now({ kind: "prog", ch: inst.ch, prog: inst.prog });
    if (this.ctx.state !== "running") await this.ctx.resume();
    return info;
  }

  private bankWaits = new Map<string, { resolve(): void; reject(e: Error): void }>();
  private bankOffsets = new Map<string, number>();

  /** Bank select of an added bank, or undefined if it is not loaded. */
  bankOffset(id: string): number | undefined {
    return this.bankOffsets.get(id);
  }

  private bankLoads = new Map<string, Promise<number>>();
  private banksReserved = 0;

  /**
   * Loads a bank next to the main one (once; repeated calls wait for the same load) and gives its
   * bank select offset. The offset is reserved at once, so two banks loading together never share it.
   */
  addBank(id: string, soundfont: () => Promise<ArrayBuffer | null>): Promise<number> {
    const known = this.bankLoads.get(id);
    if (known) return known;
    if (this.banksReserved >= MAX_EXTRA_BANKS) return Promise.reject(new Error("Too many sound banks at once"));
    const offset = BANK_OFFSET_FIRST + this.banksReserved++ * BANK_OFFSET_STEP;
    const load = (async () => {
      const buf = await soundfont();
      if (!buf) throw new Error(`Sound bank not found: ${id}`);
      const done = new Promise<void>((resolve, reject) => this.bankWaits.set(id, { resolve, reject }));
      this.post({ t: "bank", id, soundfont: buf, offset }, [buf]);
      await done;
      this.bankOffsets.set(id, offset);
      return offset;
    })();
    this.bankLoads.set(id, load);
    // A failed load can be tried again later (the file may come back).
    load.catch(() => this.bankLoads.delete(id));
    return load;
  }

  private post(msg: ToWorklet, transfer: Transferable[] = []): void {
    this.node.port.postMessage(msg, transfer);
  }

  /** Plays an event right away. With `inputTime` (performance.now() of the key or MIDI event) its latency is measured. */
  now(ev: SynthEvent, inputTime?: number, source: LatencySample["source"] = "keyboard"): void {
    if (inputTime === undefined) {
      this.post({ t: "now", ev });
      return;
    }
    const id = this.nextId++;
    this.pending.set(id, { t: inputTime, source });
    this.post({ t: "now", ev, id });
  }

  sched(events: Array<{ time: number; ev: SynthEvent }>): void {
    if (events.length) this.post({ t: "sched", events });
  }

  panic(): void {
    this.post({ t: "now", ev: { kind: "panic" } });
  }

  private onApplied(id: number, frame: number): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    // When will that frame leave the speakers, in performance.now() time?
    const ts = this.ctx.getOutputTimestamp();
    if (ts.contextTime === undefined || ts.performanceTime === undefined) return;
    const frameTime = frame / this.ctx.sampleRate;
    const outAt = ts.performanceTime + (frameTime - ts.contextTime) * 1000;
    this.onLatency({ source: p.source, ms: outAt - p.t });
  }

  get baseLatencyMs(): number {
    return (this.ctx.baseLatency ?? 0) * 1000;
  }

  get outputLatencyMs(): number {
    return ((this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0) * 1000;
  }
}

/** Sends a precomputed list of events through the lookahead window, as live playback would. */
export class LookaheadPlayer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private idx = 0;
  private events: Array<{ at: number; ev: SynthEvent }> = [];
  private t0 = 0;
  onDone: () => void = () => {};

  constructor(
    private engine: Engine,
    private lookahead = 0.2,
    private tickMs = 25,
  ) {}

  /** `events[].at` in seconds from the start. */
  play(events: Array<{ at: number; ev: SynthEvent }>): void {
    this.stop();
    this.events = [...events].sort((a, b) => a.at - b.at);
    this.idx = 0;
    this.t0 = this.engine.ctx.currentTime + 0.1;
    const tick = () => {
      const horizon = this.engine.ctx.currentTime + this.lookahead;
      const batch: Array<{ time: number; ev: SynthEvent }> = [];
      while (this.idx < this.events.length && this.t0 + this.events[this.idx]!.at < horizon) {
        const e = this.events[this.idx++]!;
        batch.push({ time: this.t0 + e.at, ev: e.ev });
      }
      this.engine.sched(batch);
      if (this.idx >= this.events.length) {
        const end = this.t0 + (this.events.at(-1)?.at ?? 0);
        if (this.engine.ctx.currentTime > end + 0.3) {
          this.stop();
          this.onDone();
        }
      }
    };
    tick();
    this.timer = setInterval(tick, this.tickMs);
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

// ---------- Test material ----------

const note = (at: number, dur: number, ch: number, n: number, vel: number) => [
  { at, ev: { kind: "on", ch, note: n, vel } as SynthEvent },
  { at: at + dur, ev: { kind: "off", ch, note: n } as SynthEvent },
];

/** Am – F – C – G at 72 BPM: strings chords, cello roots, piano arpeggio. Two rounds. */
export function listeningDemo(): Array<{ at: number; ev: SynthEvent }> {
  const beat = 60 / 72;
  const bar = 4 * beat;
  const chords = [
    { root: 45, tones: [57, 60, 64], arp: [69, 72, 76, 72] }, // Am
    { root: 41, tones: [57, 60, 65], arp: [65, 69, 72, 69] }, // F
    { root: 48, tones: [55, 60, 64], arp: [67, 72, 76, 72] }, // C
    { root: 43, tones: [55, 59, 62], arp: [67, 71, 74, 71] }, // G
  ];
  const out: Array<{ at: number; ev: SynthEvent }> = [];
  for (let round = 0; round < 2; round++) {
    chords.forEach((c, i) => {
      const t = (round * 4 + i) * bar;
      for (const n of c.tones) out.push(...note(t, bar * 0.98, 1, n, 70));
      out.push(...note(t, bar * 0.98, 4, c.root, 80));
      for (let k = 0; k < 8; k++) out.push(...note(t + k * (beat / 2), beat / 2, 0, c.arp[k % 4]!, k % 2 ? 62 : 78));
    });
  }
  out.push(...note(8 * bar, bar * 2, 1, 57, 60), ...note(8 * bar, bar * 2, 1, 64, 60), ...note(8 * bar, bar * 2, 4, 45, 70), ...note(8 * bar, bar * 2, 0, 69, 70));
  return out;
}

/** Sixteenths at 120 BPM for 8 bars on the piano, accents on the beat: easy to hear any wobble. */
export function tempoTest(): Array<{ at: number; ev: SynthEvent }> {
  const s16 = 60 / 120 / 4;
  const out: Array<{ at: number; ev: SynthEvent }> = [];
  for (let i = 0; i < 8 * 16; i++) {
    const accent = i % 4 === 0;
    out.push(...note(i * s16, s16 * 0.6, 0, accent ? 84 : 72, accent ? 100 : 60));
  }
  return out;
}

/** Sustained chords on every instrument at once (about 40 notes, many more voices). */
export function loadTest(seconds = 8): Array<{ at: number; ev: SynthEvent }> {
  const out: Array<{ at: number; ev: SynthEvent }> = [];
  const chord = [48, 55, 60, 64];
  INSTRUMENTS.forEach((inst, i) => {
    const shift = inst.id === "bass" || inst.id === "cello" ? -12 : inst.id === "violin" ? 12 : 0;
    for (const n of chord) out.push(...note(0.05 * i, seconds, inst.ch, n + shift, 85));
  });
  return out;
}
