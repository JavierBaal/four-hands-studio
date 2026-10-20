/**
 * The window's door to the main process (exposed by the preload as `window.fh`), plus an in-page
 * stand-in that runs the core directly, for the browser harness and the interface tests.
 */
import { SongDocument, USER, runCommands, type Song } from "@fourhands/core";
import { type AiState, type AiTone, DEFAULT_AI_TONE, type FileState, type MenuAction, NO_AI, type PatchMessage, type Reply, type Request, type SkillCardInfo, type SkillImportResult, type Snapshot, type SoundBankInfo, type ViewInfo, lastAiOf } from "../shared/protocol.js";

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
  } = {},
): Bridge & { doc: SongDocument; setAi(state: AiState): void; closed: string[] } {
  const now = options.now ?? Date.now;
  const doc = new SongDocument(song, { now });
  const patchListeners = new Set<(m: PatchMessage) => void>();
  const fileListeners = new Set<(s: FileState) => void>();
  let historySent = 0;
  const file: FileState = { name: options.name ?? song.title, path: `/${song.title}.fourhands`, savedAt: now(), dirty: false, error: null, provisional: false };
  const undoState = () => ({ canUndo: doc.canUndo, canRedo: doc.canRedo, undoLabel: doc.undoLabel, redoLabel: doc.redoLabel, lastAi: lastAiOf(doc) });
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
          case "setContext":
            doc.setContext(r.changes);
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
