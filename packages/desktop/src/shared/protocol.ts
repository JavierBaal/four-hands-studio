/**
 * Messages between the window and the main process (ARQUITECTURA.md, 3).
 * The song lives in the main process; the window keeps a replica updated with patches and
 * sends every change as a list of commands (one gesture = one transaction = one undo step).
 */
import type { CommandData, CommandResult, HistoryEntry, Patch, SharedContext, Song } from "@fourhands/core";

export interface FileState {
  /** File name without extension, for the title bar. */
  name: string;
  path: string;
  /** Last successful save, ms since the epoch. */
  savedAt: number | null;
  /** Changes not yet on disk. */
  dirty: boolean;
  /** Last save error, in English (the window shows its own text). */
  error: string | null;
}

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

export interface Snapshot extends UndoState {
  song: Song;
  history: HistoryEntry[];
  file: FileState;
}

export interface PatchMessage extends UndoState {
  patch: Patch;
  /** History entries added by this change. */
  history: HistoryEntry[];
}

export type Request =
  | { type: "run"; label: string; commands: CommandData[] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "setContext"; changes: Partial<SharedContext> };

export type Reply = { ok: true; results: CommandResult[] } | { ok: false; error: string };

/** IPC channel names. */
export const CH = {
  snapshot: "fh:snapshot",
  request: "fh:request",
  patch: "fh:patch",
  file: "fh:file",
  reload: "fh:reload",
  soundFont: "fh:soundfont",
  info: "fh:info",
  log: "fh:log",
  menu: "fh:menu",
} as const;

/** Menu commands handled by the window (edit and view actions live there). */
export type MenuAction = "undo" | "redo" | "cut" | "copy" | "paste" | "duplicate" | "delete" | "selectAll" | "toggleAuthorship" | "togglePanel" | "zoomIn" | "zoomOut";
