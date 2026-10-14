/**
 * The window's door to the main process (exposed by the preload as `window.fh`), plus an in-page
 * stand-in that runs the core directly, for the browser harness and the interface tests.
 */
import { SongDocument, USER, runCommands, type Song } from "@fourhands/core";
import type { FileState, MenuAction, PatchMessage, Reply, Request, Snapshot, SoundBankInfo } from "../shared/protocol.js";

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
  } = {},
): Bridge & { doc: SongDocument } {
  const now = options.now ?? Date.now;
  const doc = new SongDocument(song, { now });
  const patchListeners = new Set<(m: PatchMessage) => void>();
  const fileListeners = new Set<(s: FileState) => void>();
  let historySent = 0;
  const file: FileState = { name: options.name ?? song.title, path: `/${song.title}.fourhands`, savedAt: now(), dirty: false, error: null };
  const undoState = () => ({ canUndo: doc.canUndo, canRedo: doc.canRedo, undoLabel: doc.undoLabel, redoLabel: doc.redoLabel });
  doc.subscribe((patch) => {
    const history = doc.history.slice(historySent);
    historySent = doc.history.length;
    const message = { patch, history, ...undoState() };
    // Like IPC: delivered asynchronously.
    queueMicrotask(() => patchListeners.forEach((l) => l(structuredClone(message))));
  });
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
  };
}
