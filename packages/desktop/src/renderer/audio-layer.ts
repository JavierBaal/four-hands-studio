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
import type { SoundBankInfo } from "../shared/protocol.js";
import { activeTrack } from "./context.js";
import { barRange } from "./music.js";
import type { Replica } from "./replica.js";

export type SoundStatus = "loading" | "ready" | "none" | "error";

/** A bank a track uses: being loaded, playing, not installed on this computer, or failed. */
export type BankStatus = "loading" | "ready" | "missing" | "error";

interface Take {
  trackId: string;
  open: Map<number, { start: number; velocity: number }>;
  notes: { pitch: number; start: number; duration: number; velocity: number }[];
  pedalDown: number | null;
  pedal: PedalSpan[];
  from: number;
}

function loadGuide(): boolean {
  try {
    return localStorage.getItem("fh.keyGuide") !== "0";
  } catch {
    return true;
  }
}

export class AudioLayer {
  readonly player: Player;
  status: SoundStatus = "loading";
  /** Worklet health while playing: notes that reached the audio thread late, and its worst load. */
  stats = { lateEvents: 0, maxLoad: 0, seconds: 0 };
  pianoMode = false;
  /** The on-screen guide of the computer keyboard while it plays notes (ESPEC_PIANO_ROLL.md, 8.2). */
  keyGuide = loadGuide();
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
  private engine: Engine | null = null;
  /** Sound banks the user installed (refreshed when the sounds folder changes). */
  banks: SoundBankInfo[] = [];
  private bankStates = new Map<string, BankStatus>();

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
        return tr ? `${tr.channel}:${tr.program}:${tr.volume}:${tr.pan}:${tr.sound ? `${tr.sound.bank}/${tr.sound.bankMSB}/${tr.sound.program}` : ""}` : "";
      }).join("|");
      if (sig !== this.trackSignature) {
        this.trackSignature = sig;
        this.player.setup();
        this.ensureBanks();
      }
    });
    // A track with a sound from another bank plays it once the bank is loaded; until then, and if
    // the bank is not on this computer, it plays its General MIDI program from the default bank.
    this.player.soundFor = (track) => {
      if (!track.sound || !this.engine) return null;
      const offset = this.engine.bankOffset(track.sound.bank);
      return offset === undefined ? null : { bank: offset + track.sound.bankMSB, prog: track.sound.program };
    };
    void this.refreshBanks();
    this.bridge.onSoundsChanged(() => void this.refreshBanks());
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
      this.engine = engine;
      this.player.setEngine(engine);
      this.ensureBanks();
      this.status = "ready";
      this.bridge.log({ type: "sound_ready", ...info, baseLatencyMs: engine.baseLatencyMs, outputLatencyMs: engine.outputLatencyMs });
    } catch (error) {
      this.status = "error";
      this.bridge.log({ type: "sound_failed", error: String(error) });
    }
    this.changed();
    void this.attachMidi();
  }

  // -------------------------------------------------------------------------
  // Sound banks the user installed

  async refreshBanks(): Promise<void> {
    try {
      this.banks = await this.bridge.sounds();
    } catch {
      this.banks = [];
    }
    for (const [id, state] of this.bankStates) if (state === "missing" || state === "error") this.bankStates.delete(id);
    this.changed();
    this.ensureBanks();
  }

  openSoundsFolder(): void {
    this.bridge.openSoundsFolder();
  }

  importSounds(files: File[]): Promise<string[]> {
    return this.bridge.importSounds(files);
  }

  openLink(url: string): void {
    this.bridge.openLink(url);
  }

  bankStatus(id: string): BankStatus | null {
    return this.bankStates.get(id) ?? null;
  }

  bank(id: string): SoundBankInfo | undefined {
    return this.banks.find((b) => b.id === id);
  }

  /** Loads the banks the song's tracks use and are not loaded yet. */
  private ensureBanks(): void {
    const engine = this.engine;
    if (!engine) return;
    const wanted = new Set<string>();
    for (const id of this.replica.song.trackOrder) {
      const s = this.replica.song.tracks[id]?.sound;
      if (s) wanted.add(s.bank);
    }
    for (const id of wanted) {
      if (this.bankStates.has(id)) continue;
      if (!this.bank(id)) {
        this.bankStates.set(id, "missing");
        this.changed();
        continue;
      }
      this.bankStates.set(id, "loading");
      this.changed();
      const t0 = performance.now();
      engine
        .addBank(id, () => this.bridge.soundBank(id))
        .then(() => {
          this.bankStates.set(id, "ready");
          this.bridge.log({ type: "bank_loaded", bank: id, ms: Math.round(performance.now() - t0) });
          this.player.setup();
        })
        .catch((error: unknown) => {
          this.bankStates.set(id, "error");
          this.bridge.log({ type: "bank_failed", bank: id, error: String(error) });
        })
        .finally(() => this.changed());
    }
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

  /** Back to the start of the song; if it was playing, it goes on playing from there. */
  toStart(): void {
    if (this.take) return; // a take keeps its place
    const playing = this.player.playing;
    if (playing) this.player.stop();
    void this.replica.setContext({ cursor: 0 });
    if (playing) this.player.play(0);
    this.onToStart();
  }

  /** The window brings the start into view (set by App). */
  onToStart: () => void = () => {};

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

  toggleGuide(): void {
    this.keyGuide = !this.keyGuide;
    try {
      localStorage.setItem("fh.keyGuide", this.keyGuide ? "1" : "0");
    } catch {
      /* no storage: the choice lasts this session */
    }
    this.changed();
  }

  /** Physical keys held down right now (the guide lights them). */
  heldKeys(): ReadonlySet<string> {
    return new Set(this.held.keys());
  }

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
      if (this.keyGuide) this.changed();
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
    if (this.keyGuide) this.changed();
    return true;
  }

  releaseAll(): void {
    for (const note of this.held.values()) this.player.liveOff(note);
    const had = this.held.size > 0;
    this.held.clear();
    if (had && this.keyGuide) this.changed();
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
