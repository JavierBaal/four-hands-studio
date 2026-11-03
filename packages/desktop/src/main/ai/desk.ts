/**
 * The AI's hand (milestone H3; ESQUEMA_MCP.md; ARQUITECTURA.md, 6).
 *
 * Answers every tool call of every connected AI on the open song, through the same command layer
 * as the window. No Electron and no network here: the WebSocket server (server.ts) only carries
 * messages, so all of this is tested with plain Node.
 *
 * - Reading tools answer in compact text (no structuredContent).
 * - Writing happens inside an intervention: begin, write, end. Each call is applied at once, so the
 *   user sees it live, and all of them form one undo step (SongDocument groups).
 * - An intervention closes by itself after 5 minutes without calls, and the user can close it.
 * - Notes the user changed after the revision the AI read are protected: the write is refused and
 *   the answer says what changed (ESQUEMA_MCP.md, 5.2).
 * - Several AIs can be connected at once; each one has at most one open intervention.
 *
 * H3 applies changes directly. Proposal mode (H4, off by default: Tu IA > Lo que escribe) only
 * changes what closing does: the intervention leaves the song and waits as a proposal.
 */
import type { EngineLevels, EngineLoad } from "../../shared/mix.js";
import { levelsText } from "./texts.js";
import { type ChainTarget, type Insert, type InsertKind, type InsertSpec, OWN_EFFECTS, addInsert, chainOf, findInsert, insertName, moveInsert, paramDefs, paramText, removeInsert, updateInsert } from "@fourhands/core";
import { TRACK_PALETTE, trackColorByName, trackColorId } from "../../shared/track-colors.js";
import {
  type Authorship,
  CommandError,
  type NoteChange,
  type NoteSpec,
  type PedalSpan,
  type Song,
  PPQ,
  type Transaction,
  type TrackSound,
  MusicError,
  addAnnotation,
  addNotes,
  addSection,
  addTrack,
  analysisText,
  removeAnnotation,
  updateAnnotation,
  ai,
  barStart,
  beatTicks,
  deleteNotes,
  formatNote,
  formatPosition,
  formatNotes,
  lines,
  nominalDuration,
  nominalGridPosition,
  notesInRange,
  orderedTracks,
  parseChordPosition,
  parseDuration,
  parseKey,
  parseMeter,
  parseNewNotes,
  parseNoteEdits,
  parseNoteTokens,
  parsePosition,
  parseShift,
  removeSection,
  resolveRange,
  setChord,
  setPedal,
  setSongProperties,
  setKeyChanges,
  setTempoChanges,
  parseTempoChanges,
  parseKeyChanges,
  tempoChangesText,
  keyChangesText,
  keyAt,
  secondsAt,
  songEnd,
  transposeByDegrees,
  updateNotes,
  updateSection,
  updateTrack,
  moveTrack,
  removeTrack,
  changesText,
  historyLine,
  summaryText,
  curveText,
  rampPoints,
  setCurve,
  type CurveKind,
  CURVE_KINDS,
  nextChannel,
} from "@fourhands/core";
import { NAMED_PROGRAMS, PALETTE } from "../../shared/instruments.js";
import type { AiApply, AiClientInfo, AiMark, AiRecent, AiState, AiTone, AiWriting, PatchMessage, SoundBankInfo } from "../../shared/protocol.js";
import type { SongSession } from "../session.js";
import type { EnginePlugin } from "../../shared/engine.js";
import type { BankPreset } from "../../shared/soundbank-info.js";
import { SkillError, type SkillSource, skillText, skillsFooter, skillsListText } from "./skills.js";
import { DEFAULT_WINDOW, type WindowInfo, bankText, chainText, effectText, instrumentsText, mixText, overviewText, paletteItem, spanText, userContextText } from "./texts.js";

export type ToolReply = { ok: true; text: string } | { ok: false; error: string };

/** A plugin's parameter as the engine reads it (F2.2 parte C). */
export interface EffectParam {
  index: number;
  name: string;
  text: string;
  label: string;
  /** Normalised, 0–1. */
  value: number;
}

export interface AiDeskOptions {
  /** The open song (it changes when the user opens another one). */
  session: () => SongSession;
  banks?: () => SoundBankInfo[];
  /** The default bank's presets with their profiles, for the built-in palette. */
  builtInSounds?: () => BankPreset[];
  /** Instrument plugins the engine found on this computer (fase 2), for sound 'plugin / <name>'. */
  plugins?: () => EnginePlugin[];
  /** Built-in and user skills (ESTUDIO_SKILLS.md, 3). */
  skills?: SkillSource;
  /** F2.2: what the engine measured in the last playback (the window asks it when playback stops). */
  /** The last playback's levels, and the strip each track had then (A2). */
  levels?: () => { levels: EngineLevels; at: number; strips?: Record<string, number> } | null;
  /** F2.2 parte B: the engine's last load reading (for get_levels), null without engine. */
  load?: () => EngineLoad | null;
  /**
   * F2.2 parte C: a plugin effect's parameters (null: the engine is not running or does not have it),
   * and setting one by its value text (what it reads after, and its normalised value).
   */
  effectParams?: (insertId: string) => Promise<EffectParam[] | null>;
  setEffectParam?: (insertId: string, index: number, text: string) => Promise<{ ok: boolean; text: string; value: number } | null>;
  now?: () => number;
  /** 5 minutes (ESQUEMA_MCP.md, 5.1). */
  autoCloseMs?: number;
  /** How long "reading the song" shows after a read. */
  readingMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onState?: (state: AiState) => void;
  /** Tu IA > Opiniones: how the user wants opinions given. */
  tone?: () => AiTone;
  /** Tu IA > Lo que escribe (H4): straight in (default) or as a proposal the user accepts. */
  apply?: () => AiApply;
  log?: (entry: Record<string, unknown>) => void;
}

/** A2 (03/11/2026): as in the window (song-actions.ts); before, 15, one per MIDI channel. */
const MAX_TRACKS = 500;
const PAGE_NOTES = 800;
const SNAPSHOTS_MAX = 12;
/** Calls after which the AI has seen everything that changed. */
const SEES_EVERYTHING = new Set(["get_changes_since", "get_song_overview"]);
const RECENT_MAX = 6;

interface Intervention {
  id: string;
  /** The AI client that opened it: only it writes in it. */
  owner: string;
  author: Authorship;
  description: string;
  base: number;
  openedAt: number;
  timer: unknown;
  added: number;
  changed: number;
  removed: number;
  other: string[];
  trackIds: Set<string>;
  start: number | null;
  end: number | null;
  closed: null | { how: "ai" | "user" | "timeout" | "song"; revision: number; proposal?: boolean };
  /** The first note id this intervention can create (ids only grow): to tell its own notes apart. */
  firstNote: number;
  /** Notes of earlier interventions this one changed or removed, by intervention (the corrections log, H4). */
  corrects: Map<string, number>;
}

interface Connection {
  id: string;
  client: string;
  name: string;
}

