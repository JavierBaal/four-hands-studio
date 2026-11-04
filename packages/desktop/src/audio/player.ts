/**
 * Transport and live input (ARQUITECTURA.md, 7): plays the replica through the synth worklet with
 * a 200 ms lookahead, loops, clicks the metronome, counts in before recording, and sends what the
 * user plays (computer keyboard or MIDI) straight to the synth.
 *
 * Without a SoundFont (the browser harness) everything runs silently on the same clock, so the
 * transport can still be tested.
 */
import { PPQ, type Song, barAt, barStart, barTicks, beatTicks, bpmAt, secondsBetween, songEnd, tickAfter } from "@fourhands/core";
import type { SynthEvent } from "../shared/messages.js";
import type { SoundOut, TransportAt } from "./router.js";
import { type LoopRange, METRONOME_CHANNEL, type SoundResolver, type StripResolver, clickEvents, curveResetEvents, curveStateEvents, noteEvents, setupEvents, windowPieces } from "./schedule.js";

const LOOKAHEAD = 0.2;
export const HIDDEN_LOOKAHEAD = 1.2;
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

/** Where live input, an audition or a mix preview plays: a track's MIDI channel and its strip (A2). */
export interface Target {
  ch: number;
  strip: number;
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
  /** Playback started (F2.2: the engine's levels start counting again). */
  onStart: (() => void) | null = null;
  /** Audio time when the song starts sounding (linear tick 0), after the count-in. */
  private startTime = 0;
  /** Seconds per tick during the count-in: the tempo where playback starts. */
  private countSpt = 0;
  private countInTicks = 0;
  private done = 0;
  private doneSong = 0;
  /** The loop in force: the song's loop region (shared context), read again every 25 ms. */
  private loop: LoopRange | null = null;
  private noLoop = false;
  /**
   * Where the playhead mapping starts: song tick `anchorSong` at linear tick `anchorLinear`, which
   * sounds at audio time `anchorTime`. From there, time follows the song's tempo map (H4) along
   * the loop. The anchor moves forward at every window, so the walks stay short.
   */
  private anchorLinear = 0;
  private anchorSong = 0;
  private anchorTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** The next piece starts somewhere new (playback start, loop back): the plugins get a point there. */
  private transportJump = false;
  /**
   * How far ahead the notes go out. Longer while the window is hidden (minimised): a second safety
   * net if the system still slows its timers down (Fran, 03/11/2026: stutters after Alt+Tab).
   */
  lookahead = LOOKAHEAD;
  private listeners = new Set<() => void>();
  private held = new Map<number, { to: Target; pitch: number }>();
  private setupDone = false;
  /** Send where the curves stand before the next piece: playback just started or jumped. */
  private needCurveState = true;
  /** Which bank and preset each track plays with (set by the audio layer). */
  soundFor: SoundResolver = () => null;
  /** A2: each track's strip in the engine, and the metronome's (set by the audio layer). */
  stripOf: StripResolver = (t) => t.channel;
  metronomeStrip = (): number => METRONOME_CHANNEL;

  constructor(
    private readonly song: () => Song,
    private engine: SoundOut | null = null,
  ) {}

  setEngine(engine: SoundOut): void {
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
    for (const ev of setupEvents(this.song(), this.soundFor, this.stripOf, this.metronomeStrip())) this.engine.now(ev);
    // Stopped, the plugins still get the song's tempo and where the cursor is (synced LFOs, delays).
    if (!this.playing) {
      const song = this.song();
      const tick = Math.max(0, song.context.cursor);
      this.engine.transport?.([{ ...this.transportAt(song, tick, this.now()), playing: false }]);
    }
    this.setupDone = true;
  }

  // -------------------------------------------------------------------------
  // Transport

  play(from: number, options: PlayOptions = {}): void {
    this.stopTimer();
    if (!this.setupDone) this.setup();
    const song = this.song();
    this.noLoop = !!options.noLoop;
    this.loop = this.currentLoop();
    if (this.loop && (from < this.loop.start || from >= this.loop.end) && !options.countIn) from = this.loop.start;
    this.startTick = from;
    this.countInTicks = Math.round((options.countIn ?? 0) * barTicks(song.meter));
    this.metronome = options.metronome ?? this.metronome;
    this.countSpt = 60 / (PPQ * bpmAt(song, from));
    this.startTime = this.now() + START_DELAY + this.countInTicks * this.countSpt;
    this.done = -this.countInTicks;
    this.doneSong = from;
    this.anchorLinear = 0;
    this.anchorSong = from;
    this.anchorTime = this.startTime;
    this.playing = true;
    this.onStart?.();
    this.needCurveState = true;
    this.transportJump = true;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    this.changed();
  }

