/**
 * Messages between the window and the main process (ARQUITECTURA.md, 3).
 * The song lives in the main process; the window keeps a replica updated with patches and
 * sends every change as a list of commands (one gesture = one transaction = one undo step).
 */
import type { CommandData, CommandResult, HistoryEntry, Patch, SharedContext, Song } from "@fourhands/core";
import type { BankPreset } from "./soundbank-info.js";

/** A sound bank the user installed (sound-library.ts). */
export interface SoundBankInfo {
  /** File name: what a track stores to find it again. */
  id: string;
  name: string;
  presets: BankPreset[];
  bytes: number;
  /** In Documentos\Four Hands\Sonidos (not in the project's folder). */
  inUserFolder: boolean;
}

export interface FileState {
  /** File name without extension, for the title bar. */
  name: string;
  path: string;
  /** Last successful save, ms since the epoch. */
  savedAt: number | null;
  /** Changes not yet on disk. */
  dirty: boolean;
  /** Still under its provisional name ("Sin título 2"): Ctrl+S asks where to save it. */
  provisional: boolean;
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
  /** The only entry in `history` replaces the last one (an AI intervention that keeps growing). */
  replacesLast?: boolean;
}

export type Request =
  | { type: "run"; label: string; commands: CommandData[] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "setContext"; changes: Partial<SharedContext> };

export type Reply = { ok: true; results: CommandResult[] } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// The AI (H3): what the window shows of it (DIRECCION_ARTISTICA.md, 11; capture 07)

/** An AI connected through a bridge. */
export interface AiClientInfo {
  /** Name its MCP client sends (`claude-ai`, `local-agent-mode-…`): what the history signs with. */
  client: string;
  /** Name the user reads: "Claude". */
  name: string;
}

/** An intervention in progress: the AI is writing. Positions in ticks, for the window only. */
export interface AiWriting {
  id: string;
  name: string;
  description: string;
  /** Notes written so far (added, changed or removed). */
  notes: number;
  trackIds: string[];
  start: number | null;
  end: number | null;
}

/** A place the AI points the user to (point_to). It never moves the view. */
export interface AiMark {
  id: string;
  name: string;
  start: number;
  end: number;
  trackIds: string[];
  noteIds: string[];
  reason: string;
  at: number;
}

export interface AiState {
  clients: AiClientInfo[];
  /** An AI read the song in the last seconds. */
  reading: string | null;
  writing: AiWriting[];
  mark: AiMark | null;
  /** Skills an AI loaded since the app opened (the skills panel marks them). */
  skillsUsed?: string[];
}

export const NO_AI: AiState = { clients: [], reading: null, writing: [], mark: null };

/** What the window tells the main process about what the user sees, for get_user_context. */
export interface ViewInfo {
  noteNames: "solfege" | "letters";
  authorship: boolean;
  visible: { start: number; end: number } | null;
}

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
  sfList: "fh:sf-list",
  sfLoad: "fh:sf-load",
  sounds: "fh:sounds",
  soundBank: "fh:sound-bank",
  soundsChanged: "fh:sounds-changed",
  soundsFolder: "fh:sounds-folder",
  soundsImport: "fh:sounds-import",
  openLink: "fh:open-link",
  ai: "fh:ai",
  aiState: "fh:ai-state",
  aiClose: "fh:ai-close",
  aiMarkSeen: "fh:ai-mark-seen",
  viewInfo: "fh:view-info",
  connectClaude: "fh:connect-claude",
  save: "fh:save",
  skills: "fh:skills",
  skillsEnable: "fh:skills-enable",
  skillsImport: "fh:skills-import",
  skillsPick: "fh:skills-pick",
  skillsFolder: "fh:skills-folder",
} as const;

/** A skill as the window shows it (Skills de la IA). */
export interface SkillCardInfo {
  name: string;
  description: string;
  origin: "built-in" | "user";
  enabled: boolean;
  replacesBuiltIn: boolean;
  files: number;
}

/** The result of importing ZIPs: the skills added, and the files that were not skills (with why). */
export interface SkillImportResult {
  added: { name: string; replaced: boolean }[];
  failed: { file: string; problem: "badZip" | "noSkill" | "noName" | "tooBig" | "unreadable" }[];
}

/** Menu commands handled by the window (edit and view actions live there). */
export type MenuAction = "undo" | "redo" | "cut" | "copy" | "paste" | "duplicate" | "delete" | "selectAll" | "toggleAuthorship" | "togglePanel" | "zoomIn" | "zoomOut" | "zoomRowsIn" | "zoomRowsOut" | "resetLayout" | "skills";