/** "claude-ai" → "Claude"; "local-agent-mode-Four Hands Studio" → "Claude"; anything else as it comes. */
export function displayName(client: string, title?: string): string {
  if (/^claude|^local-agent-mode/i.test(client)) return "Claude";
  return title?.trim() || client || "IA";
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function parseRevision(text: string | undefined): number | null {
  if (text === undefined) return null;
  const m = /^\s*r?(\d+)\s*$/i.exec(text);
  return m ? Number(m[1]) : NaN;
}

export class AiDesk {
  private readonly connections = new Map<string, Connection>();
  private readonly interventions = new Map<string, Intervention>();
  /**
   * Which intervention wrote each note, for notes written in this session (H4, the corrections log:
   * "qué intervención corrige a cuál", to measure whether the skills reduce corrections).
   */
  private readonly noteOrigin = new Map<string, string>();
  /** Notes the user changed or deleted, with the revision of that change. */
  private readonly userTouched = new Map<string, number>();
  private window: WindowInfo = DEFAULT_WINDOW;
  private mark: AiMark | null = null;
  private reading: { name: string; timer: unknown } | null = null;
  private markSeq = 0;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private unsubscribe: () => void = () => {};

  constructor(private readonly options: AiDeskOptions) {
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.watch();
  }

  private get session(): SongSession {
    return this.options.session();
  }

  private get song(): Song {
    return this.session.song;
  }

  /** Follows the song's changes to protect what the user edits (ESQUEMA_MCP.md, 5.2). */
  private watch(): void {
    this.unsubscribe();
    this.unsubscribe = this.session.onPatch((m) => this.onPatch(m));
  }

  private onPatch(m: PatchMessage): void {
    if (!m.history.some((h) => h.actor.by === "user")) return;
    for (const op of m.patch.ops) if (op.path[0] === "notes" && op.path[1]) this.userTouched.set(op.path[1], m.patch.revision);
  }

  /** A different song was opened: everything about the previous one is forgotten. */
  songChanged(): void {
    for (const iv of this.interventions.values()) if (!iv.closed) this.close(iv, "song");
    this.seen.clear();
    this.snapshots.clear();
    this.recent = [];
    this.interventions.clear();
    this.noteOrigin.clear();
    this.userTouched.clear();
    this.mark = null;
    this.watch();
    this.emit();
  }

  setWindow(info: WindowInfo): void {
    this.window = info;
  }

  // -------------------------------------------------------------------------
  // Connections

  connect(id: string, client: string, title?: string): void {
    this.connections.set(id, { id, client: client || "unknown", name: displayName(client, title) });
    this.options.log?.({ type: "ai_connected", connection: id, client });
    this.emit();
  }

  disconnect(id: string): void {
    const c = this.connections.get(id);
    this.connections.delete(id);
    if (c) this.options.log?.({ type: "ai_disconnected", connection: id, client: c.client });
    this.emit();
  }

  state(): AiState {
    const clients = new Map<string, AiClientInfo>();
    for (const c of this.connections.values()) clients.set(c.client, { client: c.client, name: c.name });
    const writing: AiWriting[] = [];
    for (const iv of this.interventions.values()) {
      if (iv.closed) continue;
      writing.push({
        id: iv.id,
        name: this.nameOf(iv.owner),
        description: iv.description,
        notes: iv.added + iv.changed + iv.removed,
        trackIds: [...iv.trackIds],
        start: iv.start,
        end: iv.end,
      });
    }
    return { clients: [...clients.values()], reading: this.reading?.name ?? null, writing, mark: this.mark, skillsUsed: [...this.skillsUsed], recent: [...this.recent] };
  }

  private nameOf(client: string): string {
    for (const c of this.connections.values()) if (c.client === client) return c.name;
    return displayName(client);
  }

  private emit(): void {
    this.options.onState?.(this.state());
  }

  /** The user went to the mark (or dismissed it). */
  markSeen(id: string): void {
    if (this.mark?.id === id) {
      this.mark = null;
      this.emit();
    }
  }

  // -------------------------------------------------------------------------
  // Calls

  /**
   * F2.2 parte C: tools that wait for the engine (a plugin effect's parameters). The others answer at
   * once through `call`.
   */
  async callAsync(connectionId: string, tool: string, rawArgs: unknown): Promise<ToolReply> {
    const asyncHandler = this.asyncHandlers[tool];
    if (!asyncHandler) return this.call(connectionId, tool, rawArgs);
    const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;
    let text: string;
    try {
      text = await asyncHandler(this.connections.get(connectionId) ?? { id: connectionId, client: "unknown", name: "IA" }, args);
    } catch (error) {
      return this.call(connectionId, tool, rawArgs, error);
    }
    return this.call(connectionId, tool, rawArgs, undefined, text);
  }

  call(connectionId: string, tool: string, rawArgs: unknown, failed?: unknown, answered?: string): ToolReply {
    const conn = this.connections.get(connectionId) ?? { id: connectionId, client: "unknown", name: "IA" };
    const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;
    const handler = answered !== undefined || failed !== undefined ? () => {
      if (failed !== undefined) throw failed;
      return answered!;
    } : this.handlers[tool];
    const started = this.now();
    let reply: ToolReply;
    if (!handler) reply = { ok: false, error: `Four Hands does not know the tool '${tool}'. Update the connection with Claude from Four Hands.` };
    else {
      try {
        reply = { ok: true, text: handler(conn, args) };
      } catch (error) {
        if (error instanceof MusicError || error instanceof CommandError) {
          const message = error.message.replace(/\.?$/, ".");
          reply = { ok: false, error: /Nothing was (written|changed)/.test(message) || READ_TOOLS.has(tool) ? message : `${message} Nothing was written.` };
        } else {
          this.options.log?.({ type: "ai_tool_crashed", tool, error: String((error as Error)?.stack ?? error) });
          reply = { ok: false, error: `Four Hands could not do that (${(error as Error)?.message ?? error}). Nothing was written.` };
        }
      }
    }
    this.options.log?.({
      type: "ai_call",
      client: conn.client,
      tool,
      ok: reply.ok,
      ms: this.now() - started,
      chars: reply.ok ? reply.text.length : 0,
      ...(reply.ok ? {} : { error: reply.error }),
    });
    // "Reading the song": not for pointing, nor for loading skills, which don't read the song.
    if (READ_TOOLS.has(tool) && !NOT_READING_THE_SONG.has(tool)) this.showReading(conn.name);
    this.remember(conn.client, tool);
    return reply;
  }

  /**
   * The song as this AI client last saw it, for get_changes_since and the "changed since your last
   * call" line of get_user_context. It moves on when the AI reads the whole picture
   * (get_changes_since, get_song_overview), and when it writes with nothing unseen in between;
   * reading a few bars or the user context does not count as having seen the user's changes.
   */
  private remember(client: string, tool: string): void {
    const song = this.song;
    const seen = this.seen.get(client);
    if (seen?.revision === song.revision) return;
    if (seen && !SEES_EVERYTHING.has(tool)) {
      if (READ_TOOLS.has(tool)) return;
      const unseen = this.historySince(seen.revision).some((h) => !(h.actor.by === "ai" && h.actor.client === client));
      if (unseen) return;
    }
    const copy = this.snapshots.get(song.revision) ?? structuredClone(song);
    this.seen.set(client, copy);
    this.snapshots.set(song.revision, copy);
    while (this.snapshots.size > SNAPSHOTS_MAX) this.snapshots.delete(this.snapshots.keys().next().value!);
  }

  /** get_user_context: has anyone else changed the song since this client's last call? */
  private changedLine(client: string): string | null {
    const seen = this.seen.get(client);
    if (!seen) return null;
    const others = this.historySince(seen.revision).filter((h) => !(h.actor.by === "ai" && h.actor.client === client));
    if (!others.length) return "Since your last call: nothing changed.";
    const labels = others.slice(-3).map((h) => (h.kind === "edit" ? h.label : `${h.kind === "undo" ? "undid" : "redid"}: ${h.label}`));
    const by = others.every((h) => h.actor.by === "user") ? "the user" : "the user or another AI";
    return `Since your last call (r${seen.revision}): ${others.length} change${others.length === 1 ? "" : "s"} by ${by} (${labels.join("; ")}${others.length > 3 ? "; …" : ""}). Call get_changes_since before writing.`;
  }

  /** read_notes: the expression and modulation curves of the tracks shown, inside the range. */
  private curvesFor(song: Song, start: number, end: number, trackIds: readonly string[] | undefined): string {
    const out: string[] = [];
    for (const id of trackIds ?? song.trackOrder) {
      const t = song.tracks[id];
      for (const kind of CURVE_KINDS) {
        const text = curveText(song, t?.curves?.[kind] ?? [], start, end);
        if (text) out.push(`${t!.name} (${id}) ${kind === "expression" ? "expression CC11" : "modulation CC1"}: ${text}`);
      }
    }
    return out.length ? `\nCurves (each value holds until the next):\n${out.join("\n")}` : "";
  }

  /** History entries after a revision, oldest first. */
  private historySince(revision: number) {
    return this.session.document.history.filter((h) => h.revision > revision);
  }

  private showReading(name: string): void {
    if (this.reading) this.clearTimer(this.reading.timer);
    this.reading = { name, timer: this.setTimer(() => ((this.reading = null), this.emit()), this.options.readingMs ?? 3000) };
    this.emit();
  }

  // -------------------------------------------------------------------------
  // Helpers shared by the tools

  /** The song as each AI client last saw it, and recent copies by revision (get_changes_since). */
  private readonly seen = new Map<string, Song>();
  private readonly snapshots = new Map<number, Song>();
  /** Interventions finished on this song, newest first (the activity panel lists them). */
  private recent: AiRecent[] = [];

  /** Skills loaded since the app opened (shown in the skills panel). */
  private readonly skillsUsed = new Set<string>();

  private skillList() {
    try {
      return this.options.skills?.list() ?? [];
    } catch (error) {
      this.options.log?.({ type: "skills_unreadable", error: String(error) });
      return [];
    }
  }

  private str(args: Record<string, unknown>, key: string, required = true): string | undefined {
    const v = args[key];
    if (v === undefined || v === null || v === "") {
      if (required) throw new MusicError(`Missing '${key}'`);
      return undefined;
    }
    if (typeof v !== "string") throw new MusicError(`'${key}' must be text`);
    return v;
  }

  private num(args: Record<string, unknown>, key: string): number | undefined {
    const v = args[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v)) throw new MusicError(`'${key}' must be a number`);
    return v;
  }

  private strings(args: Record<string, unknown>, key: string): string[] | undefined {
    const v = args[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v === "string") return v.split(/[\s,]+/).filter(Boolean);
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new MusicError(`'${key}' must be a list of texts`);
    return v as string[];
  }

  /** A track by id ("t3") or by name ("Violines", "violines", "Viol"). */
  private track(text: string): string {
    const song = this.song;
    if (song.tracks[text.trim()]) return text.trim();
    const key = fold(text);
    const tracks = orderedTracks(song);
    const exact = tracks.filter((t) => fold(t.name) === key);
    const found = exact.length ? exact : tracks.filter((t) => fold(t.name).startsWith(key) && key.length > 0);
    if (found.length === 1) return found[0]!.id;
    const list = tracks.map((t) => `${t.id} ${t.name}`).join(", ");
    if (found.length > 1) throw new MusicError(`'${text}' could be several tracks (${found.map((t) => `${t.id} ${t.name}`).join(", ")}): use the id`);
    throw new MusicError(`There is no track '${text}'. ${list ? `Tracks: ${list}` : "The song has no tracks: create one with add_track"}`);
  }

  private tracks(args: Record<string, unknown>, key = "tracks"): string[] | undefined {
    const list = this.strings(args, key);
    return list && list.length ? list.map((t) => this.track(t)) : undefined;
  }

  /** Notes chosen by note_ids, or by range (and tracks). */
  private targets(args: Record<string, unknown>): string[] {
    const ids = this.strings(args, "note_ids");
    if (ids && ids.length) {
      for (const id of ids) if (!this.song.notes[id] && !this.userTouched.has(id)) throw new MusicError(`There is no note ${id}. Read the notes again with read_notes`);
      return [...new Set(ids)];
    }
    const rangeText = this.str(args, "range", false);
    if (!rangeText) throw new MusicError("Say which notes: note_ids, or range (and tracks)");
    const range = resolveRange(this.song, rangeText);
    const trackIds = this.tracks(args);
    const found = notesInRange(this.song, range, trackIds);
    if (found.length === 0) {
      const on = trackIds ? ` in ${trackIds.map((t) => this.song.tracks[t]!.name).join(", ")}` : "";
      throw new MusicError(`There are no notes in ${range.label}${on}`);
    }
    return found;
  }

  /** Refuses notes the user changed after the revision the AI read (ESQUEMA_MCP.md, 5.2). */
  private guard(iv: Intervention, ids: readonly string[], args: Record<string, unknown>): void {
    const given = parseRevision(this.str(args, "base_revision", false));
    if (Number.isNaN(given)) throw new MusicError("base_revision is a revision like 'r1532'");
    const base = Math.max(iv.base, given ?? iv.base);
    const song = this.song;
    for (const id of ids) {
      const touched = this.userTouched.get(id);
      const note = song.notes[id];
      if (!note) {
        if (touched !== undefined && touched > base) throw new MusicError(`The user deleted ${id} after r${base}. Read the notes again with read_notes`);
        throw new MusicError(`There is no note ${id}. Read the notes again with read_notes`);
      }
      if (touched !== undefined && touched > base) {
        throw new MusicError(`${id} has changed since r${base} (the user made it: ${formatNote(song, note)}). Read it again with read_notes; then pass base_revision`);
      }
    }
  }

  private intervention(conn: Connection, args: Record<string, unknown>): Intervention {
    const id = this.str(args, "intervention_id")!.trim();
    const iv = this.interventions.get(id);
    if (!iv) {
      const mine = this.openOf(conn.client);
      throw new MusicError(`There is no intervention ${id}.${mine ? ` Your open intervention is ${mine.id}.` : " Start one with begin_intervention."}`);
    }
    if (iv.owner !== conn.client) throw new MusicError(`Intervention ${id} belongs to another AI. Start your own with begin_intervention`);
    if (iv.closed) {
      const why =
        iv.closed.how === "user"
          ? "The user closed it"
          : iv.closed.how === "timeout"
            ? "It closed by itself after 5 minutes without calls"
            : iv.closed.how === "song"
              ? "The user opened another song"
              : "You closed it";
      throw new MusicError(`Intervention ${id} is closed. ${why}; what you wrote is already in the song. Start another with begin_intervention`);
    }
    this.clearTimer(iv.timer);
    iv.timer = this.setTimer(() => this.close(iv, "timeout"), this.options.autoCloseMs ?? 5 * 60_000);
    return iv;
  }

  private openOf(client: string): Intervention | undefined {
    for (const iv of this.interventions.values()) if (iv.owner === client && !iv.closed) return iv;
    return undefined;
  }

  /** Runs a write as part of the intervention: live, and joined to its undo step. */
  private write<T>(iv: Intervention, fn: (tx: Transaction) => T): T {
    const doc = this.session.document;
    return doc.transact({ actor: iv.author, label: iv.description, group: iv.id }, fn);
  }

  /** Records what a write touched, for the window ("Claude escribe en Chelos, c. 17–20") and end_intervention. */
  private touched(iv: Intervention, noteIds: readonly string[], counts: { added?: number; changed?: number; removed?: number }, before?: Map<string, { start: number; end: number; trackId: string }>): void {
    iv.added += counts.added ?? 0;
    iv.changed += counts.changed ?? 0;
    iv.removed += counts.removed ?? 0;
    const song = this.song;
    for (const id of noteIds) {
      // Corrections log: a note another intervention wrote, changed or removed by this one.
      const origin = this.noteOrigin.get(id);
      if (origin && origin !== iv.id) iv.corrects.set(origin, (iv.corrects.get(origin) ?? 0) + 1);
      else if (!origin && song.notes[id] && Number(id.slice(1)) >= iv.firstNote) this.noteOrigin.set(id, iv.id);
      const n = song.notes[id] ?? before?.get(id);
      if (!n) continue;
      const start = n.start;
      const end = "duration" in n ? n.start + n.duration : n.end;
      iv.trackIds.add(n.trackId);
      iv.start = iv.start === null ? start : Math.min(iv.start, start);
      iv.end = iv.end === null ? end : Math.max(iv.end, end);
    }
    this.emit();
  }

  private span(iv: Intervention, start: number, end: number, trackId?: string): void {
    if (trackId) iv.trackIds.add(trackId);
    iv.start = iv.start === null ? start : Math.min(iv.start, start);
    iv.end = iv.end === null ? end : Math.max(iv.end, end);
  }

  private close(iv: Intervention, how: NonNullable<Intervention["closed"]>["how"]): void {
    if (iv.closed) return;
    this.clearTimer(iv.timer);
    if (how !== "song") this.session.document.closeGroup(iv.id);
    // Proposal mode: what it wrote leaves the song and waits for the user (if it can: see liftLastStep).
    const proposal = how !== "song" && this.options.apply?.() === "proposal" && this.session.document.liftLastStep(iv.id) !== null;
    iv.closed = proposal ? { how, revision: this.song.revision, proposal: true } : { how, revision: this.song.revision };
    if (how !== "song" && iv.added + iv.changed + iv.removed + iv.other.length > 0) {
      this.recent = [
        {
          id: iv.id,
          name: this.nameOf(iv.owner),
          description: iv.description,
          added: iv.added,
          changed: iv.changed,
          removed: iv.removed,
          trackIds: [...iv.trackIds],
          start: iv.start,
          end: iv.end,
          at: this.now(),
        },
        ...this.recent,
      ].slice(0, RECENT_MAX);
    }
    const corrects = [...iv.corrects.entries()].map(([id, notes]) => ({ id, notes }));
    this.options.log?.({ type: "ai_intervention_closed", id: iv.id, how, added: iv.added, changed: iv.changed, removed: iv.removed, ...(corrects.length ? { corrects } : {}), ...(proposal ? { proposal: true } : {}) });
    this.emit();
  }

  /** The user pressed "Cerrar intervención". */
  closeByUser(id: string): void {
    const iv = this.interventions.get(id);
    if (iv) this.close(iv, "user");
  }

  private summary(iv: Intervention): string {
    const parts: string[] = [];
    if (iv.added) parts.push(`${plural(iv.added, "note")} added`);
    if (iv.changed) parts.push(`${plural(iv.changed, "note")} changed`);
    if (iv.removed) parts.push(`${plural(iv.removed, "note")} removed`);
    parts.push(...iv.other);
    if (parts.length === 0) return "no changes";
    const where = iv.start !== null && iv.end !== null ? ` (${spanText(this.song, iv.start, iv.end)}${iv.trackIds.size ? `, ${[...iv.trackIds].map((t) => this.song.tracks[t]?.name ?? t).join(", ")}` : ""})` : "";
    return parts.join(", ") + where;
  }

  /** An annotation the AI may rewrite or remove: one written by an AI. The user's notes in words are theirs. */
  private ownAnnotation(id: string) {
    const a = this.song.annotations[id];
    if (!a) throw new MusicError(`There is no annotation ${id}. get_song_overview lists them`);
    if (a.author.by === "user") throw new MusicError(`Annotation ${id} is the user's: ask them before changing it`);
    return a;
  }

  private rev(): string {
    return `r${this.song.revision}`;
  }

  /**
   * The range a track's notes should stay in: the usual range of a built-in instrument, or the keys a
   * bank's sound has samples for (outside them it is silent).
   */
  private rangeOfTrack(trackId: string): { range: readonly [number, number]; what: string } | undefined {
    const track = this.song.tracks[trackId];
    if (!track) return undefined;
    if (track.sound) {
      const { bank, program, bankMSB, name } = track.sound;
      const preset = this.options.banks?.().find((b) => b.id === bank)?.presets.find((p) => p.program === program && p.bankMSB === bankMSB);
      return preset?.profile ? { range: [preset.profile.low, preset.profile.high], what: `the keys "${name}" has samples for` } : undefined;
    }
    const item = paletteItem(track.program);
    return item?.range ? { range: item.range, what: `the usual range of ${item.en}` } : undefined;
  }

  /** "2 notes are outside the usual range of Cellos (C2–A5): n12 n13." */
  private rangeWarning(trackId: string, ids: readonly string[]): string {
    const known = this.rangeOfTrack(trackId);
    if (!known) return "";
    const [low, high] = known.range;
    const out = ids.filter((id) => {
      const p = this.song.notes[id]?.pitch;
      return p !== undefined && (p < low || p > high);
    });
    if (out.length === 0) return "";
    const range = `${formatPitch(low)}–${formatPitch(high)}`;
    return `\nNote: ${plural(out.length, "note is", "notes are")} outside ${known.what} (${range}): ${out.join(" ")}.`;
  }

  // -------------------------------------------------------------------------
  // The tools

  private readonly handlers: Record<string, (conn: Connection, args: Record<string, unknown>) => string> = {
    get_song_overview: () => {
      const text = overviewText(this.song, {
        open: [...this.interventions.values()].filter((iv) => !iv.closed).map((iv) => ({ id: iv.id, who: this.nameOf(iv.owner), description: iv.description })),
      });
      const footer = skillsFooter(this.skillList());
      return footer ? `${text}\n${footer}` : text;
    },

    get_user_context: (conn) => {
      const mine = this.openOf(conn.client);
      const others = [...new Set([...this.connections.values()].filter((c) => c.client !== conn.client).map((c) => `${c.name} (${c.client})`))];
      return userContextText(this.song, this.window, {
        mine: mine ? { id: mine.id, description: mine.description } : null,
        others,
        tone: this.options.tone?.() ?? "direct",
        apply: this.options.apply?.() ?? "direct",
        proposals: this.session.document.proposals.map((p) => ({ id: p.id, label: p.label, stale: p.stale })),
        changed: this.changedLine(conn.client),
      });
    },

    read_notes: (_conn, args) => {
      const song = this.song;
      const range = resolveRange(song, this.str(args, "range")!);
      const trackIds = this.tracks(args);
      const ids = notesInRange(song, range, trackIds);
      const order = new Map(song.trackOrder.map((t, i) => [t, i]));
      ids.sort((a, b) => {
        const na = song.notes[a]!;
        const nb = song.notes[b]!;
        return (order.get(na.trackId) ?? 0) - (order.get(nb.trackId) ?? 0) || na.start - nb.start;
      });
      const pages = Math.max(1, Math.ceil(ids.length / PAGE_NOTES));
      const page = Math.round(this.num(args, "page") ?? 1);
      if (page < 1 || page > pages) throw new MusicError(`There ${pages === 1 ? "is 1 page" : `are ${pages} pages`} for ${range.label}`);
      const slice = ids.slice((page - 1) * PAGE_NOTES, page * PAGE_NOTES);
      const noteIds = new Set(slice);
      const shownTracks = page === 1 ? trackIds : [...new Set(slice.map((id) => song.notes[id]!.trackId))];
      const options: Parameters<typeof formatNotes>[1] = { fromBar: range.fromBar, toBar: range.toBar, noteIds };
      if (shownTracks) options.trackIds = shownTracks;
      const body = formatNotes(song, options);
      const footer =
        pages > 1
          ? `\nPage ${page} of ${pages} (${slice.length} of ${ids.length} notes in ${range.label}).${page < pages ? ` Next: read_notes with page ${page + 1}.` : ""}`
          : `\n${plural(ids.length, "note")} in ${range.label}.`;
      return body + (page === 1 ? this.curvesFor(song, range.start, range.end, trackIds) : "") + footer;
    },

    get_changes_since: (conn, args) => {
      const wanted = this.str(args, "since", false);
      const song = this.song;
      let before: Song | undefined;
      let since: string;
      if (wanted) {
        const m = /^r?(\d+)$/i.exec(wanted.trim());
        if (!m) throw new MusicError(`'${wanted}' is not a revision: write it like r120`);
        const rev = Number(m[1]);
        if (rev > song.revision) throw new MusicError(`The song is at r${song.revision}; r${rev} does not exist yet`);
        before = this.snapshots.get(rev);
        since = `since r${rev}`;
        if (!before) {
          const history = this.historySince(rev);
          const lines = [`Four Hands · changes since r${rev} → r${song.revision}`, `No copy of r${rev} is kept (only the versions an AI saw recently), so here is the history; read the bars it names with read_notes.`];
          for (const h of history.slice(-30)) lines.push(`  ${historyLine(h, displayName)}`);
          if (!history.length) lines.push("  Nothing changed.");
          return lines.join("\n");
        }
      } else {
        before = this.seen.get(conn.client);
        since = "since your last call";
        if (!before) return "This is your first call on this song: there is nothing to compare with. Read it with get_song_overview.";
      }
      return changesText(before, song, { since, history: this.historySince(before.revision), aiName: displayName });
    },

    get_history: (_conn, args) => {
      const limit = Math.max(1, Math.min(200, Math.round(this.num(args, "limit") ?? 30)));
      const history = this.session.document.history;
      const lines = [`Four Hands · r${this.song.revision} · history, newest first (${Math.min(limit, history.length)} of ${history.length})`];
      for (const h of history.slice(-limit).reverse()) lines.push(historyLine(h, displayName));
      if (!history.length) lines.push("Nothing yet.");
      return lines.join("\n");
    },

    summarize: (_conn, args) => {
      const song = this.song;
      const range = resolveRange(song, this.str(args, "range", false) ?? "all");
      const trackIds = this.tracks(args);
      const options: Parameters<typeof summaryText>[1] = { fromBar: range.fromBar, toBar: range.toBar };
      if (trackIds) options.trackIds = trackIds;
      return summaryText(song, options);
    },

    analyze: (_conn, args) => {
      const song = this.song;
      const range = resolveRange(song, this.str(args, "range", false) ?? "all");
      const trackIds = this.tracks(args);
      const options: Parameters<typeof analysisText>[1] = {
        start: range.start,
        end: range.end,
        label: range.label,
        // Usual range of the built-in instrument, or the keys a bank's sound has samples for.
        rangeOf: (trackId) => this.rangeOfTrack(trackId)?.range,
      };
      if (trackIds) options.trackIds = trackIds;
      return analysisText(song, options);
    },

    list_instruments: (_conn, args) => {
      const banks = this.options.banks?.() ?? [];
      const wanted = this.str(args, "bank", false);
      if (!wanted) return instrumentsText(banks, this.options.builtInSounds?.() ?? [], this.pluginList(), (this.options.plugins?.() ?? []).filter((p) => !p.instrument));
      return bankText(this.bank(wanted, banks));
    },

    get_levels: () => {
      const last = this.options.levels?.() ?? null;
      const song = this.options.session().snapshot().song;
      const tracks = song.trackOrder.map((id) => song.tracks[id]!).filter(Boolean);
      return levelsText(last?.levels ?? null, tracks.map((t) => ({ name: t.name, channel: t.channel, strip: last?.strips?.[t.id] })), last?.at ?? null, {
        masterVolume: song.masterVolume ?? 1,
        load: this.options.load?.() ?? null,
      });
    },

    list_skills: () => skillsListText(this.skillList()),

    load_skill: (_conn, args) => {
      const name = this.str(args, "name")!;
      const file = this.str(args, "file", false);
      if (!this.options.skills) throw new MusicError("This copy of Four Hands has no skills");
      try {
        const { skill, text } = this.options.skills.load(name, file);
        if (!this.skillsUsed.has(skill.name)) {
          this.skillsUsed.add(skill.name);
          this.emit();
        }
        return skillText(skill, text, file);
      } catch (error) {
        if (error instanceof SkillError) throw new MusicError(error.message);
        throw error;
      }
    },

    point_to: (conn, args) => {
      const song = this.song;
      const reason = this.str(args, "reason")!.trim();
      if (!reason) throw new MusicError("point_to needs a short reason for the user");
      const range = resolveRange(song, this.str(args, "range")!);
      const trackIds = this.tracks(args) ?? [];
      const noteIds = this.strings(args, "note_ids") ?? [];
      for (const id of noteIds) if (!song.notes[id]) throw new MusicError(`There is no note ${id}`);
      this.mark = { id: `m${++this.markSeq}`, name: conn.name, start: range.start, end: range.end, trackIds, noteIds, reason, at: this.now() };
      this.emit();
      const on = trackIds.length ? ` (${trackIds.map((t) => song.tracks[t]!.name).join(", ")})` : "";
      return `Pointed to ${range.label}${on}. The user sees a mark with your reason and a button to go there; their view did not move.`;
    },

    begin_intervention: (conn, args) => {
      const description = this.str(args, "description")!.trim();
      if (!description) throw new MusicError("begin_intervention needs a short description for the user");
      const open = this.openOf(conn.client);
      if (open) throw new MusicError(`Your intervention ${open.id} ("${open.description}") is still open. Keep writing in it, or close it with end_intervention`);
      const song = this.song;
      const base = parseRevision(this.str(args, "base_revision", false) ?? undefined);
      if (base === null || Number.isNaN(base)) throw new MusicError(`base_revision is the revision you read, like 'r${song.revision}'`);
      if (base > song.revision) throw new MusicError(`r${base} does not exist yet: the song is at r${song.revision}`);
      const id = `i${song.counters.i++}`;
      const iv: Intervention = {
        id,
        owner: conn.client,
        author: ai(conn.client),
        description,
        base,
        openedAt: this.now(),
        timer: null,
        added: 0,
        changed: 0,
        removed: 0,
        other: [],
        trackIds: new Set(),
        start: null,
        end: null,
        closed: null,
        firstNote: song.counters.n,
        corrects: new Map(),
      };
      iv.timer = this.setTimer(() => this.close(iv, "timeout"), this.options.autoCloseMs ?? 5 * 60_000);
      this.interventions.set(id, iv);
      this.options.log?.({ type: "ai_intervention_opened", id, client: conn.client, description, base });
      this.emit();
      const stale = base < song.revision ? ` The song is now at r${song.revision}: notes the user changed after r${base} are protected.` : "";
      return (
        `Intervention ${id} open: "${description}" (base r${base}).${stale}\n` +
        "Your changes go straight into the song as you write them; the user sees them live and can undo the whole intervention in one step.\n" +
        "Close it with end_intervention when you are done."
      );
    },

    end_intervention: (conn, args) => {
      const iv = this.intervention(conn, args);
      this.close(iv, "ai");
      if (iv.closed?.proposal) {
        return (
          `Intervention ${iv.id} closed: ${this.summary(iv)}. The user reviews changes as proposals: it left the song and waits, drawn with a dashed outline, ` +
          `until they accept or discard it (they hear it with and without it). Don't build on it until it is accepted; get_user_context lists pending proposals. The song is at ${this.rev()}.`
        );
      }
      if (this.options.apply?.() === "proposal") {
        return `Intervention ${iv.id} closed: ${this.summary(iv)}. It stays in the song (the user edited while you wrote, so it could not wait as a proposal); it is one undo step. The song is at ${this.rev()}.`;
      }
      return `Intervention ${iv.id} closed: ${this.summary(iv)}. It is one undo step for the user. The song is at ${this.rev()}.`;
    },

    add_notes: (conn, args) => {
      const iv = this.intervention(conn, args);
      const trackId = this.track(this.str(args, "track")!);
      const specs = parseNewNotes(this.song.meter, this.str(args, "notes")!);
      const ids = this.write(iv, (tx) => addNotes(tx, trackId, specs));
      this.touched(iv, ids, { added: ids.length });
      const track = this.song.tracks[trackId]!;
      const where = spanText(this.song, Math.min(...specs.map((s) => s.start)), Math.max(...specs.map((s) => s.start + s.duration)));
      return `Added ${plural(ids.length, "note")} to ${track.name} (${trackId}), ${where}: ${ids.join(" ")} · ${this.rev()}${this.rangeWarning(trackId, ids)}`;
    },

    edit_notes: (conn, args) => {
      const iv = this.intervention(conn, args);
      const song = this.song;
      const edits = parseNoteEdits(song.meter, this.str(args, "changes")!);
      this.guard(iv, edits.map((e) => e.id), args);
      const changes: NoteChange[] = edits.map((e) => {
        const n = song.notes[e.id]!;
        const c: NoteChange = { id: e.id };
        if (e.pitch !== undefined) c.pitch = e.pitch;
        if (e.start !== undefined) c.start = e.start + (e.startDeviation ?? 0);
        else if (e.startDeviation !== undefined) c.start = nominalGridPosition(n.start).gridTick + e.startDeviation;
        if (e.duration !== undefined) c.duration = e.duration + (e.durationDeviation ?? 0);
        else if (e.durationDeviation !== undefined) c.duration = nominalDuration(n.duration) + e.durationDeviation;
        if (e.velocity !== undefined) c.velocity = e.velocity;
        if (c.start !== undefined && c.start < 0) throw new MusicError(`${e.id} would start before the beginning of the song`);
        if (c.duration !== undefined && c.duration < 1) throw new MusicError(`${e.id} would have no duration`);
        return c;
      });
      const ids = changes.map((c) => c.id);
      this.write(iv, (tx) => updateNotes(tx, changes));
      this.touched(iv, ids, { changed: ids.length });
      return `Changed ${plural(ids.length, "note")}:\n${ids.map((id) => formatNote(this.song, this.song.notes[id]!)).join("\n")}\n${this.rev()}`;
    },

    repitch_notes: (conn, args) => {
      const iv = this.intervention(conn, args);
      const song = this.song;
      const all = lines(this.str(args, "pitches")!);
      if (all.length === 0) throw new MusicError("No pitches: one note per line, its id and the new pitch, e.g. 'n482 E5'");
      const changes = all.map(({ n, text }) => {
        let t;
        try {
          t = parseNoteTokens(song.meter, text);
        } catch (error) {
          throw new MusicError(`Line ${n} ("${text}"): ${(error as Error).message}`);
        }
        if (!t.id || t.pitch === undefined) throw new MusicError(`Line ${n} ("${text}"): write the note id and its new pitch, e.g. 'n482 E5'`);
        const extra = Object.keys(t).filter((k) => !["id", "pitch"].includes(k));
        if (extra.length) throw new MusicError(`Line ${n} ("${text}"): repitch_notes only changes pitches (rhythm and velocity stay); use edit_notes for the rest`);
        return { id: t.id, pitch: t.pitch };
      });
      this.guard(iv, changes.map((c) => c.id), args);
      this.write(iv, (tx) => updateNotes(tx, changes));
      const ids = changes.map((c) => c.id);
      this.touched(iv, ids, { changed: ids.length });
      const trackId = song.notes[ids[0]!]!.trackId;
      return `Repitched ${plural(ids.length, "note")}; rhythm, durations, velocities and deviations untouched:\n${ids.map((id) => formatNote(this.song, this.song.notes[id]!)).join("\n")}\n${this.rev()}${this.rangeWarning(trackId, ids)}`;
    },

    move_notes: (conn, args) => {
      const iv = this.intervention(conn, args);
      const song = this.song;
      const ids = this.targets(args);
      this.guard(iv, ids, args);
      const byTime = this.str(args, "by_time", false);
      const ticks = byTime ? parseShift(song.meter, byTime) : 0;
      const semitones = Math.round(this.num(args, "by_semitones") ?? 0);
      const degrees = Math.round(this.num(args, "by_degrees") ?? 0);
      if (ticks === 0 && semitones === 0 && degrees === 0) throw new MusicError("Say how to move them: by_time, by_semitones or by_degrees");
      const changes = ids.map((id) => {
        const n = song.notes[id]!;
        const pitch = (degrees ? transposeByDegrees(n.pitch, degrees, keyAt(song, n.start)) : n.pitch) + semitones;
        if (n.start + ticks < 0) throw new MusicError(`${id} would move before the beginning of the song`);
        if (pitch < 0 || pitch > 127) throw new MusicError(`${id} would leave the MIDI range`);
        return { id, start: n.start + ticks, pitch };
      });
      this.write(iv, (tx) => updateNotes(tx, changes));
      this.touched(iv, ids, { changed: ids.length });
      return `Moved ${plural(ids.length, "note")}${byTime ? ` ${byTime}` : ""}${semitones ? ` ${semitones > 0 ? "+" : ""}${semitones} semitones` : ""}${degrees ? ` ${degrees > 0 ? "+" : ""}${degrees} degrees` : ""}; each keeps its deviation. ${this.rev()}`;
    },

    copy_notes: (conn, args) => {
      const iv = this.intervention(conn, args);
      const song = this.song;
      const ids = this.targets(args);
      const to = parsePosition(song.meter, this.str(args, "to")!.trim()).tick;
      const toTrack = this.str(args, "to_track", false);
      const target = toTrack ? this.track(toTrack) : null;
      const rangeText = this.strings(args, "note_ids")?.length ? undefined : this.str(args, "range", false);
      const origin = rangeText ? resolveRange(song, rangeText).start : Math.min(...ids.map((id) => nominalGridPosition(song.notes[id]!.start).gridTick));
      const offset = to - origin;
      const byTrack = new Map<string, NoteSpec[]>();
      for (const id of ids) {
        const n = song.notes[id]!;
        if (n.start + offset < 0) throw new MusicError(`The copy of ${id} would start before the beginning of the song`);
        const t = target ?? n.trackId;
        const list = byTrack.get(t) ?? [];
        list.push({ pitch: n.pitch, start: n.start + offset, duration: n.duration, velocity: n.velocity });
        byTrack.set(t, list);
      }
      const created = this.write(iv, (tx) => [...byTrack].flatMap(([t, specs]) => addNotes(tx, t, specs)));
      this.touched(iv, created, { added: created.length });
      return `Copied ${plural(created.length, "note")}, deviations included: ${created.join(" ")} · ${this.rev()}`;
    },

    delete_notes: (conn, args) => {
      const iv = this.intervention(conn, args);
      const ids = this.targets(args);
      this.guard(iv, ids, args);
      const before = new Map(ids.map((id) => {
        const n = this.song.notes[id]!;
        return [id, { start: n.start, end: n.start + n.duration, trackId: n.trackId }];
      }));
      this.write(iv, (tx) => deleteNotes(tx, ids));
      this.touched(iv, ids, { removed: ids.length }, before);
      return `Deleted ${plural(ids.length, "note")}: ${ids.join(" ")} · ${this.rev()}`;
    },

    quantize_notes: (conn, args) => {
      const iv = this.intervention(conn, args);
      const song = this.song;
      const ids = this.targets(args);
      this.guard(iv, ids, args);
      const grid = parseDuration(this.str(args, "grid")!.trim());
      const strength = Math.max(0, Math.min(100, this.num(args, "strength") ?? 100)) / 100;
      const ends = args.ends === true;
      const changes = ids.map((id) => {
        const n = song.notes[id]!;
        const start = n.start + Math.round((Math.round(n.start / grid) * grid - n.start) * strength);
        const change: NoteChange = { id, start };
        if (ends) {
          const end = n.start + n.duration;
          let target = Math.round(end / grid) * grid;
          if (target <= Math.round(n.start / grid) * grid) target = Math.round(n.start / grid) * grid + grid;
          change.duration = Math.max(1, end + Math.round((target - end) * strength) - start);
        }
        return change;
      });
      this.write(iv, (tx) => updateNotes(tx, changes));
      this.touched(iv, ids, { changed: ids.length });
      return `Quantized ${plural(ids.length, "note")} to ${this.str(args, "grid")} at ${Math.round(strength * 100)} %${ends ? ", ends too" : ""}. ${this.rev()}`;
    },

    shape_velocities: (conn, args) => {
      const iv = this.intervention(conn, args);
      const song = this.song;
      const ids = this.targets(args);
      this.guard(iv, ids, args);
      const velocity = this.num(args, "velocity");
      const from = this.num(args, "from");
      const to = this.num(args, "to");
      const accent = this.num(args, "accent");
      const every = this.num(args, "every_beats");
      const modes = [velocity !== undefined, from !== undefined || to !== undefined, accent !== undefined].filter(Boolean).length;
      if (modes !== 1) throw new MusicError("Use one of: velocity; from and to; or accent with every_beats");
      const clamp = (v: number) => Math.max(1, Math.min(127, Math.round(v)));
      const notes = ids.map((id) => song.notes[id]!).sort((a, b) => a.start - b.start);
      let changes: { id: string; velocity: number }[];
      if (velocity !== undefined) changes = notes.map((n) => ({ id: n.id, velocity: clamp(velocity) }));
      else if (accent !== undefined) {
        if (!every || every < 1) throw new MusicError("accent needs every_beats (1 = every beat, 2 = every other beat…)");
        const beat = beatTicks(song.meter);
        changes = notes
          .filter((n) => {
            const start = nominalGridPosition(n.start).gridTick;
            const inBar = start - barStart(song.meter, Math.floor(start / (beat * song.meter.numerator)) + 1);
            return inBar % beat === 0 && (inBar / beat) % every === 0;
          })
          .map((n) => ({ id: n.id, velocity: clamp(n.velocity + accent) }));
        if (changes.length === 0) throw new MusicError("None of those notes falls on the accented beats");
      } else {
        if (from === undefined || to === undefined) throw new MusicError("A crescendo or diminuendo needs both from and to");
        const first = notes[0]!.start;
        const span = notes.at(-1)!.start - first;
        changes = notes.map((n) => ({ id: n.id, velocity: clamp(span === 0 ? from : from + ((to - from) * (n.start - first)) / span) }));
      }
      this.write(iv, (tx) => updateNotes(tx, changes));
      this.touched(iv, changes.map((c) => c.id), { changed: changes.length });
      return `Velocities of ${plural(changes.length, "note")} set (${changes.slice(0, 12).map((c) => `${c.id} v${c.velocity}`).join(", ")}${changes.length > 12 ? "…" : ""}). The notes stay whose they were. ${this.rev()}`;
    },

    write_pedal: (conn, args) => {
      const iv = this.intervention(conn, args);
      const song = this.song;
      const trackId = this.track(this.str(args, "track")!);
      const spans: PedalSpan[] = lines(String(args.spans ?? "")).map(({ n, text }) => {
        const m = /^(\S+)\s*-\s*(\S+)$/.exec(text);
        if (!m) throw new MusicError(`Line ${n} ("${text}"): a span is 'start-end', e.g. '17.1-17.4+1/2'`);
        try {
          const start = parseChordPosition(song.meter, m[1]!);
          const end = parseChordPosition(song.meter, m[2]!);
          if (end <= start) throw new MusicError("the pedal comes up before it goes down");
          return { start, end };
        } catch (error) {
          throw new MusicError(`Line ${n} ("${text}"): ${(error as Error).message}`);
        }
      });
      const rangeText = this.str(args, "range", false);
      if (spans.length === 0 && !rangeText) throw new MusicError("No spans: one per line, e.g. '17.1-17.4+1/2' (or give a range to clear)");
      const range = rangeText
        ? resolveRange(song, rangeText, { allowBeyondEnd: true })
        : { start: Math.min(...spans.map((s) => s.start)), end: Math.max(...spans.map((s) => s.end)) };
      const kept: PedalSpan[] = [];
      for (const s of song.tracks[trackId]!.pedal) {
        if (s.end <= range.start || s.start >= range.end) kept.push(s);
        else {
          if (s.start < range.start) kept.push({ start: s.start, end: range.start });
          if (s.end > range.end) kept.push({ start: range.end, end: s.end });
        }
      }
      this.write(iv, (tx) => setPedal(tx, trackId, [...kept, ...spans]));
      this.span(iv, range.start, range.end, trackId);
      iv.other.push(`pedal of ${song.tracks[trackId]!.name}`);
      this.emit();
      return `Pedal of ${song.tracks[trackId]!.name} written in ${spanText(song, range.start, range.end)}: ${plural(spans.length, "span")}. ${this.rev()}`;
    },

    write_expression: (conn, args) => {
      const iv = this.intervention(conn, args);
      const song = this.song;
      const trackId = this.track(this.str(args, "track")!);
      const kind = this.str(args, "curve") as CurveKind;
      if (kind !== "expression" && kind !== "modulation") throw new MusicError("curve is 'expression' (CC11) or 'modulation' (CC1)");
      const stepText = this.str(args, "step", false) ?? "1/16";
      const step = parseDuration(stepText);
      if (step < PPQ / 8 || step > PPQ) throw new MusicError(`step '${stepText}' is too fine or too coarse: use 1/8, 1/16 or 1/32`);
      const spans = lines(this.str(args, "lines")!).map(({ n, text }) => {
        const m = /^(.+?)\s+(clear|\d{1,3}(?:\s*>\s*\d{1,3})?)$/i.exec(text);
        if (!m) throw new MusicError(`Line ${n} ("${text}"): write '<range> <from>><to>', '<range> <value>' or '<range> clear', e.g. '17-20 40>100'`);
        let range;
        try {
          range = resolveRange(song, m[1]!, { allowBeyondEnd: true });
        } catch (error) {
          throw new MusicError(`Line ${n} ("${text}"): ${(error as Error).message}`);
        }
        const spec = m[2]!.toLowerCase();
        const values = spec === "clear" ? [] : spec.split(">").map((v) => Number(v.trim()));
        if (values.some((v) => v > 127)) throw new MusicError(`Line ${n} ("${text}"): values go from 0 to 127`);
        const points = values.length === 0 ? [] : values.length === 1 ? [{ tick: range.start, value: values[0]! }] : rampPoints(range.start, range.end, values[0]!, values[1]!, step);
        return { range, points };
      });
      for (let i = 1; i < spans.length; i++)
        for (let j = 0; j < i; j++)
          if (spans[i]!.range.start < spans[j]!.range.end && spans[j]!.range.start < spans[i]!.range.end) throw new MusicError(`Lines ${j + 1} and ${i + 1} overlap: give each span its own bars`);
      this.write(iv, (tx) => {
        for (const s of spans) setCurve(tx, trackId, kind, s.range.start, s.range.end, s.points);
      });
      for (const s of spans) this.span(iv, s.range.start, s.range.end, trackId);
      const name = song.tracks[trackId]!.name;
      iv.other.push(`${kind} of ${name}`);
      this.emit();
      const start = Math.min(...spans.map((s) => s.range.start));
      const end = Math.max(...spans.map((s) => s.range.end));
      const now = curveText(song, song.tracks[trackId]!.curves?.[kind] ?? [], start, end);
      return `${kind === "expression" ? "Expression (CC11)" : "Modulation (CC1)"} of ${name} in ${spanText(song, start, end)}: ${now || "cleared"}. ${this.rev()}`;
    },

    set_harmony: (conn, args) => {
      const iv = this.intervention(conn, args);
      const song = this.song;
      const chords = lines(this.str(args, "chords", false) ?? "").map(({ n, text }) => {
        const m = /^(\S+)\s+(\S+)$/.exec(text);
        if (!m) throw new MusicError(`Line ${n} ("${text}"): write the position and the chord, e.g. '17 Am' or '17.3 F/A'`);
        try {
          return { tick: parseChordPosition(song.meter, m[1]!), symbol: m[2] === "-" ? null : m[2]! };
        } catch (error) {
          throw new MusicError(`Line ${n} ("${text}"): ${(error as Error).message}`);
        }
      });
      const clear = this.str(args, "clear_range", false);
      const range = clear ? resolveRange(song, clear, { allowBeyondEnd: true }) : null;
      if (chords.length === 0 && !range) throw new MusicError("No chords: one per line, e.g. '17 Am'");
      this.write(iv, (tx) => {
        if (range) for (const tick of Object.keys(song.harmony).map(Number)) if (tick >= range.start && tick < range.end) setChord(tx, tick, null);
        for (const c of chords) setChord(tx, c.tick, c.symbol);
      });
      const ticks = chords.map((c) => c.tick);
      if (range) ticks.push(range.start, range.end - 1);
      this.span(iv, Math.min(...ticks), Math.max(...ticks) + 1);
      iv.other.push("chords");
      this.emit();
      return `Harmony written: ${chords.map((c) => `${formatPosition(song.meter, c.tick)} ${c.symbol ?? "(cleared)"}`).join(", ") || "cleared"}${range ? ` (cleared ${range.label} first)` : ""}. ${this.rev()}`;
    },

    set_sections: (conn, args) => {
      const iv = this.intervention(conn, args);
      const song = this.song;
      const done: string[] = [];
      const ops = lines(this.str(args, "sections")!).map(({ n, text }) => {
        const tokens = text.split(/\s+/);
        const id = /^s\d+$/.test(tokens[0]!) ? tokens.shift()! : null;
        if (id && !song.sections[id]) throw new MusicError(`Line ${n} ("${text}"): there is no section ${id}`);
        if (id && tokens.length === 1 && tokens[0] === "-") return { kind: "remove" as const, id };
        let bars: { startBar: number; endBar: number } | null = null;
        const last = tokens.at(-1) ?? "";
        const m = /^(\d+)(?:-(\d+))?$/.exec(last);
        if (m) {
          tokens.pop();
          bars = { startBar: Number(m[1]), endBar: Number(m[2] ?? m[1]) };
          if (bars.startBar < 1 || bars.endBar < bars.startBar) throw new MusicError(`Line ${n} ("${text}"): bars ${last} are not a range`);
        }
        const name = tokens.join(" ").trim();
        if (!id && (!name || !bars)) throw new MusicError(`Line ${n} ("${text}"): a new section needs a name and bars, e.g. 'Coro 17-24'`);
        return { kind: id ? ("update" as const) : ("add" as const), id, name, bars };
      });
      this.write(iv, (tx) => {
        for (const op of ops) {
          if (op.kind === "remove") {
            done.push(`removed ${song.sections[op.id]!.name}`);
            removeSection(tx, op.id);
          } else if (op.kind === "update") {
            const changes: { name?: string; startBar?: number; endBar?: number } = {};
            if (op.name) changes.name = op.name;
            if (op.bars) Object.assign(changes, op.bars);
            updateSection(tx, op.id!, changes);
            done.push(`${op.id} ${song.sections[op.id!]!.name} ${song.sections[op.id!]!.startBar}-${song.sections[op.id!]!.endBar}`);
          } else {
            const sid = addSection(tx, { name: op.name, startBar: op.bars!.startBar, endBar: op.bars!.endBar });
            done.push(`${sid} ${op.name} ${op.bars!.startBar}-${op.bars!.endBar}`);
          }
        }
      });
      iv.other.push("sections");
      this.emit();
      return `Sections: ${done.join(" · ")}. ${this.rev()}`;
    },

    set_song_properties: (conn, args) => {
      const iv = this.intervention(conn, args);
      const props: Parameters<typeof setSongProperties>[1] = {};
      const said: string[] = [];
      const title = this.str(args, "title", false);
      if (title !== undefined) (props.title = title.trim()), said.push(`title "${title.trim()}"`);
      const concept = args.concept;
      if (concept !== undefined && concept !== null) {
        if (typeof concept !== "string") throw new MusicError("'concept' must be text");
        props.concept = concept;
        said.push(concept.trim() ? "concept rewritten" : "concept removed");
      }
      const tempo = this.num(args, "tempo");
      if (tempo !== undefined) {
        if (tempo < 10 || tempo > 400) throw new MusicError("tempo is in BPM, between 10 and 400");
        props.tempo = Math.round(60_000_000 / tempo);
        said.push(`tempo ${tempo} BPM`);
      }
      const meter = this.str(args, "meter", false);
      if (meter !== undefined) (props.meter = parseMeter(meter)), said.push(`meter ${meter.trim()}`);
      const key = this.str(args, "key", false);
      if (key !== undefined) (props.key = parseKey(key)), said.push(`key ${key.trim()}`);
      if (said.length === 0) throw new MusicError("Say what to change: title, concept, tempo, meter or key");
      this.write(iv, (tx) => setSongProperties(tx, props));
      iv.other.push(said.join(", "));
      this.emit();
      return `Song: ${said.join(", ")}. ${this.rev()}`;
    },

    set_tempo_changes: (conn, args) => {
      const iv = this.intervention(conn, args);
      if (typeof args.changes !== "string") throw new MusicError("'changes' is text: one change per line, or '' for none");
      const before = secondsAt(this.song, songEnd(this.song));
      const points = parseTempoChanges(this.song, args.changes);
      this.write(iv, (tx) => setTempoChanges(tx, points));
      iv.other.push(points.length ? "tempo changes" : "tempo changes removed");
      this.emit();
      const after = secondsAt(this.song, songEnd(this.song));
      const clock = (x: number) => `${Math.floor(Math.round(x) / 60)}:${String(Math.round(x) % 60).padStart(2, "0")}`;
      const text = tempoChangesText(this.song);
      return `Tempo changes: ${text ? text.split("\n").join(" · ") : "none (one tempo)"}. The music lasts ${clock(after)} (was ${clock(before)}). ${this.rev()}`;
    },

    set_key_changes: (conn, args) => {
      const iv = this.intervention(conn, args);
      if (typeof args.changes !== "string") throw new MusicError("'changes' is text: one change per line, or '' for none");
      const changes = parseKeyChanges(this.song, args.changes);
      this.write(iv, (tx) => setKeyChanges(tx, changes));
      iv.other.push(changes.length ? "key changes" : "key changes removed");
      this.emit();
      const text = keyChangesText(this.song);
      return `Key changes: ${text ? text.split("\n").join(" · ") : "none (one key)"}. ${this.rev()}`;
    },

    add_track: (conn, args) => {
      const iv = this.intervention(conn, args);
      const song = this.song;
      const name = this.str(args, "name")!.trim();
      if (!name) throw new MusicError("A track needs a name");
      if (song.trackOrder.length >= MAX_TRACKS) throw new MusicError(`The song already has ${MAX_TRACKS} tracks, the most it can have`);
      const instrument = this.instrument(this.str(args, "instrument", false));
      const soundText = this.str(args, "sound", false);
      const plugin = soundText && isPluginSound(soundText) ? this.plugin(soundText) : undefined;
      const sound = soundText && !plugin ? this.sound(soundText) : undefined;
      const percussion = instrument === null && !sound && !plugin;
      const channel = percussion ? 9 : nextChannel(Object.values(song.tracks));
      const colorText = this.str(args, "color", false);
      const color = colorText !== undefined ? colorIndex(colorText) : undefined;
      const id = this.write(iv, (tx) =>
        {
          const id = addTrack(tx, { name, program: percussion ? null : (instrument ?? 0), channel, ...(sound ? { sound } : {}), ...(percussion ? { percussion: true } : {}), ...(color !== undefined ? { color } : {}) });
          if (plugin) updateTrack(tx, id, { output: "plugin", plugin });
          return id;
        },
      );
      iv.trackIds.add(id);
      iv.other.push(`track ${name}`);
      this.emit();
      return `Track ${id} "${name}" created · ${this.song.tracks[id] ? describeTrack(this.song, id) : ""}. ${this.rev()}`;
    },

    update_track: (conn, args) => {
      const iv = this.intervention(conn, args);
      const trackId = this.track(this.str(args, "track")!);
      const changes: Parameters<typeof updateTrack>[2] = {};
      const name = this.str(args, "name", false);
      if (name !== undefined) changes.name = name.trim();
      const instrumentText = this.str(args, "instrument", false);
      if (instrumentText !== undefined) {
        const program = this.instrument(instrumentText);
        if (program === null) throw new MusicError("A track cannot become drums: create a drums track with add_track");
        changes.program = program;
      }
      const soundText = this.str(args, "sound", false);
      const current = this.song.tracks[trackId]!;
      if (soundText !== undefined && isPluginSound(soundText)) {
        changes.plugin = this.plugin(soundText);
        changes.output = "plugin";
      } else {
        if (soundText !== undefined) changes.sound = fold(soundText) === "default" ? null : this.sound(soundText);
        // One sound per track (ESTUDIO_INTERFAZ_2.md, 5.2): a built-in sound or a bank's replaces the plugin.
        if ((soundText !== undefined || instrumentText !== undefined) && current.plugin) {
          changes.plugin = null;
          if (current.output === "plugin") changes.output = "internal";
        }
      }
      const volume = this.num(args, "volume");
      if (volume !== undefined) changes.volume = Math.max(0, Math.min(100, volume)) / 100;
      const pan = this.num(args, "pan");
      if (pan !== undefined) changes.pan = Math.max(-100, Math.min(100, pan)) / 100;
      const reverb = this.num(args, "reverb");
      if (reverb !== undefined) changes.reverb = Math.max(0, Math.min(100, reverb)) / 100;
      if (args.mute !== undefined) {
        if (typeof args.mute !== "boolean") throw new MusicError("'mute' is true or false");
        changes.mute = args.mute;
      }
      const colorText = this.str(args, "color", false);
      if (colorText !== undefined) changes.color = colorIndex(colorText);
      if (Object.keys(changes).length === 0) throw new MusicError("Say what to change: name, instrument, sound, volume, pan, reverb, mute or color");
      this.write(iv, (tx) => updateTrack(tx, trackId, changes));
      iv.trackIds.add(trackId);
      iv.other.push(`track ${this.song.tracks[trackId]!.name}`);
      this.emit();
      return `Track ${trackId}: ${describeTrack(this.song, trackId)}. ${this.rev()}`;
    },

    set_mix: (conn, args) => {
      const iv = this.intervention(conn, args);
      const all = lines(this.str(args, "mix")!);
      if (all.length === 0) throw new MusicError("No tracks: one per line, e.g. 't1 vol 65 pan -40'");
      // F2.2 parte B: a 'master vol 90' line sets the master fader (a track called so wins).
      let master: number | undefined;
      const trackLines = all.filter(({ n, text }) => {
        const m = /^(master|máster|master bus)\s+(.*)$/i.exec(text.trim());
        if (!m || orderedTracks(this.song).some((t) => t.name.toLowerCase() === m[1]!.toLowerCase())) return true;
        if (master !== undefined) throw new MusicError(`Line ${n}: the master appears twice`);
        const v = /^(?:vol|volume)\s+(\d+(?:\.\d+)?)$/i.exec(m[2]!.trim());
        if (!v) throw new MusicError(`Line ${n} ("${text}"): the master only has 'vol' (0-100, 100 = 0 dB)`);
        const vol = Number(v[1]);
        if (!(vol >= 0 && vol <= 100)) throw new MusicError(`Line ${n}: volume goes from 0 to 100`);
        master = vol / 100;
        return false;
      });
      const changes = trackLines.map(({ n, text }) => {
        try {
          return { ...this.mixLine(text), line: n };
        } catch (error) {
          throw new MusicError(`Line ${n} ("${text}"): ${(error as Error).message}`);
        }
      });
      const seen = new Set<string>();
      for (const c of changes) {
        if (seen.has(c.trackId)) throw new MusicError(`Line ${c.line}: ${this.song.tracks[c.trackId]!.name} appears twice`);
        seen.add(c.trackId);
      }
      this.write(iv, (tx) => {
        for (const c of changes) updateTrack(tx, c.trackId, c.changes);
        if (master !== undefined) setSongProperties(tx, { masterVolume: master });
      });
      for (const c of changes) iv.trackIds.add(c.trackId);
      iv.other.push(master !== undefined ? "the mix and the master" : "the mix");
      this.emit();
      const after = changes.map((c) => `${c.trackId} ${this.song.tracks[c.trackId]!.name} · ${mixText(this.song.tracks[c.trackId]!)}`);
      if (master !== undefined) after.push(`Master · vol ${Math.round((this.song.masterVolume ?? 1) * 100)}`);
      return `Mix set:\n${after.join("\n")}\n${this.rev()}`;
    },

    // F2.2 parte C: insert effects.
    add_effect: (conn, args) => {
      const iv = this.intervention(conn, args);
      const target = this.chainTarget(this.str(args, "track")!);
      const spec = this.effectSpec(this.str(args, "effect")!);
      const position = this.num(args, "position");
      const settings = this.str(args, "settings", false);
      if (spec.kind === "plugin" && settings) throw new MusicError("A plugin effect's settings go with set_effect once it is added (read them with list_effect_parameters)");
      const own = spec.kind !== "plugin" && settings ? this.ownSettings(spec.kind, settings) : null;
      let id = "";
      this.write(iv, (tx) => {
        id = addInsert(tx, target, own ? { kind: spec.kind as Exclude<InsertKind, "plugin">, params: own.params } : spec, position === undefined ? undefined : position - 1);
        if (own?.bypass !== undefined) updateInsert(tx, id, { bypass: own.bypass });
      });
      if (target !== "master") iv.trackIds.add(target);
      iv.other.push(`effects of ${this.chainName(target)}`);
      this.emit();
      return `Added ${id} ${effectText(findInsert(this.song, id)!.insert)} to ${this.chainName(target)}.\nChain: ${chainText(chainOf(this.song, target))}\n${this.rev()}`;
    },

    remove_effect: (conn, args) => {
      const iv = this.intervention(conn, args);
      const found = this.effect(this.str(args, "effect")!);
      this.write(iv, (tx) => removeInsert(tx, found.insert.id));
      iv.other.push(`effects of ${this.chainName(found.target)}`);
      this.emit();
      return `Removed ${found.insert.id} ${insertName(found.insert)} from ${this.chainName(found.target)}.\nChain: ${chainText(chainOf(this.song, found.target)) || "empty"}\n${this.rev()}`;
    },

    move_effect: (conn, args) => {
      const iv = this.intervention(conn, args);
      const found = this.effect(this.str(args, "effect")!);
      const position = Math.round(this.num(args, "position") ?? NaN);
      if (!(position >= 1)) throw new MusicError("position starts at 1");
      const trackText = this.str(args, "track", false);
      const target = trackText ? this.chainTarget(trackText) : found.target;
      this.write(iv, (tx) => moveInsert(tx, found.insert.id, position - 1, target));
      iv.other.push(`effects of ${this.chainName(target)}`);
      this.emit();
      return `Chain of ${this.chainName(target)}: ${chainText(chainOf(this.song, target))}\n${this.rev()}`;
    },

    move_track: (conn, args) => {
      const iv = this.intervention(conn, args);
      const trackId = this.track(this.str(args, "track")!);
      const position = Math.round(this.num(args, "position") ?? NaN);
      const count = this.song.trackOrder.length;
      if (!(position >= 1 && position <= count)) throw new MusicError(`position goes from 1 to ${count}`);
      this.write(iv, (tx) => moveTrack(tx, trackId, position - 1));
      iv.other.push(`order of tracks`);
      this.emit();
      return `Tracks now: ${orderedTracks(this.song).map((t, i) => `${i + 1}. ${t.name} (${t.id})`).join(" · ")}. ${this.rev()}`;
    },

    remove_track: (conn, args) => {
      const iv = this.intervention(conn, args);
      const trackId = this.track(this.str(args, "track")!);
      const track = this.song.tracks[trackId]!;
      const ids = Object.values(this.song.notes).filter((n) => n.trackId === trackId).map((n) => n.id);
      this.guard(iv, ids, args);
      this.write(iv, (tx) => removeTrack(tx, trackId));
      iv.removed += ids.length;
      iv.other.push(`removed track ${track.name}`);
      this.emit();
      return `Track ${trackId} "${track.name}" removed, with its ${plural(ids.length, "note")}. The user can undo it in one step. ${this.rev()}`;
    },

    annotate: (conn, args) => {
      const iv = this.intervention(conn, args);
      const song = this.song;
      const text = this.str(args, "text")!.trim();
      if (!text) throw new MusicError("An annotation needs some text");
      const editing = this.str(args, "id", false);
      if (editing) {
        // Rewrite an annotation instead of piling a new one on top (the Severance sessions, 20/10/2026).
        const oldText = this.ownAnnotation(editing).text;
        const rangeText = this.str(args, "range", false);
        const range = rangeText ? resolveRange(song, rangeText, { allowBeyondEnd: true }) : null;
        const tracks = this.tracks(args);
        this.write(iv, (tx) =>
          updateAnnotation(tx, editing, { text, ...(range ? { start: range.start, end: range.end } : {}), ...(tracks ? { trackIds: tracks } : {}) }),
        );
        const a = this.song.annotations[editing]!;
        this.span(iv, a.start, a.end);
        iv.other.push("an annotation");
        this.emit();
        return `Annotation ${editing} rewritten on ${spanText(this.song, a.start, a.end)}: "${text}" (was "${oldText}"). ${this.rev()}`;
      }
      const range = resolveRange(song, this.str(args, "range")!, { allowBeyondEnd: true });
      const trackIds = this.tracks(args) ?? [];
      const id = this.write(iv, (tx) => addAnnotation(tx, { start: range.start, end: range.end, trackIds, text }));
      this.span(iv, range.start, range.end);
      iv.other.push("an annotation");
      this.emit();
      return `Annotation ${id} on ${range.label}: "${text}". ${this.rev()}`;
    },

    remove_annotations: (conn, args) => {
      const iv = this.intervention(conn, args);
      const song = this.song;
      const ids = this.strings(args, "ids") ?? [];
      const rangeText = this.str(args, "range", false);
      if (ids.length === 0 && !rangeText) throw new MusicError("Say which annotations: ids (from get_song_overview), or a range");
      let chosen: string[];
      if (ids.length) {
        for (const id of ids) this.ownAnnotation(id);
        chosen = ids;
      } else {
        const range = resolveRange(song, rangeText!, { allowBeyondEnd: true });
        chosen = Object.values(song.annotations)
          .filter((a) => a.start >= range.start && a.start < range.end && a.author.by === "ai")
          .map((a) => a.id);
      }
      const kept = rangeText && !ids.length
        ? Object.values(song.annotations).filter((a) => a.author.by === "user").length
        : 0;
      if (chosen.length === 0) return `No annotations of yours there.${kept ? " The user's annotations are theirs: ask them." : ""}`;
      this.write(iv, (tx) => {
        for (const id of chosen) removeAnnotation(tx, id);
      });
      iv.other.push(plural(chosen.length, "annotation") + " removed");
      this.emit();
      return `Removed ${chosen.join(" ")}.${kept ? " The user's annotations stay: only they remove theirs." : ""} ${this.rev()}`;
    },
  };

  // -------------------------------------------------------------------------
  // Instruments

  /** A palette instrument (Spanish or English, singular or plural), a General MIDI number, or null for drums. */
  private instrument(text: string | undefined): number | null {
    if (text === undefined) return 0;
    const raw = text.trim();
    if (/^\d{1,3}$/.test(raw)) {
      const n = Number(raw);
      if (n > 127) throw new MusicError("General MIDI programs go from 0 to 127");
      return n;
    }
    const key = fold(raw);
    if (/^(drums|percussion|percusion|bateria)$/.test(key)) return null;
    const candidates: { program: number | null; names: string[] }[] = [];
    for (const group of PALETTE) for (const item of group.items) candidates.push({ program: item.program, names: [item.es, item.en] });
    for (const [program, names] of Object.entries(NAMED_PROGRAMS)) candidates.push({ program: Number(program), names: [...names] });
    const stem = (s: string) => fold(s).replace(/(es|s)$/, "");
    const found =
      candidates.find((c) => c.names.some((n) => fold(n) === key)) ??
      candidates.find((c) => c.names.some((n) => stem(n) === stem(raw))) ??
      candidates.find((c) => c.names.some((n) => fold(n).startsWith(key) && key.length >= 3));
    if (!found) throw new MusicError(`'${text}' is not an instrument I know. See list_instruments, or give a General MIDI program number`);
    return found.program;
  }

  private bank(text: string, banks: SoundBankInfo[]): SoundBankInfo {
    const key = fold(text);
    const bank = banks.find((b) => fold(b.id) === key) ?? banks.find((b) => fold(b.name) === key) ?? banks.find((b) => fold(b.id).startsWith(key));
    if (!bank) throw new MusicError(`There is no installed bank '${text}'. ${banks.length ? `Banks: ${banks.map((b) => b.id).join(", ")}` : "The user has not installed any"}`);
    return bank;
  }

  private pluginList(): EnginePlugin[] {
    return (this.options.plugins?.() ?? []).filter((p) => p.instrument);
  }

  /** "plugin / Kontakt 8" → the plugin the engine found (by name, then by the start of it). */
  private plugin(text: string): { id: string; name: string } {
    const key = fold(text.slice(text.indexOf("/") + 1));
    const list = this.pluginList();
    const found = list.find((p) => fold(p.name) === key) ?? list.find((p) => fold(p.name).startsWith(key));
    if (!found) throw new MusicError(list.length ? `There is no instrument plugin '${text.slice(text.indexOf("/") + 1).trim()}'. See list_instruments` : "Four Hands has not found any instrument plugin on this computer yet (Ajustes › Plugins)");
    return { id: found.id, name: found.name };
  }

  /** "Sonatina.sf2 / 1st Violins Sustain" → TrackSound. */
  private sound(text: string): TrackSound {
    const at = text.lastIndexOf("/");
    if (at < 0) throw new MusicError(`A sound is 'bank file / sound name', e.g. 'Sonatina.sf2 / Cello Sustain'`);
    const bank = this.bank(text.slice(0, at).trim(), this.options.banks?.() ?? []);
    const key = fold(text.slice(at + 1));
    const preset = bank.presets.find((p) => fold(p.name) === key) ?? bank.presets.find((p) => fold(p.name).startsWith(key));
    if (!preset) throw new MusicError(`${bank.id} has no sound '${text.slice(at + 1).trim()}'. See list_instruments with bank '${bank.id}'`);
    return { bank: bank.id, program: preset.program, bankMSB: preset.bankMSB, name: preset.name };
  }

  /** "Violines vol 80 pan L25 rev 30 mute": the track is what is left after the settings, read from the end. */
  private mixLine(text: string): { trackId: string; changes: { volume?: number; pan?: number; reverb?: number; mute?: boolean } } {
    const tokens = text.split(/\s+/);
    const changes: { volume?: number; pan?: number; reverb?: number; mute?: boolean } = {};
    const value = (raw: string | undefined, what: string): string => {
      if (raw === undefined) throw new MusicError(`'${what}' needs a value`);
      return raw;
    };
    // Settings are pairs ("vol 70", "pan L30") or words ("mute"); scan for the first one.
    const first = tokens.findIndex((t) => /^(vol|volume|pan|rev|reverb|mute|unmute)$/i.test(t));
    if (first <= 0) throw new MusicError("write the track first, then 'vol', 'pan', 'rev', 'mute' or 'unmute'");
    const trackId = this.track(tokens.slice(0, first).join(" "));
    for (let i = first; i < tokens.length; i++) {
      const key = tokens[i]!.toLowerCase();
      if (key === "mute" || key === "unmute") {
        changes.mute = key === "mute";
      } else if (key === "vol" || key === "volume") {
        const v = Number(value(tokens[++i], key));
        if (!(v >= 0 && v <= 100)) throw new MusicError("volume goes from 0 to 100");
        changes.volume = v / 100;
      } else if (key === "pan") {
        const raw = value(tokens[++i], key).toUpperCase();
        const m = /^(C|CENTER|CENTRO)$|^([LR])(\d{1,3})$|^([+-]?\d{1,3})$/.exec(raw);
        if (!m) throw new MusicError(`'pan ${raw}' is not a pan (-100 to 100, or L30, R20, C)`);
        const v = m[1] ? 0 : m[2] ? (m[2] === "L" ? -1 : 1) * Number(m[3]) : Number(m[4]);
        if (Math.abs(v) > 100) throw new MusicError("pan goes from -100 (left) to 100 (right)");
        changes.pan = v / 100;
      } else if (key === "rev" || key === "reverb") {
        const v = Number(value(tokens[++i], key));
        if (!(v >= 0 && v <= 100)) throw new MusicError("reverb goes from 0 (dry) to 100");
        changes.reverb = v / 100;
      } else {
        throw new MusicError(`'${tokens[i]}' is not 'vol', 'pan', 'rev', 'mute' or 'unmute'`);
      }
    }
    if (Object.keys(changes).length === 0) throw new MusicError("nothing to change");
    return { trackId, changes };
  }

  // -------------------------------------------------------------------------
  // Insert effects (F2.2 parte C)

  /** Tools that may wait for the engine: a plugin effect's parameters. Own effects answer at once. */
  private readonly asyncHandlers: Record<string, (conn: Connection, args: Record<string, unknown>) => Promise<string>> = {
    list_effect_parameters: async (_conn, args) => {
      const found = this.effect(this.str(args, "effect")!);
      const search = fold(this.str(args, "search", false) ?? "");
      const x = found.insert;
      const head = `Four Hands · ${x.id} ${insertName(x)} on ${this.chainName(found.target)}${x.bypass ? " (bypassed)" : ""}`;
      if (x.kind !== "plugin") {
        const rows = paramDefs(x.kind)
          .filter((d) => !search || fold(d.name).includes(search))
          .map((d) => `${d.name}: ${paramText(d, x.params?.[d.id] ?? d.default)}${d.unit === "on" ? " (on/off)" : ` (${paramText(d, d.min)} to ${paramText(d, d.max)})`}`);
        return [head, ...rows].join("\n");
      }
      const params = await this.options.effectParams?.(x.id);
      if (!params) throw new MusicError("The audio engine is not running or has not loaded this plugin yet: ask the user to play the song once, then try again");
      const rows = params.filter((p) => !search || fold(p.name).includes(search));
      const shown = rows.slice(0, 120).map((p) => `${p.name}: ${p.text}${p.label && !p.text.endsWith(p.label) ? ` ${p.label}` : ""}`);
      return [head, `${rows.length} of ${params.length} parameters${rows.length > 120 ? " (first 120: narrow with search)" : ""}:`, ...shown].join("\n");
    },

    set_effect: async (conn, args) => {
      const iv = this.intervention(conn, args);
      const found = this.effect(this.str(args, "effect")!);
      const x = found.insert;
      const text = this.str(args, "settings")!;
      if (x.kind !== "plugin") {
        const own = this.ownSettings(x.kind, text);
        this.write(iv, (tx) => updateInsert(tx, x.id, { params: own.params, ...(own.bypass === undefined ? {} : { bypass: own.bypass }) }));
        iv.other.push(`effects of ${this.chainName(found.target)}`);
        this.emit();
        return `${x.id} ${effectText(findInsert(this.song, x.id)!.insert)}\n${this.rev()}`;
      }
      // A plugin: each line names one of its parameters; the engine reads the value text.
      const params = await this.options.effectParams?.(x.id);
      if (!params) throw new MusicError("The audio engine is not running or has not loaded this plugin yet: ask the user to play the song once, then try again");
      let bypass: boolean | undefined;
      const wanted: Array<{ p: EffectParam; text: string }> = [];
      for (const { n, text: line } of lines(text)) {
        const [name, value] = splitSetting(line, n);
        if (fold(name) === "bypass") {
          bypass = onOff(value, n);
          continue;
        }
        const key = fold(name);
        const p = params.find((q) => fold(q.name) === key) ?? params.find((q) => fold(q.name).startsWith(key));
        if (!p) throw new MusicError(`Line ${n}: ${insertName(x)} has no parameter '${name}'. See list_effect_parameters`);
        wanted.push({ p, text: value });
      }
      const changes: Record<string, { value: number; base: number }> = {};
      const after: string[] = [];
      for (const { p, text: value } of wanted) {
        const r = await this.options.setEffectParam?.(x.id, p.index, value);
        if (!r?.ok) throw new MusicError(`${insertName(x)} did not take '${p.name}: ${value}'`);
        changes[String(p.index)] = { value: r.value, base: p.value };
        after.push(`${p.name}: ${r.text}`);
      }
      // In the song too, so it is undone in one step and kept with the song.
      if (Object.keys(changes).length || bypass !== undefined) {
        this.write(iv, (tx) => updateInsert(tx, x.id, { ...(Object.keys(changes).length ? { pluginParams: changes } : {}), ...(bypass === undefined ? {} : { bypass }) }));
        iv.other.push(`effects of ${this.chainName(found.target)}`);
        this.emit();
      }
      if (bypass !== undefined) after.push(`bypass: ${bypass ? "on" : "off"}`);
      return `${x.id} ${insertName(x)}: ${after.join(" · ") || "nothing changed"}\n${this.rev()}`;
    },
  };

  /** "master", or a track by id or name. */
  private chainTarget(text: string): ChainTarget {
    return /^(master|máster|master bus)$/i.test(text.trim()) ? "master" : this.track(text);
  }

  private chainName(target: ChainTarget): string {
    return target === "master" ? "the Master" : `${this.song.tracks[target]?.name ?? target} (${target})`;
  }

  private effect(text: string): { target: ChainTarget; index: number; insert: Insert } {
    const found = findInsert(this.song, text.trim());
    if (!found) throw new MusicError(`There is no effect ${text.trim()}. The overview lists each track's effects with their ids`);
    return found;
  }

  /** 'eq', 'compressor', 'limiter' (also in Spanish), or a plugin effect by name. */
  private effectSpec(text: string): InsertSpec {
    const key = fold(text);
    const own: Record<string, Exclude<InsertKind, "plugin">> = { eq: "eq", ecualizador: "eq", equalizer: "eq", compressor: "compressor", compresor: "compressor", limiter: "limiter", limitador: "limiter" };
    if (own[key]) return { kind: own[key] };
    const list = (this.options.plugins?.() ?? []).filter((p) => !p.instrument);
    const found = list.find((p) => fold(p.name) === key) ?? list.find((p) => fold(p.name).startsWith(key));
    if (!found) throw new MusicError(list.length ? `There is no effect '${text.trim()}': 'eq', 'compressor', 'limiter', or a plugin effect from list_instruments` : `'${text.trim()}' is not 'eq', 'compressor' or 'limiter', and Four Hands has not found plugin effects on this computer yet (Ajustes › Plugins)`);
    return { kind: "plugin", plugin: { id: found.id, name: found.name } };
  }

  /** Lines 'Threshold: -24 dB' for an own effect: its parameters (and bypass). */
  private ownSettings(kind: Exclude<InsertKind, "plugin">, text: string): { params: Record<string, number>; bypass?: boolean } {
    const defs = paramDefs(kind);
    const params: Record<string, number> = {};
    let bypass: boolean | undefined;
    for (const { n, text: line } of lines(text)) {
      const [name, value] = splitSetting(line, n);
      const key = fold(name);
      if (key === "bypass") {
        bypass = onOff(value, n);
        continue;
      }
      const def = defs.find((d) => fold(d.name) === key || fold(d.id) === key) ?? defs.find((d) => fold(d.name).startsWith(key));
      if (!def) throw new MusicError(`Line ${n}: the ${OWN_EFFECTS[kind].name.en} has no '${name}'. Its parameters: ${defs.map((d) => d.name).join(", ")}`);
      if (def.unit === "on") {
        params[def.id] = onOff(value, n) ? 1 : 0;
        continue;
      }
      const v = readValue(value, def.unit);
      if (v === null) throw new MusicError(`Line ${n}: '${value}' is not a value for ${def.name} (${paramText(def, def.min)} to ${paramText(def, def.max)})`);
      if (v < def.min - 1e-9 || v > def.max + 1e-9) throw new MusicError(`Line ${n}: ${def.name} goes from ${paramText(def, def.min)} to ${paramText(def, def.max)}`);
      params[def.id] = v;
    }
    return bypass === undefined ? { params } : { params, bypass };
  }

  dispose(): void {
    this.unsubscribe();
    for (const iv of this.interventions.values()) this.clearTimer(iv.timer);
    if (this.reading) this.clearTimer(this.reading.timer);
  }
}

