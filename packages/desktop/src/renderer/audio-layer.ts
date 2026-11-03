/**
 * Sound in the window: SoundFont, transport, the computer keyboard as a piano (ESPEC_PIANO_ROLL.md,
 * 8.2), Web MIDI input and recording (ESPEC, 8). Recording is a take: everything played goes in
 * as one command at the end, so the whole take undoes in one step, and it is never quantized.
 */
import { currentProposal, songWithProposal } from "./proposals.js";
import { type Note, type PedalSpan, type Song, PPQ, barAt, barStart, orderedSections } from "@fourhands/core";
import type { Lang, Strings, Translate } from "../shared/i18n.js";
import { Engine } from "../audio/engine.js";
import { INITIAL_KEYBOARD, type KeyboardState, keyAction } from "../audio/keyboard.js";
import { Player } from "../audio/player.js";
import { type EnginePort, type MidiPort, SoundRouter, isOwnLoopback } from "../audio/router.js";
import { NO_SOUND_PREFS, type SoundItem, type SoundPrefs, buildCatalog, withRecent } from "../shared/sound-catalog.js";
import { ENGINE_OFF, type EnginePluginList, type EngineScanProgress, type EngineStatus } from "../shared/engine.js";
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
  /**
   * Con / Sin (H4): "without" plays the song as it was before the last AI intervention, to hear
   * what it changed. Only what sounds changes: the window keeps showing the song as it is.
   */
  compare: "with" | "without" = "with";
  private before: { revision: number; song: Song } | null = null;
  /**
   * Proposal mode (H4): hear the pending proposal ("with", the default when one arrives) or the song
   * as it is ("without"). The proposal is not in the song until the user accepts it.
   */
  proposalListen: "with" | "without" = "with";
  private proposalSeen: string | null = null;
  /**
   * MIDI out (H4): tracks set to "Studio One" send their MIDI through this port instead of
   * sounding here. `outPorts` lists what the system offers; `outName` is the user's choice.
   */
  outPorts: string[] = [];
  outName: string | null = null;
  private midiAccess: MIDIAccess | null = null;
  private router: SoundRouter | null = null;
  private outSides = new Map<string, string>();
  /**
   * The native engine (fase 2, prueba S2): its state, which plugin each slot has, and the last
   * plugin that could not load (with why). A plugin that failed is not tried again on its own.
   */
  engineStatus: EngineStatus = { ...ENGINE_OFF };
  private engineLoaded = new Map<number, string>();
  private engineLoading = new Set<string>();
  private engineRefused = new Set<string>();
  pluginProblem: { name: string; error: string } | null = null;
  /** Ajustes › Plugins: what the engine knows, and the scan under way (it goes on with the card closed). */
  pluginList: EnginePluginList | null = null;
  pluginScan: EngineScanProgress | null = null;
  /** The Sonidos browser's marks: favourites, recents, hidden plugins, moved categories. */
  soundPrefs: SoundPrefs = { ...NO_SOUND_PREFS };
  /**
   * F2.1 (Fran, 01/11/2026): the built-in sounds play in the engine once its banks are there (the
   * same banks, at the same bank select offsets as the window's synth). Until then, and if the
   * engine is not built or stops, they play here as before. `builtinWhere` comes from
   * ajustes.json (`builtinSounds`); the banks loaded are kept per engine generation.
   */
  builtinWhere: "engine" | "app" = "app";
  private engineBanks = new Map<string, number>();
  private engineBanksLoading = new Set<string>();
  private engineBanksRefused = new Map<string, number>();
  /** Listens to the MIDI inputs again (the output port changed: skip its loopback). */
  private relisten: () => void = () => {};

  constructor(
    private readonly replica: Replica,
    private readonly bridge: Bridge,
    private readonly t: Translate,
  ) {
    this.player = new Player(() => this.heard());
    this.player.subscribe(() => this.changed());
    this.player.onLive = (kind, n) => this.recordLive(kind, n.pitch, n.velocity, n.tick);
    this.player.onLiveCc = (cc, value, tick) => this.recordCc(cc, value, tick);
    this.player.onStop = () => {
      this.finishTake();
      if (this.status === "ready") this.bridge.log({ type: "playback_stats", ...this.stats });
    };
    // Resend programs, volume, pan and reverb when a track changes.
    this.replica.subscribe(() => {
      // Anything new on top of the AI's step: back to the song as it is.
      const last = this.replica.undo.lastAi;
      if (this.before && last?.revision !== this.before.revision) this.resetCompare();
      // A new proposal is heard at once; when it goes, the song plays as it is.
      const p = currentProposal(this.replica.undo.proposals);
      if ((p?.id ?? null) !== this.proposalSeen) {
        this.proposalSeen = p?.id ?? null;
        this.proposalListen = "with";
        this.player.setup();
        this.changed();
      }
      const sig = this.replica.song.trackOrder.map((id) => {
        const tr = this.replica.song.tracks[id];
        return tr ? `${tr.output ?? ""}:${tr.channel}:${tr.program}:${tr.volume}:${tr.pan}:${tr.reverb ?? 0}:${tr.sound ? `${tr.sound.bank}/${tr.sound.bankMSB}/${tr.sound.program}` : ""}` : "";
      }).join("|");
      if (sig !== this.trackSignature) {
        this.trackSignature = sig;
        this.player.setup();
        this.ensureBanks();
      }
      this.ensurePlugins();
      // A track that changed sides stops sounding on the side it left.
      for (const id of this.replica.song.trackOrder) {
        const tr = this.replica.song.tracks[id]!;
        const out = tr.output ?? "internal";
        if (this.outSides.has(id) && this.outSides.get(id) !== out) this.router?.silence(tr.channel);
        this.outSides.set(id, out);
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
    void this.bridge.engineStatus().then((s) => this.engineChanged(s));
    this.bridge.onEngineStatus((s) => this.engineChanged(s));
    // Another song: its plugins load again, each with what it had loaded in that song (F2.1).
    this.bridge.onReload(() => {
      this.engineLoaded.clear();
      this.engineRefused.clear();
    });
    void this.bridge.soundPrefs().then((p) => {
      this.soundPrefs = p;
      this.changed();
    });
    this.bridge.onEngineScanning((p) => {
      this.pluginScan = p;
      this.changed();
    });
  }

  /** Changes the browser's marks and keeps them (ajustes.json). */
  updateSoundPrefs(change: (p: SoundPrefs) => SoundPrefs): void {
    this.soundPrefs = change(this.soundPrefs);
    this.changed();
    void this.bridge.setSoundPrefs(this.soundPrefs);
  }

  /** Every sound a track can have, as the Sonidos browser lists it (also to resolve a dragged key). */
  soundCatalog(lang: Lang, builtInLabel: string): SoundItem[] {
    return buildCatalog({ lang, banks: this.banks, plugins: this.pluginList?.plugins ?? [], prefs: this.soundPrefs, builtInLabel });
  }

  rememberSound(key: string): void {
    this.updateSoundPrefs((p) => withRecent(p, key));
  }

  /** The plugins the engine knows; with `scan`, it looks for them first (minutes, the first time). */
  async loadPlugins(scan = false): Promise<void> {
    if (this.pluginScan) return;
    if (scan) {
      this.pluginScan = { file: "", progress: 0 };
      this.bridge.log({ type: "engine_scan_asked" });
      this.changed();
    }
    try {
      this.pluginList = await this.bridge.enginePlugins(scan);
    } finally {
      this.pluginScan = null;
      this.changed();
    }
  }

  // -------------------------------------------------------------------------
  // The native engine (fase 2, prueba S2): tracks that sound through a plugin

  private engineChanged(status: EngineStatus): void {
    // A new engine (it started, or started again after a crash) has no plugins yet.
    if (status.generation !== this.engineStatus.generation || status.state !== "ready") this.engineLoaded.clear();
    const hadSounds = this.soundsInEngine();
    const was = this.engineStatus.state;
    this.engineStatus = status;
    // Its sounds went with it: the window plays them again, with the song's programs.
    if (hadSounds && !this.soundsInEngine()) {
      this.bridge.log({ type: "builtin_sounds", where: "app", reason: status.state });
      this.player.setup();
    }
    if (status.state === "ready") {
      this.ensurePlugins();
      this.ensureEngineSounds();
    }
    // It stopped by itself (a plugin crashed it): start it again with the plugins of the song.
    if (status.state === "failed" && was === "ready") {
      this.bridge.log({ type: "engine_restart", error: status.error });
      setTimeout(() => this.ensurePlugins(), 1000);
    }
    this.changed();
  }

  /** Channels of the tracks that sound through a plugin. */
  pluginChannels(): Set<number> {
    const out = new Set<number>();
    for (const id of this.replica.song.trackOrder) {
      const t = this.replica.song.tracks[id];
      if (t?.output === "plugin") out.add(t.channel);
    }
    return out;
  }

  /** F2.1: the engine has the built-in bank of its current run. */
  soundsInEngine(): boolean {
    return this.builtinWhere === "engine" && this.engineStatus.state === "ready" && this.engineBanks.get("main@0") === this.engineStatus.generation;
  }

  private builtinPort(): EnginePort | null {
    return this.soundsInEngine() ? this.enginePort() : null;
  }

  /**
   * F2.1: the engine gets the built-in bank and every bank the window's synth has loaded, at the
   * same offset. Asking starts the engine; a bank that fails is not asked again in that run.
   */
  private ensureEngineSounds(): void {
    if (this.builtinWhere !== "engine" || !this.engine) return;
    if (this.engineStatus.state === "missing" || this.engineStatus.state === "starting") return;
    const wanted: Array<[string, number]> = [["main", 0]];
    for (const b of this.banks) {
      const offset = this.engine.bankOffset(b.id);
      if (offset !== undefined) wanted.push([b.id, offset]);
    }
    for (const [id, offset] of wanted) {
      const key = `${id}@${offset}`;
      const generation = this.engineStatus.generation;
      if (this.engineBanks.get(key) === generation || this.engineBanksLoading.has(key) || this.engineBanksRefused.get(key) === generation) continue;
      // The user's banks wait for the built-in one: it decides whether the engine plays at all.
      if (id !== "main" && this.engineBanks.get("main@0") !== generation) continue;
      this.engineBanksLoading.add(key);
      void this.bridge.engineSounds(id, offset).then((r) => {
        this.engineBanksLoading.delete(key);
        const now = this.engineStatus.generation;
        if (!r.ok) {
          // Refused for the run that was asked; a new engine (after a crash) is asked again.
          this.engineBanksRefused.set(key, generation);
          if (now !== generation) this.ensureEngineSounds();
          if (id === "main") this.bridge.log({ type: "builtin_sounds", where: "app", reason: r.error ?? "failed" });
          this.changed();
          return;
        }
        const before = this.soundsInEngine();
        this.engineBanks.set(key, now);
        if (!before && this.soundsInEngine()) {
          // From here the engine plays them: the window's synth goes quiet and the engine gets the programs.
          this.router?.innerPanic();
          this.bridge.log({ type: "builtin_sounds", where: "engine", presets: r.presets, ms: r.ms });
        }
        this.player.setup();
        this.ensureEngineSounds();
        this.changed();
      });
    }
  }

  private enginePort(): EnginePort | null {
    if (this.engineStatus.state !== "ready") return null;
    return { midi: (events) => this.bridge.engineMidi(events), panic: () => this.bridge.enginePanic(), latency: () => this.engineStatus.latency ?? 0 };
  }

  /** Each plugin track has its plugin loaded in its slot (the slot is the track's channel). */
  private ensurePlugins(): void {
    if (this.engineStatus.state === "missing" || this.engineStatus.state === "starting") return;
    for (const id of this.replica.song.trackOrder) {
      const track = this.replica.song.tracks[id];
      if (track?.output !== "plugin" || !track.plugin) continue;
      const slot = track.channel;
      const plugin = track.plugin;
      const key = `${slot}:${plugin.id}`;
      if (this.engineLoaded.get(slot) === plugin.id || this.engineLoading.has(key) || this.engineRefused.has(key)) continue;
      this.engineLoading.add(key);
      const generation = this.engineStatus.generation;
      void this.bridge.engineLoad(slot, plugin.id, id).then((r) => {
        this.engineLoading.delete(key);
        if (r.ok) {
          this.engineLoaded.set(slot, plugin.id);
          if (this.pluginProblem?.name === plugin.name) this.pluginProblem = null;
        } else if (this.engineStatus.state === "ready" && this.engineStatus.generation === generation && !/link with the engine closed|engine stopped|not running/i.test(r.error)) {
          // The plugin itself failed: not again on its own (the user can choose it again).
          this.engineRefused.add(key);
          this.pluginProblem = { name: plugin.name, error: r.error };
        }
        // Otherwise the engine went down meanwhile (03/11/2026): the new one loads it again (the
        // new engine may already be up, and it skipped this plugin while it was loading here).
        else setTimeout(() => this.ensurePlugins(), 500);
        this.player.setup();
        this.changed();
      });
    }
  }

  /** The user chose this plugin for a slot: try it again even if it failed before. */
  retryPlugin(slot: number, pluginId: string): void {
    this.engineRefused.delete(`${slot}:${pluginId}`);
    this.pluginProblem = null;
  }

  /** "Abrir ventana del instrumento": the plugin's own window, from the engine. */
  async showPlugin(slot: number): Promise<boolean> {
    const ok = await this.bridge.engineShow(slot);
    this.bridge.log({ type: "engine_window", slot, ok });
    return ok;
  }

  /** Is the plugin of this track loaded and ready to sound? */
  pluginReady(slot: number, pluginId: string): boolean {
    return this.engineStatus.state === "ready" && this.engineLoaded.get(slot) === pluginId;
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

  /** What plays: the song, or the song without the last AI intervention (with the current loop and cursor). */
  private heard(): Song {
    const song = this.replica.song;
    const p = currentProposal(this.replica.undo.proposals);
    if (p && !p.stale && this.proposalListen === "with") {
      const withIt = songWithProposal(song, p);
      if (withIt) return { ...withIt, context: song.context };
    }
    return this.compare === "without" && this.before ? { ...this.before.song, context: song.context } : song;
  }

  /** The proposal bar's Con / Sin (and B while it shows). */
  setProposalListen(mode: "with" | "without"): void {
    if (mode === this.proposalListen) return;
    this.proposalListen = mode;
    this.player.setup();
    this.bridge.log({ type: "compare_proposal", mode });
    this.changed();
  }

  /** B, or the Con / Sin buttons: hear the song with or without the last AI intervention. */
  async setCompare(mode: "with" | "without"): Promise<void> {
    if (mode === this.compare) return;
    if (mode === "with") {
      this.resetCompare();
      return;
    }
    const last = this.replica.undo.lastAi;
    if (!last || this.take) return;
    if (this.before?.revision !== last.revision) {
      const song = await this.bridge.songBefore();
      if (!song || this.replica.undo.lastAi?.revision !== last.revision) return;
      this.before = { revision: last.revision, song };
    }
    this.compare = "without";
    this.player.setup(); // the AI may have changed sounds or the mix
    this.bridge.log({ type: "compare", mode: "without", revision: last.revision });
    this.changed();
  }

  toggleCompare(): void {
    const p = currentProposal(this.replica.undo.proposals);
    if (p && !p.stale) return this.setProposalListen(this.proposalListen === "with" ? "without" : "with");
    void this.setCompare(this.compare === "with" ? "without" : "with");
  }

  private resetCompare(): void {
    const was = this.compare;
    this.compare = "with";
    this.before = null;
    if (was === "without") {
      this.player.setup();
      this.changed();
    }
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
      this.router = new SoundRouter({
        inner: engine,
        external: () => this.externalChannels(),
        port: () => this.outPort(),
        delayMs: () => engine.outputLatencyMs,
        plugin: () => this.pluginChannels(),
        engine: () => this.enginePort(),
        builtin: () => this.builtinPort(),
      });
      this.player.setEngine(this.router);
      this.ensureBanks();
      this.builtinWhere = await this.bridge.builtinSounds();
      this.ensureEngineSounds();
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
          this.ensureEngineSounds();
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
    this.resetCompare(); // a take goes into the song as it is, so it is heard as it is
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

  // -------------------------------------------------------------------------
  // MIDI out (H4): to Studio One through a virtual port (loopMIDI on Windows)

  /** Channels of the tracks that sound in the other program. */
  externalChannels(): Set<number> {
    const out = new Set<number>();
    for (const id of this.replica.song.trackOrder) {
      const t = this.replica.song.tracks[id];
      if (t?.output === "external") out.add(t.channel);
    }
    return out;
  }

  /** The chosen port, if the system has it now. */
  private outPort(): MidiPort | null {
    if (!this.midiAccess || !this.outName) return null;
    for (const o of this.midiAccess.outputs.values()) if (o.name === this.outName) return o as unknown as MidiPort;
    return null;
  }

  /** "ready": sending; "none": no port chosen; "missing": the chosen one is not there (loopMIDI closed?). */
  get outStatus(): "ready" | "none" | "missing" {
    if (!this.outName) return "none";
    return this.outPort() ? "ready" : "missing";
  }

  async chooseOutPort(name: string | null): Promise<void> {
    this.player.stop();
    this.outName = await this.bridge.setMidiOutPort(name);
    this.relisten();
    this.bridge.log({ type: "midi_out_port", name: this.outName, found: this.outStatus === "ready" });
    this.changed();
  }

  private refreshOutPorts(): void {
    this.outPorts = this.midiAccess ? [...this.midiAccess.outputs.values()].map((o) => o.name ?? "").filter(Boolean) : [];
    this.changed();
  }

  private async attachMidi(): Promise<void> {
    this.outName = await this.bridge.midiOutPort().catch(() => null);
    if (!("requestMIDIAccess" in navigator)) return;
    try {
      const access = await navigator.requestMIDIAccess();
      this.midiAccess = access;
      this.refreshOutPorts();
      const listen = () => {
        for (const input of access.inputs.values()) {
          // Never our own output coming back (loopMIDI): it would feed itself.
          if (isOwnLoopback(input.name, this.outName)) {
            input.onmidimessage = null;
            continue;
          }
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
      this.relisten = listen;
      access.onstatechange = () => {
        listen();
        this.refreshOutPorts();
      };
    } catch (error) {
      this.bridge.log({ type: "midi_unavailable", error: String(error) });
    }
  }

  /** A fader moving: hear it now; the song gets the value on release. */
  previewMix(trackId: string, volume: number, pan: number, reverb?: number): void {
    const track = this.replica.song.tracks[trackId];
    if (track) this.player.previewMix(track.channel, volume, pan, reverb);
  }

  audition(pitch: number, velocity: number): void {
    this.player.audition(pitch, velocity, this.channel());
  }
}
