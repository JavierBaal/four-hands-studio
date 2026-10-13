/**
 * Sound in the window: SoundFont, transport, the computer keyboard as a piano (ESPEC_PIANO_ROLL.md,
 * 8.2), Web MIDI input and recording (ESPEC, 8). Recording is a take: everything played goes in
 * as one command at the end, so the whole take undoes in one step, and it is never quantized.
 */
import { type Note, type PedalSpan, PPQ, barAt, barStart, orderedSections } from "@fourhands/core";
import type { Strings, Translate } from "../shared/i18n.js";
import { Engine } from "../audio/engine.js";
import { INITIAL_KEYBOARD, type KeyboardState, keyAction } from "../audio/keyboard.js";
import { Player } from "../audio/player.js";
import type { Bridge } from "./bridge.js";
import { activeTrack } from "./context.js";
import { barRange } from "./music.js";
import type { Replica } from "./replica.js";

export type SoundStatus = "loading" | "ready" | "none" | "error";

interface Take {
  trackId: string;
  open: Map<number, { start: number; velocity: number }>;
  notes: { pitch: number; start: number; duration: number; velocity: number }[];
  pedalDown: number | null;
  pedal: PedalSpan[];
  from: number;
}

export class AudioLayer {
  readonly player: Player;
  status: SoundStatus = "loading";
  /** Worklet health while playing: notes that reached the audio thread late, and its worst load. */
  stats = { lateEvents: 0, maxLoad: 0, seconds: 0 };
  pianoMode = false;
  keyboard: KeyboardState = { ...INITIAL_KEYBOARD };
  countInBars = 1;
  take: Take | null = null;
  version = 0;
  /** Shows the take as it is being played (the Editor's draft layer). */
  onDraft: (notes: Note[]) => void = () => {};
  private listeners = new Set<() => void>();
  private held = new Map<string, number>();
  private draftTimer: ReturnType<typeof setInterval> | null = null;
  private trackSignature = "";

