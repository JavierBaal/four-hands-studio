/**
 * Transport and live input (ARQUITECTURA.md, 7): plays the replica through the synth worklet with
 * a 200 ms lookahead, loops, clicks the metronome, counts in before recording, and sends what the
 * user plays (computer keyboard or MIDI) straight to the synth.
 *
 * Without a SoundFont (the browser harness) everything runs silently on the same clock, so the
 * transport can still be tested.
 */
import { type Song, barTicks, beatTicks, songEnd } from "@fourhands/core";
import type { SynthEvent } from "../shared/messages.js";
import type { Engine } from "./engine.js";
import { type LoopRange, METRONOME_CHANNEL, type SoundResolver, clickEvents, curveResetEvents, curveStateEvents, noteEvents, secondsPerTick, setupEvents, windowPieces } from "./schedule.js";

const LOOKAHEAD = 0.2;
const TICK_MS = 25;
/** Start a little in the future so the first events are never late. */
const START_DELAY = 0.08;

export interface PlayOptions {
  /** Bars of metronome before `from` (recording). */
  countIn?: number;
  metronome?: boolean;
  /** Ignore the loop (recording plays straight on). */
  noLoop?: boolean;
}

export interface LiveNote {
  pitch: number;
  velocity: number;
  /** Song tick where it was played, when the transport is running (else null). */
  tick: number | null;
}

export class Player {
  playing = false;
  metronome = false;
  /** Song tick where playback started (the cursor). */
  startTick = 0;
  version = 0;
  /** Called with every note played live, on and off (recording listens here). */
  onLive: ((kind: "on" | "off", note: LiveNote) => void) | null = null;
  onLiveCc: ((cc: number, value: number, tick: number | null) => void) | null = null;
  onStop: (() => void) | null = null;
  private anchor = 0;
  private countInTicks = 0;
  private done = 0;
  private doneSong = 0;
  /** The loop in force: the song's loop region (shared context), read again every 25 ms. */
  private loop: LoopRange | null = null;
  private noLoop = false;
  /** Where the playhead mapping starts: song tick `anchorSong` at linear tick `anchorLinear`. */
  private anchorLinear = 0;
  private anchorSong = 0;
  private spt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private held = new Map<number, { ch: number; pitch: number }>();
  private setupDone = false;
  /** Send where the curves stand before the next piece: playback just started or jumped. */
  private needCurveState = true;
  /** Which bank and preset each track plays with (set by the audio layer). */
  soundFor: SoundResolver = () => null;

  constructor(
    private readonly song: () => Song,
    private engine: Engine | null = null,
  ) {}

  setEngine(engine: Engine): void {
    this.engine = engine;
    this.setupDone = false;
    this.setup();
  }

