/**
 * The open song in the main process: the single source of truth (ARQUITECTURA.md, 3).
 *
 * - Holds the SongDocument and runs every change the window (and, from H3, the AI) asks for.
 * - Autosaves one second after the last change, writing a temporary file and renaming it.
 * - Keeps rotating backups (one every few minutes at most).
 * - Songs never saved by hand still live on disk, in Documents/Four Hands, with a provisional name.
 *
 * No Electron here, so it can be tested with plain Node.
 */
import fs from "node:fs";
import path from "node:path";
import {
  type CommandData,
  type CommandResult,
  type HistoryEntry,
  type Proposal,
  type SharedContext,
  type Song,
  SongDocument,
  USER,
  starterSong,
  exportMidi,
  importMidi,
  type PluginStates,
  parseSongFile,
  runCommands,
  serializeSong,
} from "@fourhands/core";
import { type FileState, type PatchMessage, type Reply, type Request, type Snapshot, type UndoState, undoStateOf } from "../shared/protocol.js";
import { backup, uniquePath, writeAtomic } from "./files.js";
import { packStates, unpackStates } from "./plugin-watch.js";

export const SONG_EXT = ".fourhands";

export interface SessionOptions {
  /** Where songs without a chosen place go: Documents/Four Hands. */
  songsDir: string;
  /** Where rotating backups go (app data). */
  backupsDir: string;
  /** Name for new songs ("Sin título" / "Untitled"). */
  untitledName: string;
  autosaveDelayMs?: number;
  backupEveryMs?: number;
  now?: () => number;
  onPatch?: (message: PatchMessage) => void;
  onFile?: (state: FileState) => void;
  /** A different song was loaded: the window must ask for a new snapshot. */
  onReload?: () => void;
  /**
   * F2.1: what each plugin has loaded now, by track (from the engine), asked for on every save.
   * Tracks it cannot answer for (the engine is off, the plugin is still loading) keep what the
   * file had.
   */
  collectPluginStates?: (song: Song) => Promise<PluginStates>;
  /** The plugin states could not go in the file: the song was saved without them (for the log). */
  onPluginStatesDropped?: (error: string) => void;
}

export class SongSession {
  private doc: SongDocument;
  private file: string;
  private dirty = false;
  private savedAt: number | null = null;
  private saveError: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private lastBackup = new Map<string, number>();
  private historySent = 0;
  private unsubscribe: () => void = () => {};
  private readonly patchListeners = new Set<(message: PatchMessage) => void>();
  private readonly now: () => number;
  /** What each plugin had loaded, as last read from the file or the engine (F2.1). */
  private pluginStates: PluginStates = {};

  private constructor(
    private readonly options: SessionOptions,
    doc: SongDocument,
    file: string,
  ) {
    this.now = options.now ?? Date.now;
    this.doc = doc;
    this.file = file;
    this.attach();
  }

  // -------------------------------------------------------------------------
  // Creating and opening

  /** A new empty song, already on disk under a provisional name. */
  static async createNew(options: SessionOptions): Promise<SongSession> {
    const file = uniquePath(options.songsDir, options.untitledName, SONG_EXT);
    const session = new SongSession(options, new SongDocument(starterSong(options.untitledName), { now: options.now ?? Date.now }), file);
    await session.saveNow();
    return session;
  }

  /** Opens a `.fourhands` song, or imports a MIDI file into a new song next to the others. */
  static async open(options: SessionOptions, source: string): Promise<SongSession> {
    const loaded = await loadSource(options, source);
    const session = new SongSession(options, loaded.doc, loaded.file);
    session.pluginStates = loaded.pluginStates;
    session.savedAt = loaded.imported ? null : session.now();
    if (loaded.imported) await session.saveNow();
    return session;
  }

  /** Replaces the open song (after flushing the current one). */
  async load(source: string): Promise<void> {
    const loaded = await loadSource(this.options, source);
    await this.flush();
    this.swap(loaded.doc, loaded.file);
    this.pluginStates = loaded.pluginStates;
    this.savedAt = loaded.imported ? null : this.now();
    if (loaded.imported) await this.saveNow();
    this.options.onReload?.();
    this.emitFile();
  }

  async newSong(): Promise<void> {
    await this.flush();
    const file = uniquePath(this.options.songsDir, this.options.untitledName, SONG_EXT);
    this.swap(new SongDocument(starterSong(this.options.untitledName), { now: this.now }), file);
    this.pluginStates = {};
    this.savedAt = null;
    await this.saveNow();
    this.options.onReload?.();
  }

