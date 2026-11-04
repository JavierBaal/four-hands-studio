/**
 * Song-level editing (PRD_MVP.md, 4.1–4.2): tracks and instruments, tempo, meter, key and title,
 * sections, chords and annotations. Every action is one command list (one undo step) with its
 * sentence in the history. Also holds which field is being typed into (one at a time).
 */
import { EFFECT_NAME_MAX, type InsertSpec, OWN_EFFECTS, OWN_KINDS, findInsert, insertName, kindName, paramDefs } from "@fourhands/core";
import {
  type CommandData,
  type KeySignature,
  type Song,
  type Track,
  type TrackSound,
  barAt,
  barStart,
  barTicks,
  beatTicks,
  bpmAt,
  formatPosition,
  keyAt,
  orderedSections,
  orderedTracks,
  parseTempoChanges,
  tempoMarks,
  tempoChangesText,
  nextChannel,
} from "@fourhands/core";
import type { AudioLayer } from "./audio-layer.js";
import type { EffectItem, SoundItem } from "../shared/sound-catalog.js";
import type { ViewStore } from "./view.js";
import type { SkillImportResult, SoundBankInfo } from "../shared/protocol.js";
import type { Bridge } from "./bridge.js";
import type { BankPreset } from "../shared/soundbank-info.js";
import type { Lang, Strings, Translate } from "../shared/i18n.js";
import { activeTrack } from "./context.js";
import type { Editor, MenuItem } from "./editor.js";
import { PALETTE, type PaletteItem, instrumentName, paletteName } from "../shared/instruments.js";
import { barRange, keyName } from "./music.js";
import type { Replica } from "./replica.js";
import { SIZE, TRACK_PALETTE, trackColor, trackColorIndex } from "./theme.js";
import { formatDb, parseDb, parsePan } from "../shared/mix.js";

