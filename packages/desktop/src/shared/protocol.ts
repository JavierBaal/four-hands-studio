/**
 * Messages between the window and the main process (ARQUITECTURA.md, 3).
 * The song lives in the main process; the window keeps a replica updated with patches and
 * sends every change as a list of commands (one gesture = one transaction = one undo step).
 */
import type { CommandData, CommandResult, HistoryEntry, Op, Patch, SharedContext, Song, SongDocument, StepState } from "@fourhands/core";
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
  /**
   * The last step, when an AI made it and its intervention has ended: "Con / Sin" lets the user
   * hear the song with and without it. Null once anything else is on top.
   */
  lastAi: { label: string; client: string; revision: number } | null;
  /** Pending proposals (H4, proposal mode): what each would do, to draw and hear it before accepting. */
  proposals?: ProposalInfo[];
  /** This session's steps, oldest first: what the history panel can go back or forward to. */
  steps?: StepState[];
  /** The revision the song had when it was opened: history entries up to it are from earlier sessions. */
  baseRevision?: number;
}

/** A pending proposal as the window receives it. */
export interface ProposalInfo {
  id: string;
  label: string;
  client: string;
  /** The user changed what it touches since: it can only be discarded. */
  stale: boolean;
  /** What accepting would do to the song (core operations). */
  ops: Op[];
}

/** What the window needs to draw the undo state (session and harness alike). */
export function undoStateOf(doc: SongDocument): UndoState {
  return { canUndo: doc.canUndo, canRedo: doc.canRedo, undoLabel: doc.undoLabel, redoLabel: doc.redoLabel, lastAi: lastAiOf(doc), proposals: proposalsOf(doc), steps: doc.steps, baseRevision: doc.baseRevision };
}

export function proposalsOf(doc: SongDocument): ProposalInfo[] {
  return doc.proposals.map((p) => ({ id: p.id, label: p.label, client: p.author.by === "ai" ? p.author.client : "", stale: p.stale, ops: structuredClone(p.ops) }));
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
  /** The history panel: back or forward to right after a step (its revision; 0, the song as opened). */
  | { type: "goTo"; revision: number }
  | { type: "setContext"; changes: Partial<SharedContext> }
  /** Proposal mode (H4): accept (the label goes to the history) or discard a pending proposal. */
  | { type: "acceptProposal"; id: string; label: string }
  | { type: "discardProposal"; id: string };

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

/** An intervention the AI finished (H4): what the activity panel lists, newest first. */
export interface AiRecent {
  id: string;
  name: string;
  description: string;
  added: number;
  changed: number;
  removed: number;
  trackIds: string[];
  start: number | null;
  end: number | null;
  /** When it closed (ms since the epoch). */
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
  /** The last interventions finished on this song since the app opened it (H4). */
  recent?: AiRecent[];
}

/** What "Con / Sin" can compare, as the window receives it. */
export function lastAiOf(doc: SongDocument): UndoState["lastAi"] {
  const step = doc.lastAiStep;
  return step && step.author.by === "ai" ? { label: step.label, client: step.author.client, revision: step.revision } : null;
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
  songBefore: "fh:song-before",
  aiTone: "fh:ai-tone",
  aiToneSet: "fh:ai-tone-set",
  aiApply: "fh:ai-apply",
  aiApplySet: "fh:ai-apply-set",
  midiOut: "fh:midi-out",
  midiOutSet: "fh:midi-out-set",
  exportMidi: "fh:export-midi",
  engineStatus: "fh:engine-status",
  engineStatusChanged: "fh:engine-status-changed",
  enginePlugins: "fh:engine-plugins",
  engineScanning: "fh:engine-scanning",
  engineLoad: "fh:engine-load",
  engineShow: "fh:engine-show",
  engineMidi: "fh:engine-midi",
  enginePanic: "fh:engine-panic",
  engineSounds: "fh:engine-sounds",
  engineMix: "fh:engine-mix",
  engineLevels: "fh:engine-levels",
  engineMeters: "fh:engine-meters",
  engineStats: "fh:engine-stats",
  engineInserts: "fh:engine-inserts",
  engineShowInsert: "fh:engine-show-insert",
  engineSetParam: "fh:engine-set-param",
  engineReductions: "fh:engine-reductions",
  engineTransport: "fh:engine-transport",
  builtinSounds: "fh:builtin-sounds",
  folders: "fh:folders",
  openFolder: "fh:open-folder",
  openTool: "fh:open-tool",
  pluginFolders: "fh:plugin-folders",
  pluginFoldersAdd: "fh:plugin-folders-add",
  pluginFoldersRemove: "fh:plugin-folders-remove",
  soundPrefs: "fh:sound-prefs",
  soundPrefsSet: "fh:sound-prefs-set",
} as const;

/** The user's folders (Ajustes › Carpetas). */
export type FolderKind = "songs" | "backups" | "sounds" | "skills";
export type Folders = Record<FolderKind, string>;
/** Ajustes › Avanzado: the test windows and the developer tools. */
export type ToolKind = "soundTest" | "blind" | "devTools";

/**
 * How the AI gives its opinions (Tu IA > Opiniones). Honesty is never optional: "gentle" says the
 * same problems, with more context and starting from what works.
 */
export type AiTone = "direct" | "gentle";
export const DEFAULT_AI_TONE: AiTone = "direct";

/** Tu IA > Lo que escribe (H4): straight into the song (default) or as a proposal. */
export type AiApply = "direct" | "proposal";
export const DEFAULT_AI_APPLY: AiApply = "direct";

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
export type MenuAction = "undo" | "redo" | "cut" | "copy" | "paste" | "duplicate" | "delete" | "selectAll" | "toggleAuthorship" | "togglePanel" | "zoomIn" | "zoomOut" | "zoomRowsIn" | "zoomRowsOut" | "resetLayout" | "skills" | "midiOut" | "settings" | "panelTrack" | "panelSounds" | "panelAi" | "showEditor" | "showMix";