/** "plugin / Kontakt 8" chooses a plugin; anything else with a slash is a bank's sound. */
function isPluginSound(text: string): boolean {
  return /^\s*plugins?\s*\//i.test(text);
}

const READ_TOOLS = new Set(["list_effect_parameters", "get_song_overview", "get_user_context", "read_notes", "analyze", "get_changes_since", "get_history", "summarize", "list_instruments", "get_levels", "list_skills", "load_skill", "point_to"]);
const NOT_READING_THE_SONG = new Set(["point_to", "list_skills", "load_skill"]);

/** "Threshold: -24 dB" → ["Threshold", "-24 dB"]; also "Threshold = -24" and "threshold -24". */
function splitSetting(line: string, n: number): [string, string] {
  // "Ratio: 4:1" and "ratio 4:1": the name does not end in a digit before its colon.
  const t = line.trim();
  const m = /^(.*?[^\d\s])\s*[:=]\s*(.+)$/.exec(t) ?? /^(.*\D)\s+([-+−]?\d.*)$/.exec(t) ?? /^(.+?)\s+(on|off|true|false|yes|no|s[ií])$/i.exec(t);
  if (!m) throw new MusicError(`Line ${n} ("${line}"): write 'name: value', e.g. 'Threshold: -24 dB'`);
  return [m[1]!.trim().replace(/\s*[:=]$/, ""), m[2]!.trim()];
}

