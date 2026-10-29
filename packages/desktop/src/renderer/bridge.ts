/**
 * The window's door to the main process (exposed by the preload as `window.fh`), plus an in-page
 * stand-in that runs the core directly, for the browser harness and the interface tests.
 */
import { ENGINE_OFF, type EngineLoadResult, type EngineMidiEvent, type EnginePlugin, type EnginePluginList, type EngineScanProgress, type EngineStatus, type PluginFolders } from "../shared/engine.js";
import { NO_SOUND_PREFS, type SoundPrefs } from "../shared/sound-catalog.js";
import { SongDocument, USER, runCommands, type Song } from "@fourhands/core";
import { type AiApply, type AiState, type AiTone, DEFAULT_AI_APPLY, DEFAULT_AI_TONE, type FileState, type FolderKind, type Folders, type MenuAction, type ToolKind, NO_AI, type PatchMessage, type Reply, type Request, type SkillCardInfo, type SkillImportResult, type Snapshot, type SoundBankInfo, type ViewInfo, undoStateOf } from "../shared/protocol.js";

export interface AppInfo {
  soundFont: string | null;
  locale: string;
  platform: string;
  versions: Record<string, string>;
}

export interface Bridge {
  info(): Promise<AppInfo>;
  snapshot(): Promise<Snapshot>;
  request(request: Request): Promise<Reply>;
  onPatch(listener: (message: PatchMessage) => void): () => void;
  onFile(listener: (state: FileState) => void): () => void;
  onReload(listener: () => void): () => void;
  onMenu(listener: (action: MenuAction) => void): () => void;
  soundFont(): Promise<ArrayBuffer | null>;
  log(entry: Record<string, unknown>): void;
  /** Sound banks the user installed (not the default one). */
  sounds(): Promise<SoundBankInfo[]>;
  soundBank(id: string): Promise<ArrayBuffer | null>;
  onSoundsChanged(listener: () => void): () => void;
  openSoundsFolder(): void;
  /** Copies dropped files into the sounds folder; gives the names copied. */
  importSounds(files: File[]): Promise<string[]>;
  openLink(url: string): void;
  /** The AI (H3): who is connected, reading, writing or pointing. */
  ai(): Promise<AiState>;
  onAiState(listener: (state: AiState) => void): () => void;
  /** "Cerrar intervención". */
  closeIntervention(id: string): void;
  /** The user went to (or dismissed) the AI's mark. */
  markSeen(id: string): void;
  /** What the user sees, for the AI's get_user_context. */
  viewInfo(info: ViewInfo): void;
  /** "Cómo conectarla": hands the extension to Claude Desktop. */
  connectClaude(): void;
  /** Ctrl+S: saves now, or asks where if the song still has its provisional name. */
  save(): void;
  /** Skills de la IA: every skill, on or off. */
  skills(): Promise<SkillCardInfo[]>;
  setSkillEnabled(name: string, on: boolean): Promise<SkillCardInfo[]>;
  /** Unpacks dropped skill ZIPs into the user's skills folder. */
  importSkills(files: File[]): Promise<SkillImportResult>;
  /** "Importar ZIP…": the system's open dialog, then the same import. */
  pickSkills(): Promise<SkillImportResult>;
  openSkillsFolder(): void;
  /** "Con / Sin": the song as it was before the last AI intervention (null if there is none to compare). */
  songBefore(): Promise<Song | null>;
  /** Tu IA > Opiniones: how the AI gives its opinions. */
  aiTone(): Promise<AiTone>;
  setAiTone(tone: AiTone): Promise<AiTone>;
  /** Tu IA > Lo que escribe (H4). */
  aiApply(): Promise<AiApply>;
  setAiApply(mode: AiApply): Promise<AiApply>;
  /** MIDI out (H4): the port chosen for the tracks that sound in another program. */
  midiOutPort(): Promise<string | null>;
  setMidiOutPort(name: string | null): Promise<string | null>;
  /** File > Export MIDI (to drag into the DAW and get its tracks with their names). */
  exportMidi(): void;
  /** The native engine (fase 2, prueba S2). */
  engineStatus(): Promise<EngineStatus>;
  onEngineStatus(listener: (status: EngineStatus) => void): () => void;
  /** The plugins the engine knows; `scan` looks for them on the computer first (slow). */
  enginePlugins(scan: boolean): Promise<EnginePluginList>;
  onEngineScanning(listener: (p: EngineScanProgress) => void): () => void;
  /** Loads a plugin into a slot; with the track, what it had loaded in this song comes back (F2.1). */
  engineLoad(slot: number, id: string, trackId?: string): Promise<EngineLoadResult>;
  /** Opens the plugin's own window. False if it has none (or is not loaded). */
  engineShow(slot: number): Promise<boolean>;
  engineMidi(events: EngineMidiEvent[]): void;
  enginePanic(): void;
  /** Ajustes › Carpetas. */
  folders(): Promise<Folders>;
  openFolder(kind: FolderKind): void;
  /** Ajustes › Avanzado. */
  openTool(kind: ToolKind): void;
  /** Ajustes › Plugins: where the engine looks. */
  pluginFolders(): Promise<PluginFolders>;
  /** The system's folder dialog; gives the folders after adding (unchanged if cancelled). */
  addPluginFolder(): Promise<PluginFolders>;
  removePluginFolder(dir: string): Promise<PluginFolders>;
  /** The Sonidos browser: favourites, recents, hidden plugins and moved categories. */
  soundPrefs(): Promise<SoundPrefs>;
  setSoundPrefs(prefs: SoundPrefs): Promise<SoundPrefs>;
}