  private swap(doc: SongDocument, file: string): void {
    this.unsubscribe();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.doc = doc;
    this.file = file;
    this.dirty = false;
    this.saveError = null;
    this.attach();
  }

  private attach(): void {
    this.historySent = this.doc.history.length;
    let revisionSent = this.doc.song.revision;
    this.unsubscribe = this.doc.subscribe((patch) => {
      let history = this.doc.history.slice(this.historySent);
      this.historySent = this.doc.history.length;
      // An AI intervention that grows keeps one history entry: it is replaced, not added.
      const replacesLast = history.length === 0 && patch.revision > revisionSent && this.doc.lastChangeMerged;
      if (replacesLast) history = this.doc.history.slice(-1);
      revisionSent = patch.revision;
      if (patch.ops.some((op) => op.path[0] !== "context") || history.length > 0) this.markDirty();
      const message: PatchMessage = { patch, history, ...this.undoState() };
      if (replacesLast) message.replacesLast = true;
      this.options.onPatch?.(message);
      for (const listener of this.patchListeners) listener(message);
    });
  }

  // -------------------------------------------------------------------------
  // What the window asks for

  get song(): Song {
    return this.doc.song;
  }

  /** The open song's document: the AI desk runs its transactions here (same command layer as the window). */
  get document(): SongDocument {
    return this.doc;
  }

  /** Every change, after the window has been told (the AI desk listens to protect the user's edits). */
  onPatch(listener: (message: PatchMessage) => void): () => void {
    this.patchListeners.add(listener);
    return () => this.patchListeners.delete(listener);
  }

  get history(): readonly HistoryEntry[] {
    return this.doc.history;
  }

  get path(): string {
    return this.file;
  }

  snapshot(): Snapshot {
    return { song: structuredClone(this.doc.song), history: [...this.doc.history], file: this.fileState(), ...this.undoState() };
  }

  handle(request: Request): Reply {
    try {
      switch (request.type) {
        case "run": {
          const results = this.doc.transact({ actor: USER, label: request.label }, (tx) => runCommands(tx, request.commands));
          return { ok: true, results };
        }
        case "undo":
          this.doc.undo(USER);
          return { ok: true, results: [] };
        case "redo":
          this.doc.redo(USER);
          return { ok: true, results: [] };
        case "goTo":
          this.doc.goTo(request.revision, USER);
          return { ok: true, results: [] };
        case "setContext":
          this.doc.setContext(request.changes as Partial<SharedContext>);
          return { ok: true, results: [] };
        case "acceptProposal":
          this.doc.acceptProposal(request.id, USER, request.label);
          return { ok: true, results: [] };
        case "discardProposal":
          this.doc.discardProposal(request.id);
          // The song does not change, but the file keeps pending proposals: save it.
          this.markDirty();
          return { ok: true, results: [] };
        default:
          return { ok: false, error: `Unknown request: ${(request as { type?: unknown }).type}` };
      }
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  /** Runs commands on behalf of the user and returns their results (throws on error). */
  run(label: string, commands: CommandData[]): CommandResult[] {
    const reply = this.handle({ type: "run", label, commands });
    if (!reply.ok) throw new Error(reply.error);
    return reply.results;
  }

  // -------------------------------------------------------------------------
  // Saving

  fileState(): FileState {
    const name = path.basename(this.file, SONG_EXT);
    const untitled = this.options.untitledName;
    const provisional = path.dirname(this.file) === this.options.songsDir && (name === untitled || name.startsWith(`${untitled} `));
    return { name, path: this.file, savedAt: this.savedAt, dirty: this.dirty, error: this.saveError, provisional };
  }

  /** "Con / Sin": the song without the last AI intervention, if it is still the last step. */
  songBefore(): Song | null {
    return this.doc.lastAiStep ? this.doc.songBeforeLastStep() : null;
  }

  private undoState(): UndoState {
    return undoStateOf(this.doc);
  }

  private markDirty(): void {
    const wasDirty = this.dirty;
    this.dirty = true;
    if (!wasDirty) this.emitFile();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.saveNow();
    }, this.options.autosaveDelayMs ?? 1000);
  }

