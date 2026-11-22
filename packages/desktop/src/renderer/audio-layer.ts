/**
 * Sound in the window: SoundFont, transport, the computer keyboard as a piano (docs/piano-roll.md,
 * 8.2), Web MIDI input and recording (ESPEC, 8). Recording is a take: everything played goes in
 * as one command at the end, so the whole take undoes in one step, and it is never quantized.
 */
import { currentProposal, songWithProposal } from "./proposals.js";
import { type Note, OWN_EFFECTS, type PedalSpan, type Song, type Track, PPQ, allInserts, audible, barAt, barStart, busList, orderedSections, reverbLevel } from "@fourhands/core";
import type { Lang, Strings, Translate } from "../shared/i18n.js";
import { Engine } from "../audio/engine.js";
import { INITIAL_KEYBOARD, type KeyboardState, keyAction } from "../audio/keyboard.js";
import { HIDDEN_LOOKAHEAD, Player, type Target } from "../audio/player.js";
import { type EnginePort, type MidiPort, SoundRouter, isOwnLoopback } from "../audio/router.js";
import { type EngineCost, type EngineLevels, type EngineLoad, addCost, costReport, busChainKey, engineBuses, engineChain, engineRouting, engineStrips, levelsReport, masterGain } from "../shared/mix.js";
import { BusMap, METRONOME_KEY, StripMap } from "../shared/strips.js";
import type { LibraryCard, LibraryCatalog } from "../shared/library-cards.js";
import { type EffectItem, NO_SOUND_PREFS, type SoundItem, type SoundPrefs, buildCatalog, buildEffectCatalog, withRecent } from "../shared/sound-catalog.js";
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
  /** The on-screen guide of the computer keyboard while it plays notes (docs/piano-roll.md, 8.2). */
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
  private mixSignature = "";
  /**
   * F2.2 part B: the engine's load for «Carga» (read every second while the engine runs), and when
   * the audio was last cut (the indicator says so for a while).
   */
  engineLoad: EngineLoad | null = null;
  /** What the engine spent on this playback, per track (09/11/2026; logged at the stop). */
  private playCost: EngineCost | null = null;
  lastDropoutAt = 0;
  private loadTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * F2.2 part C: the chain last sent for each strip (-1: the Master), and the effects that failed to
   * load (id → why), for the console.
   */
  private chainsSent = new Map<number, string>();
  private insertsGeneration = -1;
  /** The AI's plugin parameters last applied, with the value each had before (to undo them). */
  private pluginParamsSent = new Map<string, { params: Record<string, number>; base: Record<string, number> }>();
  insertProblems = new Map<string, string>();
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
   * The native engine (phase 2, test S2): its state, which plugin each slot has, and the last
   * plugin that could not load (with why). A plugin that failed is not tried again on its own.
   */
  engineStatus: EngineStatus = { ...ENGINE_OFF };
  private engineLoaded = new Map<number, string>();
  /**
   * A2 (03/11/2026): each track's strip in the engine (shared/strips.ts), and strips to put back to
   * neutral at the next mix (their track went).
   */
  private strips = new StripMap();
  /** F2.2 part D: each bus's place in the engine, and the routing last sent (with its engine run). */
  private buses = new BusMap();
  private routingSent = "";
  private stripReset: number[] = [];
  private engineLoading = new Set<string>();
  private engineRefused = new Set<string>();
  pluginProblem: { name: string; error: string } | null = null;
  /** Ajustes › Plugins: what the engine knows, and the scan under way (it goes on with the card closed). */
  pluginList: EnginePluginList | null = null;
  pluginScan: EngineScanProgress | null = null;
  /** The Sonidos browser's marks: favourites, recents, hidden plugins, moved categories. */
  soundPrefs: SoundPrefs = { ...NO_SOUND_PREFS };
  /** The user's library cards (05/11/2026), shared by every song. */
  libraries: LibraryCatalog = { cards: [] };
  /**
   * F2.1 (01/11/2026): the built-in sounds play in the engine once its banks are there (the
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
    this.player.stripOf = (t) => this.stripOf(t);
    // Hidden window: send the notes further ahead, in case its timers slow down anyway.
    if (typeof document !== "undefined") {
      const follow = () => (this.player.lookahead = document.hidden ? HIDDEN_LOOKAHEAD : 0.2);
      document.addEventListener("visibilitychange", follow);
      follow();
    }
    this.player.metronomeStrip = () => this.strips.of(METRONOME_KEY, 15);
    this.syncStrips();
    this.player.subscribe(() => this.changed());
    this.player.onLive = (kind, n) => this.recordLive(kind, n.pitch, n.velocity, n.tick);
    this.player.onLiveCc = (cc, value, tick) => this.recordCc(cc, value, tick);
    this.player.onStart = () => {
      this.playCost = null;
      void this.bridge.engineLevels(true);
    };
    this.player.onStop = () => {
      this.finishTake();
      if (this.status === "ready") this.bridge.log({ type: "playback_stats", ...this.stats });
      if (this.playCost && this.playCost.blocks > 0) {
        const tracks = this.replica.song.trackOrder.map((id) => this.replica.song.tracks[id]!).filter(Boolean);
        this.bridge.log({ type: "engine_cost", ...costReport(this.playCost, tracks.map((t) => ({ name: t.name, strip: this.stripOf(t) }))) });
      }
      this.playCost = null;
      // F2.2: what each track measured in the engine while it played (tails included).
      setTimeout(() => {
        void this.bridge.engineLevels(false).then((levels) => {
          if (!levels) return;
          const tracks = this.replica.song.trackOrder.map((id) => this.replica.song.tracks[id]!).filter(Boolean);
          this.bridge.log({ type: "engine_levels", ...levelsReport(levels, tracks.map((t) => ({ ...t, strip: this.stripOf(t) }))) });
        });
      }, 1500);
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
      this.syncStrips();
      const sig = this.replica.song.trackOrder.map((id) => {
        const tr = this.replica.song.tracks[id];
        return tr ? `${this.stripOf(tr)}:${tr.output ?? ""}:${tr.channel}:${tr.program}:${tr.volume}:${tr.pan}:${reverbLevel(this.replica.song, tr)}:${tr.sound ? `${tr.sound.bank}/${tr.sound.bankMSB}/${tr.sound.program}` : ""}` : "";
      }).join("|");
      // F2.2 part B: mute, solo and the master fader go to the engine (they do not re-set the player);
      // part D: so do the buses and where every track goes.
      const song = this.replica.song;
      const mixSig = `${song.masterVolume ?? 1}|${song.trackOrder.map((id) => {
        const tr = song.tracks[id];
        return tr ? `${tr.mute ? "m" : ""}${tr.solo ? "s" : ""}>${tr.bus ?? ""}${JSON.stringify(tr.sends ?? [])}` : "";
      }).join(",")}|${(song.busOrder ?? []).map((id) => {
        const b = song.buses?.[id];
        return b ? JSON.stringify({ ...b, inserts: undefined, name: undefined, color: undefined }) : "";
      }).join(",")}`;
      if (mixSig !== this.mixSignature && sig === this.trackSignature) {
        this.mixSignature = mixSig;
        this.sendMix();
      }
      this.mixSignature = mixSig;
      // F2.2 part C: the chains that changed go to the engine.
      this.syncInserts();
      if (sig !== this.trackSignature) {
        this.trackSignature = sig;
        this.sendMix();
        this.player.setup();
        this.ensureBanks();
      }
      this.ensurePlugins();
      // A track that changed sides stops sounding on the side it left.
      for (const id of this.replica.song.trackOrder) {
        const tr = this.replica.song.tracks[id]!;
        const out = tr.output ?? "internal";
        if (this.outSides.has(id) && this.outSides.get(id) !== out) this.router?.silence(tr.channel, this.stripOf(tr));
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
      // Its tracks take their strips again (from their channels); the old ones go back to neutral.
      for (const [, strip] of this.strips.entries()) this.stripReset.push(strip);
      this.strips.clear();
      this.syncStrips();
    });
    void this.bridge.soundPrefs().then((p) => {
      this.soundPrefs = p;
      this.changed();
    });
    void this.bridge.libraries().then((c) => {
      this.libraries = c;
      this.changed();
    });
    this.bridge.onLibrariesChanged((c) => {
      this.libraries = c;
      this.changed();
    });
    this.bridge.onEngineScanning((p) => {
      this.pluginScan = p;
      this.changed();
    });
  }

  /** A card of the catalog by id. */
  libraryCard(id: string | undefined): LibraryCard | undefined {
    return id ? this.libraries.cards.find((c) => c.id === id) : undefined;
  }

  /** Saves a card in the user's catalog (the change comes back through onLibrariesChanged). */
  async saveLibrary(card: LibraryCard): Promise<LibraryCard | null> {
    const saved = await this.bridge.saveLibrary(card);
    if (saved) {
      this.libraries = { cards: [...this.libraries.cards.filter((c) => c.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)) };
      this.changed();
    }
    return saved;
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

  /** Every insert effect: Four Hands' own and the plugin effects (F2.2 part C, the Sonidos tab). */
  effectCatalog(lang: Lang, ownLabel: string): EffectItem[] {
    const names = { eq: OWN_EFFECTS.eq.name[lang], compressor: OWN_EFFECTS.compressor.name[lang], limiter: OWN_EFFECTS.limiter.name[lang], reverb: OWN_EFFECTS.reverb.name[lang], delay: OWN_EFFECTS.delay.name[lang] };
    return buildEffectCatalog({ lang, plugins: this.pluginList?.plugins ?? [], prefs: this.soundPrefs, ownLabel, ownNames: names });
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
  // The native engine (phase 2, test S2): tracks that sound through a plugin

  private engineChanged(status: EngineStatus): void {
    // A new engine (it started, or started again after a crash) has no plugins yet.
    if (status.generation !== this.engineStatus.generation || status.state !== "ready") this.engineLoaded.clear();
    const hadSounds = this.soundsInEngine();
    const was = this.engineStatus.state;
    this.engineStatus = status;
    this.watchLoad();
    // Its sounds went with it: the window plays them again, with the song's programs.
    if (hadSounds && !this.soundsInEngine()) {
      this.bridge.log({ type: "builtin_sounds", where: "app", reason: status.state });
      this.player.setup();
    }
    if (status.state === "ready") {
      // A new engine starts with neutral strips: it gets the song's mix and effects again.
      this.sendMix();
      this.syncInserts(status.generation !== this.insertsGeneration);
      this.insertsGeneration = status.generation;
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

  // -------------------------------------------------------------------------
  // A2: strips

  /**
   * Gives every track (and the metronome) its strip; the strips of tracks that went lose their
   * plugin here and go back to neutral at the next mix. The song heard may have a track the
   * replica does not (a proposal that adds one).
   */
  private syncStrips(): void {
    const tracks: Track[] = [];
    for (const song of [this.replica.song, this.heard()]) for (const id of song.trackOrder) if (song.tracks[id]) tracks.push(song.tracks[id]!);
    const { freed } = this.strips.sync(tracks);
    for (const strip of freed) {
      this.engineLoaded.delete(strip);
      this.stripReset.push(strip);
    }
  }

  /** The engine strip a track plays on. */
  stripOf(track: Pick<Track, "id" | "channel">): number {
    if (!this.strips.has(track.id)) this.syncStrips();
    return this.strips.of(track.id, track.channel);
  }

  /** Strips of the tracks that sound through a plugin. */
  pluginStrips(): Set<number> {
    const out = new Set<number>();
    for (const t of this.heardTracks()) if (t.output === "plugin") out.add(this.stripOf(t));
    return out;
  }

  /** The song's tracks (read for every event: not the song with a proposal, which is built each time). */
  private heardTracks(): Track[] {
    const song = this.replica.song;
    return song.trackOrder.map((id) => song.tracks[id]!).filter(Boolean);
  }

  /**
   * F2.2: the engine's strips for the song's tracks (fader, balance, on or off), the master fader,
   * and (part D) the buses' faders and the whole routing when it changed.
   */
  private sendMix(): void {
    if (this.engineStatus.state !== "ready") return;
    // The song heard (Con / Sin, a proposal): the AI's mix changes can be compared too.
    const song = this.heard();
    this.syncBuses();
    const tracks = song.trackOrder.map((id) => song.tracks[id]!).filter(Boolean);
    const reset = [...this.stripReset, this.strips.of(METRONOME_KEY, 15)];
    this.stripReset = [];
    const on = audible(song);
    this.bridge.engineMix(engineStrips(tracks.map((t) => ({ ...t, strip: this.stripOf(t) })), reset, on), masterGain(song.masterVolume), engineBuses(song, (id) => this.busIndexOf(id), on));
    const routing = engineRouting(song, (t) => this.stripOf(t), (id) => this.busIndexOf(id));
    const sig = `${this.engineStatus.generation}:${JSON.stringify(routing)}`;
    if (sig !== this.routingSent) {
      this.routingSent = sig;
      this.bridge.engineRouting(routing);
    }
  }

  /** F2.2 part D: every bus of the song (and of the song heard) keeps its place in the engine. */
  private syncBuses(): void {
    const ids = new Set<string>();
    for (const song of [this.replica.song, this.heard()]) for (const id of song.busOrder ?? []) ids.add(id);
    this.buses.sync([...ids]);
  }

  /** A bus's place in the engine (-1: none). */
  busIndexOf(id: string): number {
    if (this.buses.of(id) < 0) this.syncBuses();
    return this.buses.of(id);
  }

  /**
   * F2.2 part C: every strip's effect chain to the engine, only where it changed (`force`: all of
   * them, a new engine). From the song heard, so Con / Sin and proposals reach the effects too.
   */
  private syncInserts(force = false): void {
    if (this.engineStatus.state !== "ready") return;
    if (force) this.chainsSent.clear();
    const song = this.heard();
    const want = new Map<number, ReturnType<typeof engineChain>>();
    for (const id of song.trackOrder) {
      const t = song.tracks[id];
      if (t && t.output !== "external") want.set(this.stripOf(t), engineChain(t.inserts ?? []));
    }
    want.set(-1, engineChain(song.masterInserts ?? []));
    this.syncBuses();
    for (const b of busList(song)) {
      const index = this.busIndexOf(b.id);
      if (index >= 0) want.set(busChainKey(index), engineChain(b.inserts ?? []));
    }
    // Strips whose track went (or now sounds outside): their chain goes.
    for (const strip of this.chainsSent.keys()) if (!want.has(strip)) want.set(strip, []);
    for (const [strip, chain] of want) {
      const sig = JSON.stringify(chain);
      const was = this.chainsSent.get(strip);
      if (was === sig || (was === undefined && chain.length === 0)) continue;
      if (chain.length === 0) this.chainsSent.delete(strip);
      else this.chainsSent.set(strip, sig);
      void this.bridge.engineInserts(strip, chain).then((r) => {
        for (const x of chain) this.insertProblems.delete(x.id);
        for (const e of r.errors) if (e.id) this.insertProblems.set(e.id, e.error);
        if (r.errors.length) this.bridge.log({ type: "insert_problems", strip, errors: r.errors });
        this.changed();
      });
    }
    // After the chains (the engine loads a new plugin effect before it gets its parameters).
    // The AI's plugin parameters: only the ones that changed, and back to what was there when undone.
    const seen = new Set<string>();
    for (const x of allInserts(song)) {
      if (x.kind !== "plugin") continue;
      seen.add(x.id);
      const now = x.pluginParams ?? {};
      const before = force ? { params: {}, base: {} } : (this.pluginParamsSent.get(x.id) ?? { params: {}, base: {} });
      for (const [k, v] of Object.entries(now)) if (before.params[k] !== v) this.bridge.engineSetParam(x.id, Number(k), v);
      for (const k of Object.keys(before.params)) if (!(k in now)) {
        const was = before.base[k];
        if (was !== undefined) this.bridge.engineSetParam(x.id, Number(k), was);
      }
      this.pluginParamsSent.set(x.id, { params: { ...now }, base: { ...before.base, ...(x.pluginBase ?? {}) } });
    }
    for (const id of [...this.pluginParamsSent.keys()]) if (!seen.has(id)) this.pluginParamsSent.delete(id);
  }

  /**
   * F2.2 part C2: an own effect's parameters while a control moves in its window: only the sound
   * changes (the song changes on release, one undo step). The next sync sends the song's chain.
   */
  previewInsert(id: string, params: Record<string, number>, bypass?: boolean): void {
    if (this.engineStatus.state !== "ready") return;
    const song = this.heard();
    const where: Array<[number, readonly import("@fourhands/core").Insert[]]> = [[-1, song.masterInserts ?? []]];
    for (const tid of song.trackOrder) {
      const t = song.tracks[tid];
      if (t && t.output !== "external") where.push([this.stripOf(t), t.inserts ?? []]);
    }
    for (const b of busList(song)) if (this.busIndexOf(b.id) >= 0) where.push([busChainKey(this.busIndexOf(b.id)), b.inserts ?? []]);
    for (const [strip, chain] of where) {
      if (!chain.some((x) => x.id === id)) continue;
      const changed = chain.map((x) => (x.id === id ? { ...x, params: { ...(x.params ?? {}), ...params }, ...(bypass === undefined ? {} : { bypass }) } : x));
      const sent = engineChain(changed);
      this.chainsSent.set(strip, JSON.stringify(sent));
      void this.bridge.engineInserts(strip, sent);
      return;
    }
  }

  /** How many dB the compressors and limiters with these ids are reducing now (null without engine). */
  async reductions(ids: string[]): Promise<Record<string, number> | null> {
    if (this.engineStatus.state !== "ready" || ids.length === 0) return null;
    return this.bridge.engineReductions(ids);
  }

  /** A plugin effect's own window, from the engine. */
  async showInsert(id: string): Promise<boolean> {
    const ok = await this.bridge.engineShowInsert(id);
    this.bridge.log({ type: "engine_insert_window", id, ok });
    return ok;
  }

  /** F2.2 part B: the strips' levels since the last reading, for the console (null without engine). */
  async meters(): Promise<EngineLevels | null> {
    if (this.engineStatus.state !== "ready") return null;
    return this.bridge.engineMeters();
  }

  /** Reads the engine's load every second while it runs; the window redraws only when it changes. */
  private watchLoad(): void {
    if (this.engineStatus.state !== "ready") {
      if (this.loadTimer) clearInterval(this.loadTimer);
      this.loadTimer = null;
      if (this.engineLoad) {
        this.engineLoad = null;
        this.changed();
      }
      return;
    }
    if (this.loadTimer) return;
    this.loadTimer = setInterval(() => {
      void this.bridge.engineStats().then((load) => {
        if (!load) return;
        const shown = (l: EngineLoad | null) => (l ? Math.round(l.avgLoad * 100) : -1);
        const before = shown(this.engineLoad);
        this.engineLoad = load;
        if (load.cost && this.player.playing) this.playCost = addCost(this.playCost, load.cost);
        if (load.dropouts > 0) this.lastDropoutAt = Date.now();
        if (shown(load) !== before || load.dropouts > 0) this.changed();
      });
    }, 1000);
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
    return {
      midi: (events) => this.bridge.engineMidi(events),
      transport: (points) => this.bridge.engineTransport(points),
      panic: () => this.bridge.enginePanic(),
      latency: () => this.engineStatus.latency ?? 0,
    };
  }

  /** Each plugin track has its plugin loaded in its slot (the slot is the track's strip, A2). */
  private ensurePlugins(): void {
    if (this.engineStatus.state === "missing" || this.engineStatus.state === "starting") return;
    for (const id of this.replica.song.trackOrder) {
      const track = this.replica.song.tracks[id];
      if (track?.output !== "plugin" || !track.plugin) continue;
      const slot = this.stripOf(track);
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

  /** The user chose this plugin for a track: try it again even if it failed before. */
  retryPlugin(trackId: string, pluginId: string): void {
    const track = this.replica.song.tracks[trackId];
    if (track) this.engineRefused.delete(`${this.stripOf(track)}:${pluginId}`);
    this.pluginProblem = null;
  }

  /** "Abrir ventana del instrumento": the plugin's own window, from the engine. */
  async showPlugin(trackId: string): Promise<boolean> {
    const track = this.replica.song.tracks[trackId];
    if (!track) return false;
    const slot = this.stripOf(track);
    const ok = await this.bridge.engineShow(slot);
    this.bridge.log({ type: "engine_window", slot, ok });
    return ok;
  }

  /** Is the plugin of this track loaded and ready to sound? */
  pluginReady(trackId: string, pluginId: string): boolean {
    const track = this.replica.song.tracks[trackId];
    return !!track && this.engineStatus.state === "ready" && this.engineLoaded.get(this.stripOf(track)) === pluginId;
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
    this.sendMix();
    this.syncInserts();
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
    this.sendMix();
    this.syncInserts();
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
      this.sendMix();
      this.syncInserts();
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
        external: () => this.externalStrips(),
        externalChannels: () => this.externalChannels(),
        port: () => this.outPort(),
        delayMs: () => engine.outputLatencyMs,
        plugin: () => this.pluginStrips(),
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

  /** Where live input and auditions play: the active track's channel and strip. */
  private channel(): Target {
    const track = activeTrack(this.replica.song);
    return track ? { ch: track.channel, strip: this.stripOf(track) } : { ch: 0, strip: 0 };
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

  /** Strips of the tracks that sound in the other program. */
  externalStrips(): Set<number> {
    const out = new Set<number>();
    for (const t of this.heardTracks()) if (t.output === "external") out.add(this.stripOf(t));
    return out;
  }

  /** Their MIDI channels. */
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
  previewMix(trackId: string, volume: number, pan: number): void {
    const track = this.replica.song.tracks[trackId];
    if (!track) return;
    this.player.previewMix({ ch: track.channel, strip: this.stripOf(track) }, volume, pan);
    // The strip's fader is audio in the engine (part D: the built-in sounds' too): move it there.
    if (track.output !== "external" && this.engineStatus.state === "ready") {
      const tracks = this.heardTracks().map((t) => (t.id === trackId ? { ...t, volume, pan } : t));
      const mine = engineStrips(tracks.map((t) => ({ ...t, strip: this.stripOf(t) })), [], audible(this.heard())).filter((st) => st.track === trackId);
      this.bridge.engineMix(mine);
    }
  }

  /** F2.2 part D: a send's level while it moves (the song changes on release; 0: as if gone). */
  previewSend(sourceId: string, busId: string, level: number, pre?: boolean): void {
    if (this.engineStatus.state !== "ready") return;
    const song = this.heard();
    const source = song.tracks[sourceId] ?? song.buses?.[sourceId];
    if (!source || !song.buses?.[busId]) return;
    const others = (source.sends ?? []).filter((x) => x.bus !== busId);
    const was = source.sends?.find((x) => x.bus === busId);
    const sends = [...others, { bus: busId, level, ...((pre ?? was?.pre) ? { pre: true as const } : {}) }];
    const changed: Song = song.tracks[sourceId]
      ? { ...song, tracks: { ...song.tracks, [sourceId]: { ...song.tracks[sourceId]!, sends } } }
      : { ...song, buses: { ...song.buses, [sourceId]: { ...song.buses[sourceId]!, sends } } };
    const routing = engineRouting(changed, (t) => this.stripOf(t), (id) => this.busIndexOf(id));
    // Sent as it is; the next mix sends the song's own routing (the signature differs).
    this.routingSent = "";
    this.bridge.engineRouting(routing);
  }

  /** F2.2 part D: a bus's fader or pan while it moves (the song changes on release). */
  previewBus(busId: string, volume: number, pan: number): void {
    if (this.engineStatus.state !== "ready") return;
    const song = this.heard();
    const bus = song.buses?.[busId];
    if (!bus) return;
    const changed = { ...song, buses: { ...song.buses, [busId]: { ...bus, volume, pan } } };
    this.bridge.engineMix([], undefined, engineBuses(changed, (id) => this.busIndexOf(id), audible(song)).filter((b) => b.id === busId));
  }

  /** F2.2 part B: the master fader while it moves (the song changes on release). */
  previewMaster(volume: number): void {
    if (this.engineStatus.state === "ready") this.bridge.engineMix([], masterGain(volume));
  }

  audition(pitch: number, velocity: number): void {
    this.player.audition(pitch, velocity, this.channel());
  }
}