export function windowBridge(): Bridge | null {
  return (window as unknown as { fh?: Bridge }).fh ?? null;
}

/** Runs the core inside the page, the way the main process would. */
export function memoryBridge(
  song: Song,
  options: {
    locale?: string;
    now?: () => number;
    name?: string;
    soundFont?: () => Promise<ArrayBuffer | null>;
    sounds?: SoundBankInfo[];
    soundBank?: (id: string) => Promise<ArrayBuffer | null>;
    skills?: SkillCardInfo[];
    /** Plugins of a pretend engine (interface tests); absent: the engine is "missing". */
    enginePlugins?: EnginePlugin[];
  } = {},
): Bridge & { doc: SongDocument; setAi(state: AiState): void; closed: string[]; engine: { loaded: Map<number, string>; midi: EngineMidiEvent[]; shown: number[] } } {
  const now = options.now ?? Date.now;
  const doc = new SongDocument(song, { now });
  const patchListeners = new Set<(m: PatchMessage) => void>();
  const fileListeners = new Set<(s: FileState) => void>();
  let historySent = 0;
  const file: FileState = { name: options.name ?? song.title, path: `/${song.title}.fourhands`, savedAt: now(), dirty: false, error: null, provisional: false };
  const undoState = () => undoStateOf(doc);
  doc.subscribe((patch) => {
    const history = doc.history.slice(historySent);
    historySent = doc.history.length;
    const message = { patch, history, ...undoState() };
    // Like IPC: delivered asynchronously.
    queueMicrotask(() => patchListeners.forEach((l) => l(structuredClone(message))));
  });
  let aiState: AiState = NO_AI;
  const aiListeners = new Set<(s: AiState) => void>();
  const closed: string[] = [];
  let skills: SkillCardInfo[] = structuredClone(options.skills ?? []);
  let tone: AiTone = DEFAULT_AI_TONE;
  let apply: AiApply = DEFAULT_AI_APPLY;
  let outPort: string | null = null;
  const fakePlugins = options.enginePlugins;
  const engineState: EngineStatus = fakePlugins ? { state: "ready", device: "Prueba · 48000 Hz", latency: 0.02, generation: 1 } : { ...ENGINE_OFF, state: "missing" };
  const engine = { loaded: new Map<number, string>(), midi: [] as EngineMidiEvent[], shown: [] as number[] };
  let pluginDirs: string[] = [];
  let soundPrefs: SoundPrefs = structuredClone(NO_SOUND_PREFS);
  const pluginState = (): PluginFolders => ({ system: ["C:\\Program Files\\Common Files\\VST3"], user: [...pluginDirs] });
  const on = <T>(set: Set<T>, l: T) => {
    set.add(l);
    return () => void set.delete(l);
  };
  return {
    doc,
    info: async () => ({ soundFont: null, locale: options.locale ?? "es-ES", platform: "browser", versions: {} }),
    snapshot: async () => ({ song: structuredClone(doc.song), history: [...doc.history], file: { ...file }, ...undoState() }),
    request: async (r: Request): Promise<Reply> => {
      try {
        switch (r.type) {
          case "run":
            return { ok: true, results: doc.transact({ actor: USER, label: r.label }, (tx) => runCommands(tx, r.commands)) };
          case "undo":
            doc.undo(USER);
            return { ok: true, results: [] };
          case "redo":
            doc.redo(USER);
            return { ok: true, results: [] };
          case "goTo":
            doc.goTo(r.revision, USER);
            return { ok: true, results: [] };
          case "setContext":
            doc.setContext(r.changes);
            return { ok: true, results: [] };
          case "acceptProposal":
            doc.acceptProposal(r.id, USER, r.label);
            return { ok: true, results: [] };
          case "discardProposal":
            doc.discardProposal(r.id);
            return { ok: true, results: [] };
        }
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },
    onPatch: (l) => on(patchListeners, l),
    onFile: (l) => on(fileListeners, l),
    onReload: () => () => {},
    onMenu: () => () => {},
    soundFont: options.soundFont ?? (async () => null),
    log: (entry) => console.log("[fh]", JSON.stringify(entry)),
    sounds: async () => structuredClone(options.sounds ?? []),
    soundBank: options.soundBank ?? (async () => null),
    onSoundsChanged: () => () => {},
    openSoundsFolder: () => console.log("[fh] open sounds folder"),
    importSounds: async (files) => files.map((f) => f.name).filter((n) => /\.sf[23]$/i.test(n)),
    openLink: (url) => console.log("[fh] open", url),
    ai: async () => structuredClone(aiState),
    onAiState: (l) => on(aiListeners, l),
    closeIntervention: (id) => {
      closed.push(id);
      aiState = { ...aiState, writing: aiState.writing.filter((w) => w.id !== id) };
      aiListeners.forEach((l) => l(structuredClone(aiState)));
    },
    markSeen: (id) => {
      if (aiState.mark?.id === id) aiState = { ...aiState, mark: null };
      aiListeners.forEach((l) => l(structuredClone(aiState)));
    },
    viewInfo: () => {},
    connectClaude: () => console.log("[fh] connect claude"),
    skills: async () => structuredClone(skills),
    setSkillEnabled: async (name, on) => {
      skills = skills.map((k) => (k.name === name ? { ...k, enabled: on } : k));
      return structuredClone(skills);
    },
    importSkills: async (files) => {
      const result: SkillImportResult = { added: [], failed: [] };
      for (const f of files) {
        const name = f.name.replace(/\.zip$/i, "").toLowerCase();
        if (!/\.zip$/i.test(f.name)) result.failed.push({ file: f.name, problem: "badZip" });
        else {
          const replaced = skills.some((k) => k.name === name && k.origin === "user");
          skills = [...skills.filter((k) => !(k.name === name && k.origin === "user")), { name, description: "Imported in the harness.", origin: "user", enabled: true, replacesBuiltIn: false, files: 0 }];
          result.added.push({ name, replaced });
        }
      }
      return result;
    },
    pickSkills: async () => ({ added: [], failed: [] }),
    openSkillsFolder: () => console.log("[fh] open skills folder"),
    songBefore: async () => (doc.lastAiStep ? doc.songBeforeLastStep() : null),
    aiTone: async () => tone,
    setAiTone: async (next) => (tone = next),
    aiApply: async () => apply,
    setAiApply: async (next) => (apply = next),
    midiOutPort: async () => outPort,
    setMidiOutPort: async (name) => (outPort = name),
    exportMidi: () => console.log("[fh] export MIDI"),
    engine,
    engineStatus: async () => ({ ...engineState }),
    onEngineStatus: () => () => {},
    enginePlugins: async () => (fakePlugins ? { plugins: structuredClone(fakePlugins), scannedAt: Date.UTC(2026, 9, 28, 19, 55) } : { plugins: [], error: "The engine is not built on this computer" }),
    onEngineScanning: () => () => {},
    engineLoad: async (slot, id) => {
      const p = fakePlugins?.find((x) => x.id === id);
      if (!p) return { ok: false, error: `Unknown plugin: ${id}` };
      engine.loaded.set(slot, id);
      return { ok: true, name: p.name };
    },
    engineShow: async (slot) => {
      engine.shown.push(slot);
      return engine.loaded.has(slot);
    },
    engineMidi: (events) => void engine.midi.push(...structuredClone(events)),
    enginePanic: () => {},
    folders: async () => ({ songs: "C:\\Users\\fran\\Documents\\Four Hands", backups: "C:\\Users\\fran\\AppData\\Roaming\\Four Hands Studio\\copias", sounds: "C:\\Users\\fran\\Documents\\Four Hands\\Sonidos", skills: "C:\\Users\\fran\\Documents\\Four Hands\\Skills" }),
    openFolder: (kind) => console.log("[fh] open folder", kind),
    openTool: (kind) => console.log("[fh] open tool", kind),
    pluginFolders: async () => pluginState(),
    addPluginFolder: async () => (pluginDirs.includes("D:\\VST3") || pluginDirs.push("D:\\VST3"), pluginState()),
    soundPrefs: async () => structuredClone(soundPrefs),
    setSoundPrefs: async (p) => (soundPrefs = structuredClone(p)),
    removePluginFolder: async (dir) => (pluginDirs = pluginDirs.filter((d) => d !== dir), pluginState()),
    save: () => {
      file.savedAt = now();
      for (const l of fileListeners) l({ ...file });
    },
    /** The harness plays the AI's side (scripts/capturas.mjs, scripts/interaccion.mjs). */
    setAi: (state) => {
      aiState = structuredClone(state);
      aiListeners.forEach((l) => l(structuredClone(aiState)));
    },
    closed,
  };
}