  /** Saves now (waits for any save already running). */
  saveNow(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // A failed save must not stop the next ones: the chain never stays rejected.
    this.saving = this.saving.then(() => this.write()).catch((error) => {
      this.saveError = (error as Error).message;
      this.emitFile();
    });
    return this.saving;
  }

  /** Saves pending changes, if any. Call before quitting. */
  async flush(): Promise<void> {
    if (this.dirty || this.timer) await this.saveNow();
    else await this.saving;
  }

  /** The state of a track's plugin kept with the song, if it is that plugin's (F2.1). */
  pluginState(trackId: string, pluginId: string): string | null {
    const s = this.pluginStates[trackId];
    return s && s.id === pluginId ? s.data : null;
  }

  /** Something changed inside a plugin (its window): save it with the song soon. */
  pluginsChanged(): void {
    this.markDirty();
  }

  /** Only the tracks that still play that plugin keep a state; fresh ones replace old ones. */
  private async freshPluginStates(): Promise<PluginStates> {
    const song = this.doc.song;
    let fresh: PluginStates = {};
    try {
      fresh = (await this.options.collectPluginStates?.(song)) ?? {};
    } catch {
      // The engine did not answer: what the file had is kept.
    }
    const out: PluginStates = {};
    for (const [trackId, track] of Object.entries(song.tracks)) {
      if (!track.plugin) continue;
      const now = fresh[trackId];
      const before = this.pluginStates[trackId];
      if (now && now.id === track.plugin.id && now.data) out[trackId] = now;
      else if (before && before.id === track.plugin.id) out[trackId] = before;
    }
    this.pluginStates = out;
    return out;
  }

  private async write(): Promise<void> {
    const file = this.file;
    try {
      let pluginStates: PluginStates = {};
      try {
        pluginStates = await this.freshPluginStates();
      } catch {
        // Never lose the song for a plugin: without states it still saves.
      }
      let text: string;
      try {
        text = serializeSong({ song: this.doc.song, history: this.doc.historyForFile(), proposals: this.doc.proposals, pluginStates: packStates(pluginStates) });
      } catch (error) {
        // A plugin's state the file cannot hold must not stop the song from saving (29/10/2026:
        // every save failed in silence and a whole session was lost). Save the song without them.
        if (!Object.keys(pluginStates).length) throw error;
        this.options.onPluginStatesDropped?.((error as Error).message);
        text = serializeSong({ song: this.doc.song, history: this.doc.historyForFile(), proposals: this.doc.proposals });
      }
      const last = this.lastBackup.get(file);
      if (last === undefined || this.now() - last >= (this.options.backupEveryMs ?? 5 * 60_000)) {
        await backup(file, this.options.backupsDir, this.now());
        this.lastBackup.set(file, this.now());
      }
      await writeAtomic(file, text);
      this.dirty = false;
      this.savedAt = this.now();
      this.saveError = null;
    } catch (error) {
      this.saveError = (error as Error).message;
    }
    this.emitFile();
  }

  /** Saves the song in a new place; from then on it autosaves there. */
  async saveAs(target: string): Promise<void> {
    const file = target.endsWith(SONG_EXT) ? target : `${target}${SONG_EXT}`;
    await this.flush();
    this.file = file;
    await this.saveNow();
    if (this.saveError) throw new Error(this.saveError);
  }

  async exportMidi(target: string): Promise<void> {
    await writeAtomic(target, exportMidi(this.doc.song));
  }

  private emitFile(): void {
    this.options.onFile?.(this.fileState());
  }

  dispose(): void {
    this.unsubscribe();
    if (this.timer) clearTimeout(this.timer);
  }
}

async function loadSource(options: SessionOptions, source: string): Promise<{ doc: SongDocument; file: string; imported: boolean; pluginStates: PluginStates }> {
  const ext = path.extname(source).toLowerCase();
  const now = options.now ?? Date.now;
  if (ext === ".mid" || ext === ".midi") {
    const { song } = importMidi(new Uint8Array(await fs.promises.readFile(source)));
    const file = uniquePath(options.songsDir, path.basename(source, path.extname(source)), SONG_EXT);
    return { doc: new SongDocument(song, { now }), file, imported: true, pluginStates: {} };
  }
  const opened = parseSongFile(await fs.promises.readFile(source, "utf8"));
  return { doc: new SongDocument(opened.song, { now, history: opened.history, proposals: opened.proposals as Proposal[] }), file: source, imported: false, pluginStates: unpackStates(opened.pluginStates ?? {}) };
}