  constructor(
    private readonly replica: Replica,
    private readonly bridge: Bridge,
    private readonly t: Translate,
  ) {
    this.player = new Player(() => this.replica.song);
    this.player.subscribe(() => this.changed());
    this.player.onLive = (kind, n) => this.recordLive(kind, n.pitch, n.velocity, n.tick);
    this.player.onLiveCc = (cc, value, tick) => this.recordCc(cc, value, tick);
    this.player.onStop = () => {
      this.finishTake();
      if (this.status === "ready") this.bridge.log({ type: "playback_stats", ...this.stats });
    };
    // Resend programs, volume and pan when a track changes.
    this.replica.subscribe(() => {
      const sig = this.replica.song.trackOrder.map((id) => {
        const tr = this.replica.song.tracks[id];
        return tr ? `${tr.channel}:${tr.program}:${tr.volume}:${tr.pan}` : "";
      }).join("|");
      if (sig !== this.trackSignature) {
        this.trackSignature = sig;
        this.player.setup();
      }
    });
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

  async init(): Promise<void> {
    try {
      const sf = await this.bridge.soundFont();
      if (!sf) {
        this.status = "none";
        this.changed();
        return;
      }
      const engine = new Engine();
      engine.onStats = (st) => {
        this.stats.lateEvents += st.lateEvents;
        this.stats.maxLoad = Math.max(this.stats.maxLoad, st.maxLoad);
        this.stats.seconds++;
      };
      const info = await engine.init(sf, "worklet.js", false);
      this.player.setEngine(engine);
      this.status = "ready";
      this.bridge.log({ type: "sound_ready", ...info, baseLatencyMs: engine.baseLatencyMs, outputLatencyMs: engine.outputLatencyMs });
    } catch (error) {
      this.status = "error";
      this.bridge.log({ type: "sound_failed", error: String(error) });
    }
    this.changed();
    void this.attachMidi();
  }

  private channel(): number {
    return activeTrack(this.replica.song)?.channel ?? 0;
  }

  // -------------------------------------------------------------------------
  // Transport

  playStop(): void {
    if (this.player.playing) this.stop();
    else this.player.play(this.replica.song.context.cursor);
  }

  stop(): void {
    this.player.stop();
  }

  /**
   * The loop button: on while there is a loop region. Off removes the region. On without a region
   * creates one: the selection's bars, or the section under the cursor, or four bars from the cursor.
   */
  toggleLoop(): void {
    const song = this.replica.song;
    if (song.context.loop) {
      void this.replica.setContext({ loop: null });
      return;
    }
    const meter = song.meter;
    const selected = song.context.selection.map((id) => song.notes[id]).filter((n) => n !== undefined);
    let startBar: number;
    let endBar: number;
    if (selected.length > 0) {
      startBar = barAt(meter, Math.min(...selected.map((n) => n.start)));
      endBar = barAt(meter, Math.max(...selected.map((n) => n.start + n.duration)) - 1);
    } else {
      const bar = barAt(meter, song.context.cursor);
      const section = orderedSections(song).find((sec) => sec.startBar <= bar && sec.endBar >= bar);
      startBar = section?.startBar ?? bar;
      endBar = section?.endBar ?? bar + 3;
    }
    void this.replica.setContext({ loop: { start: barStart(meter, startBar), end: barStart(meter, endBar + 1) } });
  }

  toggleMetronome(): void {
    this.player.metronome = !this.player.metronome;
    this.changed();
  }

  /** R: start recording on the active track after the count-in, or stop and keep the take. */
  toggleRecord(): void {
    if (this.take) {
      this.stop();
      return;
    }
    const track = activeTrack(this.replica.song);
    if (!track) return;
    if (this.player.playing) this.player.stop();
    const from = this.replica.song.context.cursor;
    this.take = { trackId: track.id, open: new Map(), notes: [], pedalDown: null, pedal: [], from };
    this.player.play(from, { countIn: this.countInBars, metronome: true, noLoop: true });
    this.draftTimer = setInterval(() => this.showDraft(), 100);
    this.changed();
  }

  // -------------------------------------------------------------------------
  // The take

  private recordLive(kind: "on" | "off", pitch: number, velocity: number, tick: number | null): void {
    const take = this.take;
    if (!take || tick === null) return;
    if (kind === "on") {
      take.open.set(pitch, { start: tick, velocity });
    } else {
      const open = take.open.get(pitch);
      if (!open) return;
      take.open.delete(pitch);
      take.notes.push({ pitch, start: open.start, duration: Math.max(1, tick - open.start), velocity: open.velocity });
    }
    this.showDraft();
  }

  private recordCc(cc: number, value: number, tick: number | null): void {
    const take = this.take;
    if (!take || tick === null || cc !== 64) return;
    if (value >= 64 && take.pedalDown === null) take.pedalDown = tick;
    else if (value < 64 && take.pedalDown !== null) {
      if (tick > take.pedalDown) take.pedal.push({ start: take.pedalDown, end: tick });
      take.pedalDown = null;
    }
  }

  private showDraft(): void {
    const take = this.take;
    if (!take) return;
    const now = this.player.position() ?? take.from;
    const open = [...take.open].map(([pitch, o]) => ({ pitch, start: o.start, duration: Math.max(1, now - o.start), velocity: o.velocity }));
    this.onDraft(
      [...take.notes, ...open].map((n, i) => ({ ...n, id: `rec${i}`, trackId: take.trackId, createdBy: { by: "user" }, shapedBy: { by: "user" } })),
    );
  }

  /** Called when the transport stops: closes held notes and sends the take as one command. */
  private finishTake(): void {
    const take = this.take;
    this.take = null;
    if (this.draftTimer) clearInterval(this.draftTimer);
    this.draftTimer = null;
    this.player.metronome = false;
    this.onDraft([]);
    if (!take) return;
    const end = Math.max(take.from, ...take.notes.map((n) => n.start + n.duration), ...[...take.open.values()].map((o) => o.start + PPQ / 4));
    for (const [pitch, o] of take.open) take.notes.push({ pitch, start: o.start, duration: Math.max(1, end - o.start), velocity: o.velocity });
    if (take.pedalDown !== null && end > take.pedalDown) take.pedal.push({ start: take.pedalDown, end });
    const notes = take.notes.filter((n) => n.start >= 0).sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    this.changed();
    if (notes.length === 0) return;
    const track = this.replica.song.tracks[take.trackId];
    const first = Math.min(...notes.map((n) => n.start));
    const last = Math.max(...notes.map((n) => n.start + n.duration));
    const key = (notes.length === 1 ? "hRecordOne" : "hRecordMany") as keyof Strings;
    const label = this.t(key, { n: notes.length, track: track?.name ?? "", bars: barRange(this.replica.song.meter, first, last) });
    const commands: Parameters<Replica["run"]>[1] = [{ type: "addNotes", trackId: take.trackId, notes }];
    if (take.pedal.length && track) {
      // Recorded pedal replaces the old pedal inside the recorded stretch.
      const kept = track.pedal.filter((p) => p.end <= first || p.start >= last);
      commands.push({ type: "setPedal", trackId: take.trackId, spans: [...kept, ...take.pedal] });
    }
    void this.replica.run(label, commands).then((r) => {
      if (r.ok) void this.replica.setContext({ selection: r.results[0] as string[] });
    });
  }

  // -------------------------------------------------------------------------
  // Playing: the computer keyboard as a piano, MIDI input, auditioning

  togglePiano(): void {
    this.pianoMode = !this.pianoMode;
    if (!this.pianoMode) this.releaseAll();
    this.changed();
  }

  /** Returns true when the key was a piano key (and must not reach the shortcuts). */
  keyDown(e: KeyboardEvent): boolean {
    if (!this.pianoMode || e.repeat) return this.pianoMode && !!keyAction(e.code, this.keyboard, { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey });
    const action = keyAction(e.code, this.keyboard, { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey });
    if (!action) return false;
    if (action.type === "note") {
      if (action.note > 127 || this.held.has(e.code)) return true;
      this.held.set(e.code, action.note);
      this.player.liveOn(action.note, this.keyboard.velocity, this.channel(), e.timeStamp, "keyboard");
    } else {
      this.releaseAll();
      this.keyboard = action.state;
      this.changed();
    }
    return true;
  }

  keyUp(e: KeyboardEvent): boolean {
    const note = this.held.get(e.code);
    if (note === undefined) return false;
    this.held.delete(e.code);
    this.player.liveOff(note);
    return true;
  }

  releaseAll(): void {
    for (const note of this.held.values()) this.player.liveOff(note);
    this.held.clear();
  }

  private async attachMidi(): Promise<void> {
    if (!("requestMIDIAccess" in navigator)) return;
    try {
      const access = await navigator.requestMIDIAccess();
      const listen = () => {
        for (const input of access.inputs.values()) {
          input.onmidimessage = (m) => {
            const [status = 0, a = 0, b = 0] = m.data ?? [];
            const kind = status & 0xf0;
            if (kind === 0x90 && b > 0) this.player.liveOn(a, b, this.channel(), m.timeStamp, "midi");
            else if (kind === 0x80 || (kind === 0x90 && b === 0)) this.player.liveOff(a);
            else if (kind === 0xb0) this.player.liveCc(a, b, this.channel());
          };
        }
      };
      listen();
      access.onstatechange = listen;
    } catch (error) {
      this.bridge.log({ type: "midi_unavailable", error: String(error) });
    }
  }

  audition(pitch: number, velocity: number): void {
    this.player.audition(pitch, velocity, this.channel());
  }
}