/** The sections of Ajustes, in their order. */
export const SETTINGS_SECTIONS = ["ai", "sound", "plugins", "midi", "folders", "advanced"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** What is being typed into right now. */
export type Typing =
  | { kind: "trackName"; id: string }
  | { kind: "trackVolume"; id: string }
  | { kind: "trackPan"; id: string }
  | { kind: "title" }
  | { kind: "tempo" }
  | { kind: "section"; id: string }
  | { kind: "chord"; tick: number }
  | { kind: "annotation"; id: string | null; tick: number }
  /** A tempo change typed on the Tempo ruler (H4); `editing` is the tick of the change being rewritten. */
  | { kind: "tempoChange"; tick: number; editing: number | null }
  | { kind: "effectName"; id: string };

/** What the palette gives: an instrument of the default bank, or a preset of an installed bank. */
export type SoundChoice = { kind: "default"; item: PaletteItem } | { kind: "bank"; bank: SoundBankInfo; preset: BankPreset };

/**
 * A2 (03/11/2026): no longer 15 (one per MIDI channel). Each track has a strip of its own in the
 * engine (512, with the metronome); past 15, tracks share MIDI channels for a DAW and a .mid file.
 */
export const MAX_TRACKS = 500;

const METERS: [number, number][] = [
  [2, 4],
  [3, 4],
  [4, 4],
  [5, 4],
  [2, 2],
  [3, 8],
  [6, 8],
  [9, 8],
  [12, 8],
];

export class SongActions {
  typing: Typing | null = null;
  mixer: { trackId: string; x: number; y: number } | null = null;
  /**
   * Ajustes (ESTUDIO_INTERFAZ_2.md, 5.4): the section open, or null when closed. Tu IA, the sound
   * banks, the plugins, MIDI, the folders and the test tools live here, not in the Help menu.
   */
  settings: SettingsSection | null = null;
  /** A short message at the bottom of the window, gone after a few seconds. */
  notice: string | null = null;
  /** F2.2 parte C: the effect slot selected in the console (Supr removes it). */
  selectedEffect: string | null = null;
  /**
   * The Sonidos tab shows instruments or effects (Fran, 04/11/2026), and where an effect goes from
   * there: a track's chain or the Master's (null: the active track).
   */
  soundsMode: "instruments" | "effects" = "instruments";
  /** F2.2 parte C2: the window of an own effect that is open (one at a time), and where it was left. */
  effectWindow: { id: string } | null = null;
  effectWindowPos: { left: number; top: number } | null = null;
  fxTarget: string | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  say(text: string): void {
    this.notice = text;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.notice = null;
      this.changed();
    }, 4000);
    this.changed();
  }

  /** Sound banks dropped onto the window go to the sounds folder. */
  async dropSounds(files: File[]): Promise<void> {
    if (!this.audio) return;
    const added = await this.audio.importSounds(files);
    this.say(added.length ? this.t("soundsAdded", { names: added.join(", ") }) : this.t("soundsNotAdded"));
    if (added.length) void this.audio.refreshBanks();
  }
  version = 0;
  private listeners = new Set<() => void>();

  constructor(
    private readonly replica: Replica,
    private readonly editor: Editor,
    private readonly t: Translate,
    private readonly lang: Lang,
    private readonly audio: AudioLayer | null = null,
    private readonly bridge: Bridge | null = null,
    private readonly viewStore: ViewStore | null = null,
  ) {}

  // -------------------------------------------------------------------------
  // Sonidos (ESTUDIO_INTERFAZ_2.md, 5.3): the browser is the door to a track's sound

  /** A context menu for a panel (the browser's rows). */
  menu(x: number, y: number, items: MenuItem[]): void {
    this.editor.openMenu(x, y, items);
  }

  closeMenus(): void {
    this.editor.closeMenus();
  }

  /** Opens the Sonidos tab for this track (it becomes the active one). */
  setSoundsMode(mode: "instruments" | "effects"): void {
    if (this.soundsMode === mode) return;
    this.soundsMode = mode;
    if (mode === "instruments") this.fxTarget = null;
    this.changed();
  }

  /** Effects from the browser go to the Master, or to the active track (null). */
  setFxTarget(target: "master" | null): void {
    this.fxTarget = target;
    this.changed();
  }

  /** «Todos los efectos…»: the Sonidos tab with the effects, for that chain ("master" or a track). */
  openEffects(target: string): void {
    this.editor.closeMenus();
    this.soundsMode = "effects";
    this.fxTarget = target === "master" ? "master" : null;
    if (target !== "master" && this.song.tracks[target] && this.song.context.activeTrackId !== target) void this.replica.setContext({ activeTrackId: target });
    this.changed();
    const v = this.viewStore?.state;
    if (!v) return;
    const compact = typeof window !== "undefined" && window.innerWidth < SIZE.compactBelow;
    const folded = compact ? !v.compactPanel : !v.panelOpen;
    this.viewStore!.set({ panelOpen: true, panelTab: "sounds", compactPanel: true, panelPeek: folded });
  }

  /** Where an effect from the browser goes now: the Master, or the active track. */
  effectTarget(): string | null {
    if (this.fxTarget === "master") return "master";
    return activeTrack(this.song)?.id ?? null;
  }

  /** An effect of the catalog onto a chain (double click in the browser, or dropped on a slot). */
  addEffectItem(item: EffectItem, target: string, index?: number): void {
    const spec: InsertSpec = item.target.kind === "plugin" ? { kind: "plugin", plugin: { id: item.target.plugin.id, name: item.target.plugin.name } } : { kind: item.target.kind };
    this.addEffect(target, spec, index);
    this.audio?.rememberSound(item.key);
  }

  openSounds(trackId: string): void {
    if (!this.song.tracks[trackId]) return;
    this.editor.closeMenus();
    this.soundsMode = "instruments";
    this.fxTarget = null;
    if (this.song.context.activeTrackId !== trackId) void this.replica.setContext({ activeTrackId: trackId });
    const v = this.viewStore?.state;
    if (!v) return;
    // Folded, it opens only for this: once the sound is chosen it folds again (panelPeek).
    const compact = typeof window !== "undefined" && window.innerWidth < SIZE.compactBelow;
    const folded = compact ? !v.compactPanel : !v.panelOpen;
    this.viewStore!.set({ panelOpen: true, panelTab: "sounds", compactPanel: true, panelPeek: folded || (v.panelPeek && v.panelTab === "sounds") });
  }

  /** A sound of the catalog on a track (double click, Enter, or dropped on its header). */
  applySound(trackId: string, item: SoundItem): void {
    const choice = this.choiceOf(item);
    if (item.target.kind === "plugin") this.choosePlugin(trackId, item.target.plugin);
    else if (choice) this.setInstrument(trackId, choice);
    else return;
    this.audio?.rememberSound(item.key);
    this.foldIfPeeking();
  }

  /** The column opened only to choose a sound: the sound is chosen, it folds again. */
  private foldIfPeeking(): void {
    const v = this.viewStore?.state;
    if (!v?.panelPeek) return;
    const compact = typeof window !== "undefined" && window.innerWidth < SIZE.compactBelow;
    this.viewStore!.set(compact ? { compactPanel: false, panelPeek: false } : { panelOpen: false, panelPeek: false });
  }

  /** A sound dropped on an empty part of the arrangement: a new track with it. */
  async addTrackWithSound(item: SoundItem): Promise<void> {
    const choice = this.choiceOf(item) ?? { kind: "default" as const, item: PALETTE[0]!.items[0]! };
    const id = await this.addTrack(choice);
    if (id && item.target.kind === "plugin") this.choosePlugin(id, item.target.plugin);
    this.audio?.rememberSound(item.key);
    this.foldIfPeeking();
  }

  private choiceOf(item: SoundItem): SoundChoice | null {
    const t = item.target;
    if (t.kind === "default") return { kind: "default", item: t.item };
    if (t.kind === "bank") {
      const bank = this.audio?.banks.find((b) => b.id === t.bankId);
      return bank ? { kind: "bank", bank, preset: t.preset } : null;
    }
    return null;
  }

  openSettings(section: SettingsSection | null): void {
    this.settings = section;
    if (section) this.editor.closeMenus();
    this.changed();
  }

  /** Ajustes › Tu IA (from "Gestionar skills…", the AI chip and the menu). */
  openSkills(open: boolean): void {
    this.openSettings(open ? "ai" : null);
  }

  /** Files dropped onto the window: ZIPs are skills, the rest go to the sound banks. */
  async dropFiles(files: File[]): Promise<void> {
    const zips = files.filter((f) => /\.zip$/i.test(f.name));
    const rest = files.filter((f) => !/\.zip$/i.test(f.name));
    if (zips.length) await this.importSkills(() => this.bridge!.importSkills(zips));
    if (rest.length) await this.dropSounds(rest);
  }

  /** Imports skills and says what happened; the panel reloads its list when it sees the new version. */
  async importSkills(run: () => Promise<SkillImportResult>): Promise<void> {
    if (!this.bridge) return;
    const result = await run();
    const added = result.added.filter((a) => !a.replaced).map((a) => a.name);
    const updated = result.added.filter((a) => a.replaced).map((a) => a.name);
    const why: Record<SkillImportResult["failed"][number]["problem"], Parameters<Translate>[0]> = {
      badZip: "skillsBadZip",
      noSkill: "skillsNoSkill",
      noName: "skillsNoName",
      tooBig: "skillsTooBig",
      unreadable: "skillsUnreadable",
    };
    const lines = [
      ...(added.length ? [this.t("skillsAdded", { names: added.join(", ") })] : []),
      ...(updated.length ? [this.t("skillsUpdated", { names: updated.join(", ") })] : []),
      ...result.failed.map((f) => this.t("skillsFailed", { file: f.file, why: this.t(why[f.problem]) })),
    ];
    if (lines.length) this.say(lines.join(" · "));
    this.skillsVersion++;
    this.changed();
  }
  /** Bumped when skills were imported or turned on and off, so the lists reload. */
  skillsVersion = 0;
  skillsChanged(): void {
    this.skillsVersion++;
    this.changed();
  }

  /** Ajustes › MIDI. */
  openMidiOut(open: boolean): void {
    this.openSettings(open ? "midi" : null);
  }

  /** Where a track sounds: in Four Hands, in the user's DAW through the MIDI out, or through a plugin. */
  setOutput(id: string, output: "internal" | "external" | "plugin"): void {
    const track = this.song.tracks[id];
    if (!track || (track.output ?? "internal") === output) return;
    if (output === "plugin" || (output === "internal" && track.output === "external" && track.plugin)) {
      if (track.plugin) this.choosePlugin(id, track.plugin);
      return;
    }
    // A plugin sounds in Four Hands: "Four Hands" changes nothing.
    if (output === "internal" && track.output === "plugin") return;
    const key = output === "external" ? "hOutputDaw" : "hOutputHere";
    void this.run(this.h(key, { name: track.name, ch: track.channel + 1 }), [{ type: "updateTrack", id, changes: { output } }]);
  }

  /** The track sounds through this plugin of the engine (prueba S2). */
  choosePlugin(id: string, plugin: { id: string; name: string }): void {
    const track = this.song.tracks[id];
    if (!track) return;
    this.audio?.retryPlugin(track.id, plugin.id);
    if (track.output === "plugin" && track.plugin?.id === plugin.id) return;
    void this.run(this.h("hOutputPlugin", { name: track.name, plugin: plugin.name }), [
      { type: "updateTrack", id, changes: { output: "plugin", plugin: { id: plugin.id, name: plugin.name } } },
    ]);
  }

  private outputMenu(id: string, x: number, y: number): void {
    const track = this.song.tracks[id];
    if (!track) return;
    const t = this.t;
    const pick = (o: "internal" | "external" | "plugin") => () => (this.editor.closeMenus(), this.setOutput(id, o));
    this.editor.openMenu(x, y, [
      { label: t("soundsBack"), run: () => this.trackMenu(id, x, y) },
      { separator: true },
      { label: `${t("trackMenuOutput")} · ${track.name}`, header: true },
      { label: t("outputHere"), active: track.output !== "external", run: pick("internal") },
      { label: t("outputDaw", { ch: track.channel + 1 }), active: track.output === "external", run: pick("external") },
      { separator: true },
      { label: t("outputSetup"), run: () => this.openMidiOut(true) },
    ]);
  }

  /** Ajustes › Sonido ("Conseguir más sonidos"). */
  openSoundsHelp(open: boolean): void {
    this.openSettings(open ? "sound" : null);
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

  type(typing: Typing | null): void {
    this.typing = typing;
    this.changed();
  }

  openMixer(trackId: string, x: number, y: number): void {
    this.mixer = { trackId, x, y };
    this.editor.closeMenus();
    this.changed();
  }

  closeMixer(): void {
    this.mixer = null;
    this.changed();
  }

  private get song(): Song {
    return this.replica.song;
  }

  /** The song concept, written by the user in the activity panel. */
  setConcept(text: string): void {
    const next = text.trim();
    const now = this.song.concept?.text ?? "";
    if (next === now) return;
    const label = !now ? this.t("hConceptNew") : next ? this.t("hConceptChanged") : this.t("hConceptRemoved");
    void this.run(label, [{ type: "setSongProperties", props: { concept: next } }]);
  }

  private run(label: string, commands: CommandData[]) {
    return this.replica.run(label, commands);
  }

  private h(key: keyof Strings, params: Record<string, string | number>): string {
    return this.t(key, params);
  }

  // -------------------------------------------------------------------------
  // Tracks

  /** A melodic channel for a track: a free one, or the least used (core's nextChannel). */
  private freeChannel(except?: string): number {
    return nextChannel(orderedTracks(this.song).filter((t) => t.id !== except));
  }

  canAddTrack(): boolean {
    return this.song.trackOrder.length < MAX_TRACKS;
  }

  async addTrack(choice: SoundChoice): Promise<string | null> {
    const item = choice.kind === "default" ? choice.item : null;
    if (!this.canAddTrack()) return null;
    let spec: { name: string; percussion?: boolean; program?: number; channel?: number; sound?: TrackSound };
    let name: string;
    if (choice.kind === "bank") {
      name = this.uniqueName(choice.preset.name);
      spec = { name, program: 0, channel: this.freeChannel(), sound: soundOf(choice) };
    } else {
      name = this.uniqueName(paletteName(choice.item, this.lang));
      spec = choice.item.program === null ? { name, percussion: true } : { name, program: choice.item.program, channel: this.freeChannel() };
    }
    const reply = await this.run(this.h("hTrackAdd", { name }), [{ type: "addTrack", spec }]);
    if (!reply.ok) return null;
    const id = reply.results[0] as string;
    void this.replica.setContext({ activeTrackId: id, selection: [] });
    return id;
  }

  private uniqueName(base: string): string {
    const names = new Set(Object.values(this.song.tracks).map((t) => t.name));
    if (!names.has(base)) return base;
    for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
  }

  removeTrack(id: string): void {
    const track = this.song.tracks[id];
    if (!track) return;
    const order = this.song.trackOrder;
    const next = order[order.indexOf(id) + 1] ?? order[order.indexOf(id) - 1] ?? null;
    void this.run(this.h("hTrackRemove", { name: track.name }), [{ type: "removeTrack", id }]).then((r) => {
      if (r.ok && next) void this.replica.setContext({ activeTrackId: next });
    });
  }

  renameTrack(id: string, name: string): void {
    const track = this.song.tracks[id];
    const clean = name.trim();
    if (!track || !clean || clean === track.name) return;
    void this.run(this.h("hTrackRename", { old: track.name, name: clean }), [{ type: "updateTrack", id, changes: { name: clean } }]);
  }

  moveTrack(id: string, index: number): void {
    const track = this.song.tracks[id];
    if (!track || this.song.trackOrder.indexOf(id) === index) return;
    void this.run(this.h("hTrackMove", { name: track.name }), [{ type: "moveTrack", id, index }]);
  }

  setInstrument(id: string, choice: SoundChoice): void {
    const track = this.song.tracks[id];
    if (!track) return;
    const changes: { program?: number | null; channel?: number; sound: TrackSound | null; output?: "internal"; plugin?: null } = { sound: null };
    // A sound of Four Hands replaces the plugin (one sound per track).
    if (track.output === "plugin") changes.output = "internal";
    if (track.plugin) changes.plugin = null;
    let inst: string;
    if (choice.kind === "bank") {
      inst = choice.preset.name;
      changes.sound = soundOf(choice);
      if (track.channel === 9) {
        changes.channel = this.freeChannel(id);
        changes.program = 0;
      }
    } else {
      const item = choice.item;
      inst = paletteName(item, this.lang);
      changes.program = item.program;
      if (item.program === null) changes.channel = 9;
      else if (track.channel === 9) changes.channel = this.freeChannel(id);
    }
    void this.run(this.h("hInstrument", { name: track.name, inst }), [{ type: "updateTrack", id, changes }]);
  }

  /** While a fader moves: only the sound changes (one undo step on release, with `setMix`). */
  previewMix(id: string, volume: number, pan: number, reverb?: number): void {
    this.audio?.previewMix(id, volume, pan, reverb);
  }

  /** A typed volume (dB) or pan (C, L30, R25). False if it cannot be read: the field stays open. */
  typeMix(id: string, field: "volume" | "pan", text: string): boolean {
    const track = this.song.tracks[id];
    if (!track) return true;
    const value = field === "volume" ? parseDb(text) : parsePan(text);
    if (value === null) return false;
    if (field === "volume") this.setMix(id, value, track.pan);
    else this.setMix(id, track.volume, value);
    return true;
  }

  /** Volume, pan and (H4) reverb send of a track in one undo step. Reverb left out: unchanged. */
  setMix(id: string, volume: number, pan: number, reverb?: number): void {
    const track = this.song.tracks[id];
    if (!track) return;
    const rev = reverb ?? track.reverb ?? 0;
    const revChanged = rev !== (track.reverb ?? 0);
    if (track.volume === volume && track.pan === pan && !revChanged) return;
    const onlyReverb = track.volume === volume && track.pan === pan;
    void this.run(this.h(onlyReverb ? "hReverb" : "hMix", { name: track.name }), [{ type: "updateTrack", id, changes: { volume, pan, reverb: rev } }]);
  }

  // -------------------------------------------------------------------------
  // Insert effects (F2.2 parte C)

  /** "el Piano" / "el Máster", for the history. */
  private chainLabel(target: string): string {
    return target === "master" ? this.t("consoleMaster") : (this.song.tracks[target]?.name ?? target);
  }

  selectEffect(id: string | null): void {
    if (this.selectedEffect === id) return;
    this.selectedEffect = id;
    this.changed();
  }

  /** «+» in a slot: Four Hands' own effects, then the plugin effects the engine knows. */
  effectAddMenu(target: string, x: number, y: number): void {
    const t = this.t;
    const close = (fn: () => void) => () => (this.editor.closeMenus(), fn());
    // Short (Fran, 04/11/2026: with many plugins a flat list was chaos): Four Hands' own, the
    // favourite and recent plugins, and the whole organised list in the Sonidos tab.
    const catalog = this.audio?.effectCatalog(this.lang, t("sndBuiltIn")) ?? [];
    const prefs = this.audio?.soundPrefs;
    const plugins = catalog.filter((i) => i.origin === "plugin");
    const favs = plugins.filter((i) => prefs?.favorites.includes(i.key)).sort((a, b) => a.name.localeCompare(b.name));
    const recents = (prefs?.recents ?? []).map((k) => plugins.find((i) => i.key === k)).filter((i): i is EffectItem => !!i && !favs.includes(i)).slice(0, 5);
    const pick = (i: EffectItem): MenuItem => (i.origin === "plugin" ? { label: i.name, shortcut: i.source, run: close(() => this.addEffectItem(i, target)) } : { label: i.name, run: close(() => this.addEffectItem(i, target)) });
    const items: MenuItem[] = [{ label: t("fxOwn"), header: true }, ...catalog.filter((i) => i.origin === "builtin").map(pick)];
    if (favs.length) items.push({ separator: true }, { label: t("fxFavorites"), header: true }, ...favs.map(pick));
    if (recents.length) items.push({ separator: true }, { label: t("fxRecents"), header: true }, ...recents.map(pick));
    items.push({ separator: true });
    if (plugins.length) items.push({ label: t("fxAll", { n: plugins.length }), run: close(() => this.openEffects(target)) });
    else if (this.audio?.engineStatus.state === "missing") items.push({ label: t("fxNoEngine"), disabled: true });
    else items.push({ label: t("fxScan"), run: close(() => void this.audio?.loadPlugins(true)) });
    this.editor.openMenu(x, y, items);
  }

  /** Right click on a slot. */
  effectMenu(id: string, x: number, y: number): void {
    const found = findInsert(this.song, id);
    if (!found) return;
    const t = this.t;
    const close = (fn: () => void) => () => (this.editor.closeMenus(), fn());
    const name = insertName(found.insert, this.lang);
    this.editor.openMenu(x, y, [
      { label: name, header: true },
      { label: t("fxOpen"), run: close(() => this.openEffectWindow(id)) },
      { label: found.insert.bypass ? t("fxEnable") : t("fxBypass"), run: close(() => this.setEffectBypass(id, !found.insert.bypass)) },
      { label: t("fxRename"), run: close(() => this.type({ kind: "effectName", id })) },
      ...(found.insert.name ? [{ label: t("fxRenameBack", { name: kindName(found.insert, this.lang) }), run: close(() => this.renameEffect(id, "")) }] : []),
      { separator: true },
      { label: t("fxRemove"), shortcut: "Supr", run: close(() => this.removeEffect(id)) },
    ]);
  }

  addEffect(target: string, spec: InsertSpec, index?: number): void {
    const name = spec.kind === "plugin" ? spec.plugin.name : OWN_EFFECTS[spec.kind].name[this.lang];
    void this.run(this.h("hEffectAdd", { effect: name, where: this.chainLabel(target) }), [index === undefined ? { type: "addInsert", target, spec } : { type: "addInsert", target, spec, index }]);
  }

  removeEffect(id: string): void {
    const found = findInsert(this.song, id);
    if (!found) return;
    if (this.selectedEffect === id) this.selectedEffect = null;
    void this.run(this.h("hEffectRemove", { effect: insertName(found.insert, this.lang), where: this.chainLabel(found.target) }), [{ type: "removeInsert", id }]);
  }

  /** Supr in the console: the selected effect goes. False if none was selected. */
  removeSelectedEffect(): boolean {
    if (!this.selectedEffect || !findInsert(this.song, this.selectedEffect)) return false;
    this.removeEffect(this.selectedEffect);
    return true;
  }

  /** Dragged to `index` of `target`'s chain (its own chain or another strip's). */
  moveEffect(id: string, index: number, target: string): void {
    const found = findInsert(this.song, id);
    if (!found) return;
    // Dropping before itself or right after itself, in the same chain, is no move.
    if (found.target === target && (index === found.index || index === found.index + 1)) return;
    const at = found.target === target && index > found.index ? index - 1 : index;
    void this.run(this.h("hEffectMove", { effect: insertName(found.insert, this.lang), where: this.chainLabel(target) }), [{ type: "moveInsert", id, index: at, target }]);
  }

  /** Double click on an own effect: its window (a plugin opens its own, from the engine). */
  openEffectWindow(id: string): void {
    const found = findInsert(this.song, id);
    if (!found) return;
    if (found.insert.kind === "plugin") {
      void this.audio?.showInsert(id);
      return;
    }
    this.effectWindow = { id };
    this.changed();
  }

  closeEffectWindow(): void {
    if (!this.effectWindow) return;
    this.effectWindow = null;
    this.changed();
  }

  /** While a control moves: only the sound changes. */
  previewEffectParams(id: string, params: Record<string, number>): void {
    this.audio?.previewInsert(id, params);
  }

  /** On release (or a typed value): the song, one undo step. */
  setEffectParams(id: string, params: Record<string, number>): void {
    const found = findInsert(this.song, id);
    if (!found || found.insert.kind === "plugin") return;
    const changed = Object.entries(params).filter(([k, v]) => (found.insert.params?.[k] ?? NaN) !== v);
    if (!changed.length) return;
    const defs = paramDefs(found.insert.kind);
    const what = changed.length === 1 ? (defs.find((d) => d.id === changed[0]![0])?.name ?? changed[0]![0]) : "";
    void this.run(this.h(changed.length === 1 ? "hEffectParam" : "hEffectParams", { effect: insertName(found.insert, this.lang), param: what }), [{ type: "updateInsert", id, changes: { params: Object.fromEntries(changed) } }]);
  }

  /** The user's own name for an effect; "" goes back to what it is (Fran, 04/11/2026). */
  renameEffect(id: string, text: string): void {
    const found = findInsert(this.song, id);
    if (!found) return;
    const name = text.trim().slice(0, EFFECT_NAME_MAX);
    if ((found.insert.name ?? "") === name || (!found.insert.name && name === kindName(found.insert, this.lang))) return;
    void this.run(this.h(name ? "hEffectRename" : "hEffectRenameBack", { effect: insertName(found.insert, this.lang), name: name || kindName(found.insert, this.lang) }), [{ type: "updateInsert", id, changes: { name } }]);
  }

  setEffectBypass(id: string, bypass: boolean): void {
    const found = findInsert(this.song, id);
    if (!found) return;
    const key = bypass ? "hEffectBypass" : "hEffectOn";
    void this.run(this.h(key, { effect: insertName(found.insert, this.lang), where: this.chainLabel(found.target) }), [{ type: "updateInsert", id, changes: { bypass } }]);
  }

  /** F2.2 parte B: the master fader while it moves; the song changes with `setMasterVolume`. */
  previewMaster(volume: number): void {
    this.audio?.previewMaster(volume);
  }

  /** The master fader (0–1, the tracks' curve), one undo step. */
  setMasterVolume(volume: number): void {
    const v = Math.max(0, Math.min(1, volume));
    if (v === (this.song.masterVolume ?? 1)) return;
    void this.run(this.t("hMaster", { db: formatDb(v, this.lang) }), [{ type: "setSongProperties", props: { masterVolume: v } }]);
  }

  /** What sounds on a track, for its header, its card and the toolbar: the plugin, the bank preset or the instrument. */
  soundLabel(track: Track): string {
    if (track.output === "plugin" && track.plugin) return track.plugin.name;
    return this.instrumentLabel(track);
  }

  /** Where the sound comes from (its icon): Four Hands's own, a bank of yours, a plugin, or your DAW. */
  soundOrigin(track: Track): "builtin" | "bank" | "plugin" | "daw" {
    if (track.output === "external") return "daw";
    if (track.output === "plugin" && track.plugin) return "plugin";
    return track.sound ? "bank" : "builtin";
  }

  instrumentLabel(track: Track): string {
    if (track.sound) {
      const state = this.audio?.bankStatus(track.sound.bank);
      if (state === "missing") return this.t("bankMissingLabel", { name: track.sound.name });
      if (state === "loading") return this.t("bankLoadingLabel", { name: track.sound.name });
      return track.sound.name;
    }
    for (const g of PALETTE) for (const item of g.items) if (item.program === track.program && (item.program !== null || track.channel === 9)) return paletteName(item, this.lang);
    return instrumentName(track.program, track.channel, this.lang);
  }

  /**
   * The instrument palette as a menu; picking applies to the track, or adds a new one.
   * First the default bank's instruments, then "Your sounds": each installed bank opens its own
   * list of presets (a bank with a single instrument is picked directly).
   */
  paletteMenu(x: number, y: number, onPick: (choice: SoundChoice) => void, current?: Track, extra: MenuItem[] = []): void {
    const t = this.t;
    // A track that plays a plugin has no sound of Four Hands marked.
    if (current?.output === "plugin") current = undefined;
    const pick = (choice: SoundChoice) => () => (this.editor.closeMenus(), onPick(choice));
    const items: MenuItem[] = [{ label: t("soundsDefault"), header: true }];
    for (const g of PALETTE) {
      items.push({ label: this.lang === "es" ? g.es : g.en, header: true });
      for (const item of g.items) {
        const active = current && !current.sound ? current.program === item.program && (item.program !== null || current.channel === 9) : false;
        items.push({ label: paletteName(item, this.lang), active, run: pick({ kind: "default", item }) });
      }
    }
    items.push({ separator: true }, { label: t("soundsYours"), header: true });
    const banks = this.audio?.banks ?? [];
    if (banks.length === 0) items.push({ label: t("soundsNone"), disabled: true });
    for (const bank of banks) {
      const usedHere = current?.sound?.bank === bank.id;
      if (bank.presets.length === 1) {
        items.push({ label: bank.name, active: usedHere, run: pick({ kind: "bank", bank, preset: bank.presets[0]! }) });
      } else {
        items.push({ label: bank.name, active: usedHere, shortcut: `${bank.presets.length} ›`, run: () => this.bankMenu(x, y, bank, onPick, current) });
      }
    }
    items.push(...extra);
    items.push(
      { separator: true },
      { label: t("soundsFolder"), run: () => (this.editor.closeMenus(), this.audio?.openSoundsFolder()) },
      { label: t("soundsMore"), run: () => this.openSoundsHelp(true) },
    );
    this.editor.openMenu(x, y, items);
  }

  /** The presets of one installed bank. */
  private bankMenu(x: number, y: number, bank: SoundBankInfo, onPick: (choice: SoundChoice) => void, current?: Track): void {
    const items: MenuItem[] = [
      { label: this.t("soundsBack"), run: () => this.paletteMenu(x, y, onPick, current) },
      { separator: true },
      { label: bank.name, header: true },
    ];
    for (const preset of bank.presets) {
      const active = current?.sound?.bank === bank.id && current.sound.program === preset.program && current.sound.bankMSB === preset.bankMSB;
      items.push({ label: preset.name || `${preset.bankMSB}:${preset.program}`, active, run: () => (this.editor.closeMenus(), onPick({ kind: "bank", bank, preset })) });
    }
    this.editor.openMenu(x, y, items);
  }

  trackMenu(id: string, x: number, y: number): void {
    const t = this.t;
    const order = this.song.trackOrder;
    const i = order.indexOf(id);
    const track = this.song.tracks[id];
    if (!track) return;
    const close = (fn: () => void) => () => (this.editor.closeMenus(), fn());
    this.editor.openMenu(x, y, [
      { label: track.name, header: true },
      { label: t("trackMenuSound"), shortcut: this.soundLabel(track), run: () => this.openSounds(id) },
      { label: t("trackMenuMix"), run: () => this.openMixer(id, x, y) },
      {
        label: t("trackMenuOutput"),
        shortcut: track.output === "external" ? t("outputDawShort") : "Four Hands",
        run: () => this.outputMenu(id, x, y),
      },
      ...this.pluginItems(track),
      { label: t("trackMenuColor"), swatch: trackColor(track.color), shortcut: "›", run: () => this.colorMenu(id, x, y) },
      { label: t("trackMenuRename"), run: close(() => this.type({ kind: "trackName", id })) },
      { separator: true },
      { label: t("trackMenuUp"), disabled: i <= 0, run: close(() => this.moveTrack(id, i - 1)) },
      { label: t("trackMenuDown"), disabled: i >= order.length - 1, run: close(() => this.moveTrack(id, i + 1)) },
      { separator: true },
      { label: t("trackMenuDelete"), disabled: order.length <= 1, run: close(() => this.removeTrack(id)) },
    ]);
  }

  /** For a track that sounds through a plugin: its window, or why it is not sounding. */
  private pluginItems(track: Track): MenuItem[] {
    if (track.output !== "plugin" || !track.plugin) return [];
    const plugin = track.plugin;
    const problem = this.audio?.pluginProblem;
    if (problem && problem.name === plugin.name && !this.audio?.pluginReady(track.id, plugin.id)) {
      return [{ label: `${this.t("pluginLoadFailed", { plugin: plugin.name })}: ${problem.error}`, disabled: true }];
    }
    return [
      {
        label: this.t("trackMenuPluginWindow", { plugin: plugin.name }),
        disabled: !this.audio?.pluginReady(track.id, plugin.id),
        run: () => (this.editor.closeMenus(), void this.audio?.showPlugin(track.id)),
      },
    ];
  }

  /** The track palette, each colour with its name; the current one is marked. */
  private colorMenu(id: string, x: number, y: number): void {
    const track = this.song.tracks[id];
    if (!track) return;
    const items: MenuItem[] = [
      { label: this.t("soundsBack"), run: () => this.trackMenu(id, x, y) },
      { separator: true },
      { label: `${this.t("trackMenuColor")} · ${track.name}`, header: true },
    ];
    TRACK_PALETTE.forEach((c, i) =>
      items.push({ label: this.lang === "es" ? c.es : c.en, swatch: trackColor(i), active: trackColorIndex(track.color) === i, run: () => (this.editor.closeMenus(), this.setColor(id, i)) }),
    );
    this.editor.openMenu(x, y, items);
  }

  setColor(id: string, color: number): void {
    const track = this.song.tracks[id];
    const c = TRACK_PALETTE[color];
    if (!track || !c || track.color === color) return;
    void this.run(this.h("hColor", { name: track.name, color: (this.lang === "es" ? c.es : c.en).toLowerCase() }), [{ type: "updateTrack", id, changes: { color } }]);
  }

  // -------------------------------------------------------------------------
  // Tempo, meter, key, title

  setTempo(bpm: number): void {
    const clean = Math.round(Math.max(20, Math.min(300, bpm)));
    if (!Number.isFinite(bpm)) return;
    const tempo = Math.round(60_000_000 / clean);
    if (tempo === this.song.tempo) return;
    void this.run(this.h("hTempo", { bpm: clean }), [{ type: "setSongProperties", props: { tempo } }]);
  }

  // -------------------------------------------------------------------------
  // Tempo and key along the song (H4, Fran 26/10/2026)

  /** The tempo in force at a tick, in whole BPM (the top bar shows it at the playhead or the cursor). */
  tempoAt(tick: number): number {
    return Math.round(bpmAt(this.song, tick) * 100) / 100;
  }

  /**
   * The top bar's tempo, typed: it changes the tempo in force where the playhead or the cursor is.
   * Before the first change, that is the song's tempo; after it, the change in force.
   */
  setTempoAt(tick: number, bpm: number): void {
    const points = this.song.tempoChanges ?? [];
    const inForce = [...points].reverse().find((p) => p.tick <= tick);
    if (!inForce) return this.setTempo(bpm);
    if (!Number.isFinite(bpm)) return;
    const clean = Math.round(Math.max(20, Math.min(300, bpm)));
    const tempo = Math.round(60_000_000 / clean);
    if (tempo === inForce.tempo) return;
    const next = points.map((p) => (p === inForce ? { ...p, tempo } : p));
    void this.run(this.h("hTempoAt", { bpm: clean, bar: barAt(this.song.meter, inForce.tick) }), [{ type: "setTempoChanges", points: next }]);
  }

  /** The text a change reads as on its ruler, to edit it: "60", "rit 60", "fermata 2". */
  tempoChangeText(tick: number): string {
    const mark = tempoMarks(this.song).find((m) => m.tick === tick);
    if (!mark) return "";
    if (mark.kind === "fermata") return `${this.t("fermataWord")} ${mark.factor}`;
    if (mark.kind === "ramp") return `${mark.slower ? "rit" : "accel"} ${mark.bpm}`;
    return String(mark.bpm);
  }

  /**
   * Writes a tempo change typed on the ruler ("60", "rit 60", "accel 90", "calderón", "calderón 3"),
   * replacing the change at `editing` (and the second point of a fermata). Empty text removes it.
   * False, with a notice, when the text cannot be read.
   */
  saveTempoChange(editing: number | null, tick: number, text: string): boolean {
    const clean = text
      .trim()
      .toLowerCase()
      .replace(/^calder[oó]n\b/, "fermata");
    const marks = tempoMarks(this.song);
    const drop = new Set<number>();
    if (editing !== null) {
      const m = marks.find((x) => x.tick === editing);
      if (m) drop.add(m.tick);
      if (m?.kind === "fermata") drop.add(m.end);
    }
    const kept = (this.song.tempoChanges ?? []).filter((p) => !drop.has(p.tick));
    const keptSong = { ...this.song, tempoChanges: kept };
    const keptLines = tempoChangesText(keptSong)
      .split("\n")
      .filter(Boolean)
      .map((line, i) => ({ tick: kept[i]!.tick, line }));
    if (editing === null && !clean) return true;
    const all = clean ? [...keptLines.filter((l) => l.tick !== tick), { tick, line: `${formatPosition(this.song.meter, tick)} ${clean}` }] : keptLines;
    all.sort((a, b) => a.tick - b.tick);
    let points;
    try {
      points = parseTempoChanges(this.song, all.map((l) => l.line).join("\n"));
    } catch {
      this.say(this.t("tempoChangeInvalid"));
      return false;
    }
    const bar = barAt(this.song.meter, tick);
    const label = !clean ? this.h("hTempoChangeRemove", { bar }) : this.h("hTempoChange", { text: clean.replace(/^fermata\b/, this.t("fermataWord")), bar });
    void this.run(label, [{ type: "setTempoChanges", points }]);
    return true;
  }

  /** Right click on the Tempo ruler: on a change, edit / glide or jump / remove; elsewhere, add one. */
  tempoMenu(tick: number, onMark: number | null, x: number, y: number): void {
    const close = (fn: () => void) => () => (this.editor.closeMenus(), fn());
    const at = this.beatAt(tick);
    if (onMark === null) {
      this.editor.openMenu(x, y, this.tempoAddItems(at));
      return;
    }
    const mark = tempoMarks(this.song).find((m) => m.tick === onMark);
    if (!mark) return;
    const items: MenuItem[] = [{ label: this.t("tempoChangeEdit"), run: close(() => this.type({ kind: "tempoChange", tick: onMark, editing: onMark })) }];
    if (mark.kind !== "fermata") {
      const ramp = mark.kind === "ramp";
      items.push({
        label: this.t(ramp ? "tempoChangeJump" : "tempoChangeGlide"),
        run: close(() => {
          const points = (this.song.tempoChanges ?? []).map((p) => (p.tick === onMark ? (ramp ? { tick: p.tick, tempo: p.tempo } : { ...p, ramp: true as const }) : p));
          void this.run(this.h(ramp ? "hTempoJump" : "hTempoGlide", { bar: barAt(this.song.meter, onMark) }), [{ type: "setTempoChanges", points }]);
        }),
      });
    }
    items.push({ label: this.t(mark.kind === "fermata" ? "fermataRemove" : "tempoChangeRemove"), run: close(() => this.saveTempoChange(onMark, onMark, "")) });
    this.editor.openMenu(x, y, items);
  }

  /** "Cambio de tempo aquí…", "Calderón aquí": on the rulers, wherever there is room for them. */
  private tempoAddItems(at: number): MenuItem[] {
    const close = (fn: () => void) => () => (this.editor.closeMenus(), fn());
    return [
      { label: this.t("tempoChangeHere"), run: close(() => this.type({ kind: "tempoChange", tick: Math.max(beatTicks(this.song.meter), at), editing: null })) },
      { label: this.t("fermataHere"), run: close(() => void this.saveTempoChange(null, Math.max(beatTicks(this.song.meter), at), "fermata")) },
    ];
  }

  /** The key in force at a tick. */
  keyAt(tick: number): KeySignature {
    return keyAt(this.song, tick);
  }

  /** Writes the key from a bar line on (bar 1: the song's key). The same key as before removes the change. */
  setKeyFrom(barTick: number, key: KeySignature): void {
    const name = keyName(key, this.lang);
    if (barTick <= 0) {
      const k = this.song.key;
      if (k.fifths === key.fifths && k.mode === key.mode) return;
      void this.run(this.h("hKey", { key: name }), [{ type: "setSongProperties", props: { key } }]);
      return;
    }
    const others = (this.song.keyChanges ?? []).filter((c) => c.tick !== barTick);
    const changes = [...others, { tick: barTick, key }].sort((a, b) => a.tick - b.tick);
    void this.run(this.h("hKeyChange", { key: name, bar: barAt(this.song.meter, barTick) }), [{ type: "setKeyChanges", changes }]);
  }

  removeKeyChange(barTick: number): void {
    const changes = (this.song.keyChanges ?? []).filter((c) => c.tick !== barTick);
    void this.run(this.h("hKeyChangeRemove", { bar: barAt(this.song.meter, barTick) }), [{ type: "setKeyChanges", changes }]);
  }

  /** The keys to choose from, marking `current`. */
  private keyItems(current: KeySignature, pick: (key: KeySignature) => void): MenuItem[] {
    const items: MenuItem[] = [];
    for (const mode of ["major", "minor"] as const) {
      items.push({ label: this.t(mode === "major" ? "keysMajor" : "keysMinor"), header: true });
      for (let fifths = -6; fifths <= 6; fifths++) {
        const key = { fifths, mode };
        items.push({
          label: keyName(key, this.lang),
          active: current.fifths === fifths && current.mode === mode,
          run: () => (this.editor.closeMenus(), pick(key)),
        });
      }
    }
    return items;
  }

  /** The Key ruler: a change's menu (pick another key, or remove it), or a new change at that bar. */
  keyChangeMenu(tick: number, x: number, y: number): void {
    const bar = barStart(this.song.meter, barAt(this.song.meter, tick));
    const existing = (this.song.keyChanges ?? []).find((c) => c.tick === bar);
    const items: MenuItem[] = [];
    if (existing) items.push({ label: this.t("keyChangeRemove"), run: () => (this.editor.closeMenus(), this.removeKeyChange(bar)) });
    if (bar === 0) items.push({ label: this.t("keyChangeFirstBar"), header: true });
    items.push(...this.keyItems(keyAt(this.song, bar), (key) => this.setKeyFrom(bar, key)));
    this.editor.openMenu(x, y, items);
  }

  /** Right click on the bar numbers: tempo and key changes there (H4). */
  barMenu(tick: number, x: number, y: number): void {
    const bar = barStart(this.song.meter, barAt(this.song.meter, tick));
    const close = (fn: () => void) => () => (this.editor.closeMenus(), fn());
    this.editor.openMenu(x, y, [
      ...this.tempoAddItems(this.beatAt(tick)),
      ...(bar > 0 ? [{ label: this.t("keyChangeHere"), run: close(() => this.keyChangeMenu(bar, x, y)) }] : []),
    ]);
  }

  meterMenu(x: number, y: number): void {
    const m = this.song.meter;
    this.editor.openMenu(x, y, [
      { label: this.t("meters"), header: true },
      ...METERS.map(([n, d]) => ({
        label: `${n}/${d}`,
        active: m.numerator === n && m.denominator === d,
        run: () => {
          this.editor.closeMenus();
          if (m.numerator === n && m.denominator === d) return;
          void this.run(this.h("hMeter", { meter: `${n}/${d}` }), [{ type: "setSongProperties", props: { meter: { numerator: n, denominator: d } } }]);
        },
      })),
    ]);
  }

  /** The top bar's key: the key in force where the playhead or the cursor is (H4). */
  keyMenu(x: number, y: number, at = 0): void {
    const inForce = [...(this.song.keyChanges ?? [])].reverse().find((c) => c.tick <= at);
    const from = inForce?.tick ?? 0;
    this.editor.openMenu(x, y, this.keyItems(keyAt(this.song, from), (key) => this.setKeyFrom(from, key)));
  }

  setTitle(title: string): void {
    const clean = title.trim();
    if (!clean || clean === this.song.title) return;
    void this.run(this.h("hTitle", { title: clean }), [{ type: "setSongProperties", props: { title: clean } }]);
  }

  // -------------------------------------------------------------------------
  // Sections

  /** A new section over whole bars; its name is typed right away. */
  async addSection(startTick: number, endTick: number): Promise<void> {
    const meter = this.song.meter;
    const startBar = barAt(meter, Math.min(startTick, endTick));
    const endBar = Math.max(startBar, barAt(meter, Math.max(startTick, endTick) - 1));
    const name = this.t("newSection");
    const reply = await this.run(this.h("hSectionAdd", { name, bars: barRange(meter, barStart(meter, startBar), barStart(meter, endBar + 1)) }), [
      { type: "addSection", spec: { name, startBar, endBar } },
    ]);
    if (reply.ok) this.type({ kind: "section", id: reply.results[0] as string });
  }

  /** The empty state's button: the loop, or eight bars from the cursor. */
  addSectionHere(): void {
    const ctx = this.song.context;
    const bar = barTicks(this.song.meter);
    if (ctx.loop) void this.addSection(ctx.loop.start, ctx.loop.end);
    else {
      const start = Math.floor(ctx.cursor / bar) * bar;
      void this.addSection(start, start + 8 * bar);
    }
  }

  renameSection(id: string, name: string): void {
    const s = this.song.sections[id];
    const clean = name.trim();
    if (!s || !clean || clean === s.name) return;
    void this.run(this.h("hSectionRename", { old: s.name, name: clean }), [{ type: "updateSection", id, changes: { name: clean } }]);
  }

  resizeSection(id: string, startBar: number, endBar: number): void {
    const s = this.song.sections[id];
    if (!s || (s.startBar === startBar && s.endBar === endBar) || endBar < startBar || startBar < 1) return;
    const meter = this.song.meter;
    void this.run(this.h("hSectionResize", { name: s.name, bars: barRange(meter, barStart(meter, startBar), barStart(meter, endBar + 1)) }), [
      { type: "updateSection", id, changes: { startBar, endBar } },
    ]);
  }

  removeSection(id: string): void {
    const s = this.song.sections[id];
    if (s) void this.run(this.h("hSectionRemove", { name: s.name }), [{ type: "removeSection", id }]);
  }

  sectionMenu(id: string, x: number, y: number): void {
    const s = this.song.sections[id];
    if (!s) return;
    const meter = this.song.meter;
    const close = (fn: () => void) => () => (this.editor.closeMenus(), fn());
    this.editor.openMenu(x, y, [
      { label: s.name, header: true },
      { label: this.t("sectionRename"), run: close(() => this.type({ kind: "section", id })) },
      { label: this.t("sectionLoop"), run: close(() => void this.replica.setContext({ loop: { start: barStart(meter, s.startBar), end: barStart(meter, s.endBar + 1) } })) },
      { separator: true },
      { label: this.t("sectionDelete"), run: close(() => this.removeSection(id)) },
    ]);
  }

  // -------------------------------------------------------------------------
  // Chords: typed in place, one per bar or per beat

  /** Tick of the beat under a tick (chords sit on beats). */
  beatAt(tick: number): number {
    const beat = beatTicks(this.song.meter);
    return Math.max(0, Math.floor(tick / beat) * beat);
  }

  setChord(tick: number, symbol: string): void {
    const clean = symbol.trim().slice(0, 16);
    const bar = barAt(this.song.meter, tick);
    const current = this.song.harmony[String(tick)];
    if (!clean) {
      if (current) void this.run(this.h("hChordRemove", { bar }), [{ type: "setChord", tick, symbol: null }]);
      return;
    }
    if (clean === current) return;
    void this.run(this.h("hChord", { chord: clean, bar }), [{ type: "setChord", tick, symbol: clean }]);
  }

  /** After typing a chord, the next bar is ready for the next one. */
  nextChordBar(tick: number): number {
    const bar = barTicks(this.song.meter);
    return (Math.floor(tick / bar) + 1) * bar;
  }

  chordMenu(tick: number, x: number, y: number): void {
    this.editor.openMenu(x, y, [{ label: this.t("chordRemove"), run: () => (this.editor.closeMenus(), this.setChord(tick, "")) }]);
  }

  /** The empty state's button: start typing at the bar of the cursor. */
  writeChordsHere(): void {
    const bar = barTicks(this.song.meter);
    this.type({ kind: "chord", tick: Math.floor(this.song.context.cursor / bar) * bar });
  }

  // -------------------------------------------------------------------------
  // Annotations: on the Notes ruler, in lanes (roll/annotation-lanes.ts)

  saveAnnotation(id: string | null, tick: number, text: string): void {
    const clean = text.trim();
    const bar = barAt(this.song.meter, tick);
    if (id === null) {
      if (!clean) return;
      const end = barStart(this.song.meter, bar + 1);
      void this.run(this.h("hAnnotate", { text: clean, bar }), [{ type: "addAnnotation", spec: { start: tick, end, trackIds: [], text: clean } }]);
      return;
    }
    const a = this.song.annotations[id];
    if (!a) return;
    if (!clean) void this.run(this.h("hAnnotationRemove", { text: a.text }), [{ type: "removeAnnotation", id }]);
    else if (clean !== a.text) void this.run(this.h("hAnnotationEdit", { text: clean }), [{ type: "updateAnnotation", id, changes: { text: clean } }]);
  }

  formMenu(tick: number, x: number, y: number): void {
    const bar = barStart(this.song.meter, barAt(this.song.meter, tick));
    const close = (fn: () => void) => () => (this.editor.closeMenus(), fn());
    this.editor.openMenu(x, y, [
      { label: this.t("addAnnotation"), run: close(() => this.type({ kind: "annotation", id: null, tick: bar })) },
      { label: "", separator: true },
      ...this.tempoAddItems(this.beatAt(tick)),
      ...(bar > 0 ? [{ label: this.t("keyChangeHere"), run: close(() => this.keyChangeMenu(bar, x, y)) }] : []),
    ]);
  }

  annotationMenu(id: string, x: number, y: number): void {
    const a = this.song.annotations[id];
    if (!a) return;
    const close = (fn: () => void) => () => (this.editor.closeMenus(), fn());
    this.editor.openMenu(x, y, [
      { label: this.t("annotationEdit"), run: close(() => this.type({ kind: "annotation", id, tick: a.start })) },
      { label: this.t("annotationDelete"), run: close(() => this.saveAnnotation(id, a.start, "")) },
    ]);
  }

  activeTrackId(): string | null {
    return activeTrack(this.song)?.id ?? null;
  }

  sections() {
    return orderedSections(this.song);
  }
}

function soundOf(choice: Extract<SoundChoice, { kind: "bank" }>): TrackSound {
  return { bank: choice.bank.id, program: choice.preset.program, bankMSB: choice.preset.bankMSB, name: choice.preset.name };
}
