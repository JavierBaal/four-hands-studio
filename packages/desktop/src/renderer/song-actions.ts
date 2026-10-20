/**
 * Song-level editing (PRD_MVP.md, 4.1–4.2): tracks and instruments, tempo, meter, key and title,
 * sections, chords and annotations. Every action is one command list (one undo step) with its
 * sentence in the history. Also holds which field is being typed into (one at a time).
 */
import { type CommandData, type Song, type Track, type TrackSound, barAt, barStart, barTicks, beatTicks, orderedSections, orderedTracks } from "@fourhands/core";
import type { AudioLayer } from "./audio-layer.js";
import type { SkillImportResult, SoundBankInfo } from "../shared/protocol.js";
import type { Bridge } from "./bridge.js";
import type { BankPreset } from "../shared/soundbank-info.js";
import type { Lang, Strings, Translate } from "../shared/i18n.js";
import { activeTrack } from "./context.js";
import type { Editor, MenuItem } from "./editor.js";
import { PALETTE, type PaletteItem, instrumentName, paletteName } from "../shared/instruments.js";
import { barRange, keyName } from "./music.js";
import type { Replica } from "./replica.js";
import { TRACK_PALETTE, trackColor, trackColorIndex } from "./theme.js";
import { parseDb, parsePan } from "../shared/mix.js";

/** What is being typed into right now. */
export type Typing =
  | { kind: "trackName"; id: string }
  | { kind: "trackVolume"; id: string }
  | { kind: "trackPan"; id: string }
  | { kind: "title" }
  | { kind: "tempo" }
  | { kind: "section"; id: string }
  | { kind: "chord"; tick: number }
  | { kind: "annotation"; id: string | null; tick: number };

/** What the palette gives: an instrument of the default bank, or a preset of an installed bank. */
export type SoundChoice = { kind: "default"; item: PaletteItem } | { kind: "bank"; bank: SoundBankInfo; preset: BankPreset };

/** At most 15 tracks: channel 16 is the metronome's. */
export const MAX_TRACKS = 15;

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
  /** The "Get more sounds" card is open. */
  soundsHelp = false;
  /** The "Skills de la IA" card is open. */
  skillsPanel = false;
  /** A short message at the bottom of the window, gone after a few seconds. */
  notice: string | null = null;
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
  ) {}

  openSkills(open: boolean): void {
    this.skillsPanel = open;
    if (open) {
      this.soundsHelp = false;
      this.editor.closeMenus();
    }
    this.changed();
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

  openSoundsHelp(open: boolean): void {
    this.soundsHelp = open;
    if (open) this.editor.closeMenus();
    this.changed();
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

  /** A free melodic channel (never 10, the drums, nor 16, the metronome). */
  private freeChannel(except?: string): number | null {
    const used = new Set(orderedTracks(this.song).filter((t) => t.id !== except).map((t) => t.channel));
    for (let ch = 0; ch < 15; ch++) if (ch !== 9 && !used.has(ch)) return ch;
    return null;
  }

  canAddTrack(): boolean {
    return this.song.trackOrder.length < MAX_TRACKS && this.freeChannel() !== null;
  }

  async addTrack(choice: SoundChoice): Promise<void> {
    const item = choice.kind === "default" ? choice.item : null;
    if (!this.canAddTrack() && item?.program !== null) return;
    let spec: { name: string; percussion?: boolean; program?: number; channel?: number; sound?: TrackSound };
    let name: string;
    if (choice.kind === "bank") {
      name = this.uniqueName(choice.preset.name);
      spec = { name, program: 0, channel: this.freeChannel()!, sound: soundOf(choice) };
    } else {
      name = this.uniqueName(paletteName(choice.item, this.lang));
      spec = choice.item.program === null ? { name, percussion: true } : { name, program: choice.item.program, channel: this.freeChannel()! };
    }
    const reply = await this.run(this.h("hTrackAdd", { name }), [{ type: "addTrack", spec }]);
    if (reply.ok) void this.replica.setContext({ activeTrackId: reply.results[0] as string, selection: [] });
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
    const changes: { program?: number | null; channel?: number; sound: TrackSound | null } = { sound: null };
    let inst: string;
    if (choice.kind === "bank") {
      inst = choice.preset.name;
      changes.sound = soundOf(choice);
      if (track.channel === 9) {
        const ch = this.freeChannel(id);
        if (ch === null) return;
        changes.channel = ch;
        changes.program = 0;
      }
    } else {
      const item = choice.item;
      inst = paletteName(item, this.lang);
      changes.program = item.program;
      if (item.program === null) changes.channel = 9;
      else if (track.channel === 9) {
        const ch = this.freeChannel(id);
        if (ch === null) return;
        changes.channel = ch;
      }
    }
    void this.run(this.h("hInstrument", { name: track.name, inst }), [{ type: "updateTrack", id, changes }]);
  }

  /** While a fader moves: only the sound changes (one undo step on release, with `setMix`). */
  previewMix(id: string, volume: number, pan: number): void {
    this.audio?.previewMix(id, volume, pan);
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

  setMix(id: string, volume: number, pan: number): void {
    const track = this.song.tracks[id];
    if (!track || (track.volume === volume && track.pan === pan)) return;
    void this.run(this.h("hMix", { name: track.name }), [{ type: "updateTrack", id, changes: { volume, pan } }]);
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
  paletteMenu(x: number, y: number, onPick: (choice: SoundChoice) => void, current?: Track): void {
    const t = this.t;
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
      { label: t("trackMenuInstrument"), run: () => this.paletteMenu(x, y, (item) => this.setInstrument(id, item), track) },
      { label: t("trackMenuMix"), run: () => this.openMixer(id, x, y) },
      { label: t("trackMenuColor"), swatch: trackColor(track.color), shortcut: "›", run: () => this.colorMenu(id, x, y) },
      { label: t("trackMenuRename"), run: close(() => this.type({ kind: "trackName", id })) },
      { separator: true },
      { label: t("trackMenuUp"), disabled: i <= 0, run: close(() => this.moveTrack(id, i - 1)) },
      { label: t("trackMenuDown"), disabled: i >= order.length - 1, run: close(() => this.moveTrack(id, i + 1)) },
      { separator: true },
      { label: t("trackMenuDelete"), disabled: order.length <= 1, run: close(() => this.removeTrack(id)) },
    ]);
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

  keyMenu(x: number, y: number): void {
    const k = this.song.key;
    const items: MenuItem[] = [];
    for (const mode of ["major", "minor"] as const) {
      items.push({ label: this.t(mode === "major" ? "keysMajor" : "keysMinor"), header: true });
      for (let fifths = -6; fifths <= 6; fifths++) {
        const key = { fifths, mode };
        const name = keyName(key, this.lang);
        items.push({
          label: name,
          active: k.fifths === fifths && k.mode === mode,
          run: () => {
            this.editor.closeMenus();
            if (k.fifths === fifths && k.mode === mode) return;
            void this.run(this.h("hKey", { key: name }), [{ type: "setSongProperties", props: { key } }]);
          },
        });
      }
    }
    this.editor.openMenu(x, y, items);
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
    this.editor.openMenu(x, y, [{ label: this.t("addAnnotation"), run: () => (this.editor.closeMenus(), this.type({ kind: "annotation", id: null, tick: bar })) }]);
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