function onOff(value: string, n: number): boolean {
  const v = fold(value);
  if (["on", "true", "yes", "si", "1", "activo", "activado"].includes(v)) return true;
  if (["off", "false", "no", "0", "inactivo", "desactivado"].includes(v)) return false;
  throw new MusicError(`Line ${n}: '${value}' is not on or off`);
}

/** "-24 dB", "2,5 kHz", "4:1", "5 ms", "90" → a number in the parameter's unit (Hz, dB, ms…). */
function readValue(text: string, unit: string): number | null {
  const t = text.trim().toLowerCase().replace("−", "-").replace(",", ".");
  const m = /^([-+]?\d+(?:\.\d+)?)\s*(khz|hz|db|ms|s|:1)?$/.exec(t);
  if (!m) return null;
  let v = Number(m[1]);
  if (m[2] === "khz") v *= 1000;
  if (m[2] === "s" && unit === "ms") v *= 1000;
  return Number.isFinite(v) ? v : null;
}

function formatPitch(pitch: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

/** Palette index of a colour named by the AI (English or Spanish). */
function colorIndex(text: string): number {
  const i = trackColorByName(text);
  if (i === null) throw new MusicError(`There is no colour '${text}'. Colours: ${TRACK_PALETTE.map((c) => c.id).join(", ")}`);
  return i;
}

function describeTrack(song: Song, id: string): string {
  const t = song.tracks[id]!;
  const parts = [t.name];
  if (t.sound) parts.push(`sound "${t.sound.name}" from ${t.sound.bank}`);
  else if (t.program === null || t.channel === 9) parts.push("drums");
  else parts.push(`program ${t.program}`);
  parts.push(`volume ${Math.round(t.volume * 100)}`, `pan ${Math.round(t.pan * 100)}`, `reverb ${Math.round((t.reverb ?? 0) * 100)}`, `color ${trackColorId(t.color)}`);
  return parts.join(" · ");
}