  stop(): void {
    if (!this.playing) return;
    this.stopTimer();
    this.playing = false;
    // The plugins hear it stop where it stopped.
    const tick = Math.max(0, Math.round(this.position() ?? 0));
    this.engine?.transport?.([{ ...this.transportAt(this.song(), tick, this.now()), playing: false }]);
    this.engine?.panic();
    if (this.engine) for (const ev of curveResetEvents(this.song(), this.stripOf)) this.engine.now(ev);
    this.held.clear();
    this.changed();
    this.onStop?.();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The transport at a song tick, heard at `time`. */
  private transportAt(song: Song, tick: number, time: number): TransportAt {
    const bar = barStart(song.meter, barAt(song.meter, tick));
    return { time, playing: true, ppq: tick / PPQ, bpm: bpmAt(song, tick), num: song.meter.numerator, den: song.meter.denominator, bar: bar / PPQ };
  }

  /** Linear ticks since playback started (negative during the count-in). */
  private elapsed(): number {
    return this.linearAt(this.now());
  }

  /** Audio time of a linear tick: the count-in at the starting tempo, then the tempo map along the loop. */
  private timeAt(linear: number): number {
    if (linear < 0) return this.startTime + linear * this.countSpt;
    const song = this.song();
    const ahead = linear - this.anchorLinear;
    if (ahead < 0) return this.anchorTime - secondsBetween(song, Math.max(0, this.anchorSong + ahead), this.anchorSong);
    let t = this.anchorTime;
    for (const piece of windowPieces(this.anchorSong, ahead, this.loop)) t += secondsBetween(song, piece.from, piece.to);
    return t;
  }

  /** The linear tick sounding at an audio time (the inverse of `timeAt`). */
  private linearAt(time: number): number {
    if (time < this.startTime) return (time - this.startTime) / this.countSpt;
    const song = this.song();
    let left = time - this.anchorTime;
    let pos = this.anchorSong;
    let linear = this.anchorLinear;
    if (left < 0) return linear - (pos - tickAfter(song, pos, left));
    const loop = this.loop;
    while (loop && pos < loop.end) {
      const room = secondsBetween(song, pos, loop.end);
      if (left < room) break;
      left -= room;
      linear += loop.end - pos;
      pos = loop.start;
    }
    return linear + (tickAfter(song, pos, left) - pos);
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
    const timeNow = this.timeAt(linear);
    this.anchorSong = posNow;
    this.anchorLinear = linear;
    this.anchorTime = timeNow;
    this.loop = next;
    // Recompute where the already scheduled window ends under the new loop.
    this.doneSong = this.songTickAt(doneAt);
  }

  private schedule(): void {
    const song = this.song();
    if (this.done >= 0) this.followLoop();
    const horizon = this.linearAt(this.now() + this.lookahead);
    if (horizon <= this.done) return;
    const events: { time: number; ev: SynthEvent }[] = [];
    const transport: TransportAt[] = [];
    const at = (linear: number) => this.timeAt(linear);

    // Count-in: clicks only, before the song starts (linear ticks from -countIn to 0).
    if (this.done < 0) {
      const to = Math.min(0, horizon);
      const beat = beatTicks(song.meter);
      const bar = barTicks(song.meter);
      for (let l = Math.ceil(this.done / beat) * beat; l < to; l += beat) {
        const down = (l + this.countInTicks) % bar === 0;
        const note = down ? 84 : 77;
        const strip = this.metronomeStrip();
        events.push({ time: at(l), ev: { kind: "on", ch: METRONOME_CHANNEL, note, vel: down ? 110 : 80, strip } });
        events.push({ time: at(l + beat / 8), ev: { kind: "off", ch: METRONOME_CHANNEL, note, strip } });
      }
      this.done = to;
    }
    if (horizon > this.done) {
      const length = horizon - this.done;
      for (const piece of windowPieces(this.doneSong, length, this.loop)) {
        const base = this.done + piece.offset - piece.from;
        if (this.needCurveState) {
          // Just before the piece, so the points at its very first tick still win.
          for (const ev of curveStateEvents(song, piece.from, this.stripOf)) events.push({ time: at(base + piece.from) - 0.001, ev });
          this.needCurveState = false;
        }
        for (const e of noteEvents(song, piece.from, piece.to, this.loop?.end, this.stripOf)) events.push({ time: at(base + e.tick), ev: e.ev });
        // The plugins' transport (F2.2, 04/11/2026): where the piece starts (playback start, loop
        // back) and every quarter note in it, so a plugin knows it plays, at which tempo and where.
        let firstBeat = Math.ceil(piece.from / PPQ) * PPQ;
        if (this.transportJump && piece.to > piece.from) {
          transport.push(this.transportAt(song, piece.from, at(base + piece.from)));
          this.transportJump = false;
          if (firstBeat === piece.from) firstBeat += PPQ;
        }
        for (let tick = firstBeat; tick < piece.to; tick += PPQ) transport.push(this.transportAt(song, tick, at(base + tick)));
        if (this.metronome) for (const e of clickEvents(song, piece.from, piece.to, this.metronomeStrip())) events.push({ time: at(base + e.tick), ev: e.ev });
        this.doneSong = this.loop && piece.to >= this.loop.end ? this.loop.start : piece.to;
        if (this.loop && piece.to >= this.loop.end) {
          this.needCurveState = true;
          this.transportJump = true;
        }
      }
      this.done = horizon;
    }
    this.engine?.sched(events);
    if (transport.length) this.engine?.transport?.(transport);
    // Move the anchor up to the scheduled point: what comes next is measured from there.
    if (this.done > this.anchorLinear) {
      const time = this.timeAt(this.done);
      this.anchorSong = this.songTickAt(this.done);
      this.anchorLinear = this.done;
      this.anchorTime = time;
    }

    // Without a loop, stop one bar after the last note (unless recording, which keeps going).
    if (!this.loop && !this.metronome) {
      const end = songEnd(song) + barTicks(song.meter);
      const pos = this.position();
      if (pos !== null && pos > end) this.stop();
    }
  }

  // -------------------------------------------------------------------------
  // Live input: plays right away on the active track's channel

  liveOn(pitch: number, velocity: number, to: Target | number, inputTime?: number, source: "keyboard" | "midi" = "keyboard"): void {
    if (this.held.has(pitch)) this.liveOff(pitch);
    const t = target(to);
    this.held.set(pitch, { to: t, pitch });
    this.engine?.now({ kind: "on", ch: t.ch, note: pitch, vel: velocity, strip: t.strip }, inputTime, source);
    this.onLive?.("on", { pitch, velocity, tick: this.liveTick() });
  }

  liveOff(pitch: number): void {
    const h = this.held.get(pitch);
    if (!h) return;
    this.held.delete(pitch);
    this.engine?.now({ kind: "off", ch: h.to.ch, note: pitch, strip: h.to.strip });
    this.onLive?.("off", { pitch, velocity: 0, tick: this.liveTick() });
  }

  /** Volume and pan heard at once while a fader moves, before the song has the new value (H3.2). */
  previewMix(to: Target | number, volume: number, pan: number): void {
    const { ch, strip } = target(to);
    this.engine?.now({ kind: "cc", ch, cc: 7, value: Math.round(Math.max(0, Math.min(1, volume)) * 127), strip });
    this.engine?.now({ kind: "cc", ch, cc: 10, value: Math.round(64 + Math.max(-1, Math.min(1, pan)) * 63), strip });
  }

  liveCc(cc: number, value: number, to: Target | number): void {
    const { ch, strip } = target(to);
    this.engine?.now({ kind: "cc", ch, cc, value, strip });
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
  audition(pitch: number, velocity: number, to: Target | number, ms = 350): void {
    if (!this.engine) return;
    const { ch, strip } = target(to);
    this.engine.now({ kind: "on", ch, note: pitch, vel: velocity, strip });
    setTimeout(() => this.engine?.now({ kind: "off", ch, note: pitch, strip }), ms);
  }
}

/** A bare number: a channel that is also its strip (as before A2). */
function target(to: Target | number): Target {
  return typeof to === "number" ? { ch: to, strip: to } : to;
}