  get hasSound(): boolean {
    return this.engine !== null;
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = (): number => this.version;
  private changed(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  private now(): number {
    return this.engine ? this.engine.ctx.currentTime : performance.now() / 1000;
  }

  /** Sends programs, volume and pan. Called before playing and whenever tracks change. */
  setup(): void {
    if (!this.engine) return;
    for (const ev of setupEvents(this.song(), this.soundFor)) this.engine.now(ev);
    this.setupDone = true;
  }

  // -------------------------------------------------------------------------
  // Transport

  play(from: number, options: PlayOptions = {}): void {
    this.stopTimer();
    if (!this.setupDone) this.setup();
    const song = this.song();
    this.spt = secondsPerTick(song);
    this.noLoop = !!options.noLoop;
    this.loop = this.currentLoop();
    if (this.loop && (from < this.loop.start || from >= this.loop.end) && !options.countIn) from = this.loop.start;
    this.startTick = from;
    this.countInTicks = Math.round((options.countIn ?? 0) * barTicks(song.meter));
    this.metronome = options.metronome ?? this.metronome;
    this.anchor = this.now() + START_DELAY;
    this.done = -this.countInTicks;
    this.doneSong = from;
    this.anchorLinear = 0;
    this.anchorSong = from;
    this.playing = true;
    this.needCurveState = true;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    this.changed();
  }

  stop(): void {
    if (!this.playing) return;
    this.stopTimer();
    this.playing = false;
    this.engine?.panic();
    if (this.engine) for (const ev of curveResetEvents(this.song())) this.engine.now(ev);
    this.held.clear();
    this.changed();
    this.onStop?.();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Linear ticks since playback started (negative during the count-in). */
  private elapsed(): number {
    return (this.now() - this.anchor) / this.spt - this.countInTicks;
  }

  /** Song tick under the playhead, or null when stopped. During the count-in, the start tick. */
  position(): number | null {
    if (!this.playing) return null;
    return this.songTickAt(this.elapsed());
  }

  /** Beats left before the take starts, during the count-in; otherwise 0. */
  countInBeatsLeft(): number {
    if (!this.playing) return 0;
    const linear = this.elapsed();
    return linear < 0 ? Math.ceil(-linear / beatTicks(this.song().meter)) : 0;
  }

  /** True while counting in. */
  countingIn(): boolean {
    return this.playing && this.elapsed() < 0;
  }

  /** The song's loop region, unless this playback ignores it (recording). */
  private currentLoop(): LoopRange | null {
    const loop = this.song().context.loop;
    return !this.noLoop && loop && loop.end > loop.start ? { start: loop.start, end: loop.end } : null;
  }

  private songTickAt(linear: number): number {
    if (linear < 0) return this.startTick;
    const s = this.anchorSong + (linear - this.anchorLinear);
    const loop = this.loop;
    if (!loop || this.anchorSong >= loop.end || s < loop.end) return s;
    return loop.start + ((s - loop.end) % (loop.end - loop.start));
  }

  /** The loop was drawn, moved or removed while playing: it applies from now on. */
  private followLoop(): void {
    const next = this.currentLoop();
    const same = next === this.loop || (next && this.loop && next.start === this.loop.start && next.end === this.loop.end);
    if (same) return;
    const linear = Math.max(0, this.elapsed());
    const doneAt = Math.max(0, this.done);
    const posNow = this.songTickAt(linear);
    this.anchorSong = posNow;
    this.anchorLinear = linear;
    this.loop = next;
    // Recompute where the already scheduled window ends under the new loop.
    this.doneSong = this.songTickAt(doneAt);
  }

  private schedule(): void {
    const song = this.song();
    if (this.done >= 0) this.followLoop();
    const horizon = (this.now() + LOOKAHEAD - this.anchor) / this.spt - this.countInTicks;
    if (horizon <= this.done) return;
    const events: { time: number; ev: SynthEvent }[] = [];
    const at = (linear: number) => this.anchor + (linear + this.countInTicks) * this.spt;

    // Count-in: clicks only, before the song starts (linear ticks from -countIn to 0).
    if (this.done < 0) {
      const to = Math.min(0, horizon);
      const beat = beatTicks(song.meter);
      const bar = barTicks(song.meter);
      for (let l = Math.ceil(this.done / beat) * beat; l < to; l += beat) {
        const down = (l + this.countInTicks) % bar === 0;
        const note = down ? 84 : 77;
        events.push({ time: at(l), ev: { kind: "on", ch: METRONOME_CHANNEL, note, vel: down ? 110 : 80 } });
        events.push({ time: at(l + beat / 8), ev: { kind: "off", ch: METRONOME_CHANNEL, note } });
      }
      this.done = to;
    }
    if (horizon > this.done) {
      const length = horizon - this.done;
      for (const piece of windowPieces(this.doneSong, length, this.loop)) {
        const base = this.done + piece.offset - piece.from;
        if (this.needCurveState) {
          // Just before the piece, so the points at its very first tick still win.
          for (const ev of curveStateEvents(song, piece.from)) events.push({ time: at(base + piece.from) - 0.001, ev });
          this.needCurveState = false;
        }
        for (const e of noteEvents(song, piece.from, piece.to, this.loop?.end)) events.push({ time: at(base + e.tick), ev: e.ev });
        if (this.metronome) for (const e of clickEvents(song, piece.from, piece.to)) events.push({ time: at(base + e.tick), ev: e.ev });
        this.doneSong = this.loop && piece.to >= this.loop.end ? this.loop.start : piece.to;
        if (this.loop && piece.to >= this.loop.end) this.needCurveState = true;
      }
      this.done = horizon;
    }
    this.engine?.sched(events);

    // Without a loop, stop one bar after the last note (unless recording, which keeps going).
    if (!this.loop && !this.metronome) {
      const end = songEnd(song) + barTicks(song.meter);
      const pos = this.position();
      if (pos !== null && pos > end) this.stop();
    }
  }

  // -------------------------------------------------------------------------
  // Live input: plays right away on the active track's channel

  liveOn(pitch: number, velocity: number, channel: number, inputTime?: number, source: "keyboard" | "midi" = "keyboard"): void {
    if (this.held.has(pitch)) this.liveOff(pitch);
    this.held.set(pitch, { ch: channel, pitch });
    this.engine?.now({ kind: "on", ch: channel, note: pitch, vel: velocity }, inputTime, source);
    this.onLive?.("on", { pitch, velocity, tick: this.liveTick() });
  }

  liveOff(pitch: number): void {
    const h = this.held.get(pitch);
    if (!h) return;
    this.held.delete(pitch);
    this.engine?.now({ kind: "off", ch: h.ch, note: pitch });
    this.onLive?.("off", { pitch, velocity: 0, tick: this.liveTick() });
  }

  /** Volume and pan heard at once while a fader moves, before the song has the new value (H3.2). */
  previewMix(channel: number, volume: number, pan: number): void {
    this.engine?.now({ kind: "cc", ch: channel, cc: 7, value: Math.round(Math.max(0, Math.min(1, volume)) * 127) });
    this.engine?.now({ kind: "cc", ch: channel, cc: 10, value: Math.round(64 + Math.max(-1, Math.min(1, pan)) * 63) });
  }

  liveCc(cc: number, value: number, channel: number): void {
    this.engine?.now({ kind: "cc", ch: channel, cc, value });
    this.onLiveCc?.(cc, value, this.liveTick());
  }

  /**
   * Song tick of something played now. Uses the time the sound will actually leave, minus the
   * output latency, so a recorded note lands where the player heard it.
   */
  private liveTick(): number | null {
    if (!this.playing) return null;
    const linear = this.elapsed();
    // A note played just before the count-in ends lands just before the start (an anticipation).
    if (linear < 0) return this.startTick + linear >= 0 && linear > -this.countInTicks / 2 ? Math.round(this.startTick + linear) : null;
    return Math.round(this.songTickAt(linear));
  }

  /** A short preview of a note (clicking a note, creating one, the side keyboard). Not recorded. */
  audition(pitch: number, velocity: number, channel: number, ms = 350): void {
    if (!this.engine) return;
    this.engine.now({ kind: "on", ch: channel, note: pitch, vel: velocity });
    setTimeout(() => this.engine?.now({ kind: "off", ch: channel, note: pitch }), ms);
  }
}
