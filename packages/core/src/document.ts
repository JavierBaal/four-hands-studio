/**
 * The command layer (ARQUITECTURA.md, 5).
 *
 * - Every change to the song is a list of small operations, each with its inverse.
 * - A transaction groups the commands of one user gesture or one AI intervention.
 *   One transaction = one undo step = one new revision.
 * - Undo is linear: it undoes the last transaction, whoever made it.
 * - A transaction is atomic: if a command fails, everything it did is rolled back.
 * - The shared context (selection, loop, cursor…) is not undoable and does not bump the revision.
 */
import type { Authorship, IdPrefix, SharedContext, Song } from "./model.js";

export type Path = readonly string[];

export type Op = { op: "set"; path: Path; value: unknown } | { op: "remove"; path: Path };

/** Sent to the window and to the bridges after every change. */
export interface Patch {
  revision: number;
  ops: Op[];
}

export interface HistoryEntry {
  revision: number;
  /** "propose": an AI's finished intervention left the song and became a proposal (H4, proposal mode). */
  kind: "edit" | "undo" | "redo" | "propose";
  /** Who did it: for an accepted proposal, the user. */
  actor: Authorship;
  /** Who the changed notes belong to: for an accepted proposal, the AI that wrote it. */
  author: Authorship;
  /** Human-readable description, in the user's language when it comes from the AI. */
  label: string;
  /** Milliseconds since the epoch. */
  at: number;
}

/**
 * A pending proposal (H4, proposal mode, off by default): an AI intervention that left the song when
 * it ended. Accepting applies `ops` again (the user as actor, the AI as author); discarding drops it.
 * It goes stale when anything later changes what it touches: then it can only be discarded.
 */
export interface Proposal {
  /** The intervention's id ("i4"). */
  id: string;
  label: string;
  author: Authorship;
  /** What the intervention did, to apply again on accept. */
  ops: Op[];
  /** Revision when it became a proposal. */
  revision: number;
  stale: boolean;
}

/** What an operation touches, to tell when a later change collides with a proposal: "notes.n12", "tempoChanges". */
function touchKey(path: Path): string {
  return path.length >= 2 ? `${path[0]}.${path[1]}` : String(path[0]);
}

export class CommandError extends Error {
  override name = "CommandError";
}

interface UndoStep {
  ops: Op[];
  inverses: Op[];
  actor: Authorship;
  author: Authorship;
  label: string;
  /** Transactions of the same group that follow each other become this one step (an AI intervention). */
  group?: string;
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

/** Applies one operation in place and returns its inverse. */
export function applyOp(root: object, op: Op): Op {
  if (op.path.length === 0) throw new CommandError("Empty path");
  let parent = root as Record<string, unknown>;
  for (const key of op.path.slice(0, -1)) {
    const next = parent[key];
    if (next === null || typeof next !== "object") {
      throw new CommandError(`Path not found: ${op.path.join(".")}`);
    }
    parent = next as Record<string, unknown>;
  }
  const last = op.path[op.path.length - 1]!;
  const existed = Object.prototype.hasOwnProperty.call(parent, last);
  const previous = parent[last];
  if (op.op === "set") {
    parent[last] = clone(op.value);
  } else {
    delete parent[last];
  }
  return existed ? { op: "set", path: op.path, value: clone(previous) } : { op: "remove", path: op.path };
}

/** Context handed to commands. Commands only change the song through `set` and `remove`. */
export class Transaction {
  readonly ops: Op[] = [];
  readonly inverses: Op[] = [];

  constructor(
    readonly song: Song,
    /** Who performs the transaction. */
    readonly actor: Authorship,
    /** Who the notes written in this transaction belong to (usually the actor). */
    readonly author: Authorship,
  ) {}

  set(path: Path, value: unknown): void {
    this.record({ op: "set", path, value });
  }

  remove(path: Path): void {
    this.record({ op: "remove", path });
  }

  /** A new id. Counters are not undone: ids are never reused within a song. */
  nextId(prefix: IdPrefix): string {
    const n = this.song.counters[prefix];
    this.song.counters[prefix] = n + 1;
    return `${prefix}${n}`;
  }

  /** Applies a recorded operation again (accepting a proposal). Throws if its place is gone. */
  apply(op: Op): void {
    this.record(clone(op));
  }

  private record(op: Op): void {
    const inverse = applyOp(this.song, op);
    this.ops.push(op);
    this.inverses.push(inverse);
  }

  /** Undoes everything this transaction has done so far. */
  rollback(): void {
    for (let i = this.inverses.length - 1; i >= 0; i--) applyOp(this.song, this.inverses[i]!);
    this.ops.length = 0;
    this.inverses.length = 0;
  }
}

export interface TransactionMeta {
  actor: Authorship;
  label: string;
  /** Defaults to the actor. Set it to the AI when the user accepts an AI proposal. */
  author?: Authorship;
  /**
   * Joins this transaction to the previous one if it had the same group and nothing happened in
   * between (no other edit, undo or redo): one AI intervention = one undo step = one history entry,
   * even though it arrives in several calls (ESQUEMA_MCP.md, 5.1). If the user edits in the
   * middle, the next call starts a new step, so linear undo stays correct.
   */
  group?: string;
}

export interface SongDocumentOptions {
  now?: () => number;
  history?: HistoryEntry[];
  /** Pending proposals saved with the song. */
  proposals?: Proposal[];
}

/**
 * Owns the song: the single source of truth. Lives in Electron's main process.
 * Commands are applied one at a time, whether they come from the window or from any AI.
 */
export class SongDocument {
  readonly song: Song;
  readonly history: HistoryEntry[];
  /** Pending proposals, oldest first (H4). */
  readonly proposals: Proposal[];
  private readonly undoStack: UndoStep[] = [];
  private readonly redoStack: UndoStep[] = [];
  private readonly listeners = new Set<(patch: Patch) => void>();
  private readonly now: () => number;
  private inTransaction = false;
  /** The step the last edit created or extended, while it can still be extended. */
  private openStep: UndoStep | null = null;
  private merged = false;

  constructor(song: Song, options: SongDocumentOptions = {}) {
    this.song = song;
    this.now = options.now ?? Date.now;
    this.history = options.history ? [...options.history] : [];
    this.proposals = options.proposals ? structuredClone(options.proposals) : [];
  }

  /**
   * Proposal mode: the last step, an AI intervention of group `group` that has ended, leaves the
   * song and becomes a proposal. Null when it cannot: it is not the last step (someone edited in
   * the middle) or it changed nothing; then it stays in the song as it is.
   */
  liftLastStep(group: string): Proposal | null {
    const top = this.undoStack.at(-1);
    if (!top || top.group !== group || top === this.openStep || top.author.by !== "ai") return null;
    this.undoStack.pop();
    const ops = [...top.inverses].reverse();
    for (const op of ops) applyOp(this.song, op);
    this.openStep = null;
    this.commit("propose", top.actor, top.author, top.label, ops);
    const proposal: Proposal = { id: group, label: top.label, author: top.author, ops: clone(top.ops), revision: this.song.revision, stale: false };
    this.proposals.push(proposal);
    this.emit({ revision: this.song.revision, ops: [] });
    return clone(proposal);
  }

  /** Accepts a pending proposal: one undo step, the user as actor and the AI as author. */
  acceptProposal(id: string, actor: Authorship, label: string): void {
    const p = this.proposals.find((x) => x.id === id);
    if (!p) throw new CommandError(`There is no proposal ${id}`);
    if (p.stale) throw new CommandError("The proposal is out of date: what it touches changed after it was made");
    try {
      this.transact({ actor, author: p.author, label }, (tx) => {
        for (const op of p.ops) tx.apply(op);
      });
    } catch (error) {
      p.stale = true;
      this.emit({ revision: this.song.revision, ops: [] });
      throw error;
    }
    this.proposals.splice(this.proposals.indexOf(p), 1);
    this.emit({ revision: this.song.revision, ops: [] });
  }

  /** Drops a pending proposal. The song does not change. */
  discardProposal(id: string): boolean {
    const i = this.proposals.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.proposals.splice(i, 1);
    this.emit({ revision: this.song.revision, ops: [] });
    return true;
  }

  /** The song with a proposal applied (a copy), to hear it before accepting. Null if it no longer applies. */
  songWithProposal(id: string): Song | null {
    const p = this.proposals.find((x) => x.id === id);
    if (!p) return null;
    const copy = structuredClone(this.song);
    try {
      for (const op of p.ops) applyOp(copy, op);
    } catch {
      return null;
    }
    return copy;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Label of the step that undo would revert, for the Edit menu. */
  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  subscribe(listener: (patch: Patch) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Runs `fn` as one transaction. If it throws, the song is left exactly as it was.
   * A transaction that changes nothing creates no revision and no undo step.
   */
  transact<T>(meta: TransactionMeta, fn: (tx: Transaction) => T): T {
    if (this.inTransaction) throw new CommandError("Transactions cannot be nested");
    const author = meta.author ?? meta.actor;
    const tx = new Transaction(this.song, meta.actor, author);
    this.inTransaction = true;
    let result: T;
    try {
      result = fn(tx);
    } catch (error) {
      tx.rollback();
      throw error;
    } finally {
      this.inTransaction = false;
    }
    if (tx.ops.length === 0) return result;
    const top = this.undoStack.at(-1);
    if (meta.group !== undefined && top !== undefined && top === this.openStep && top.group === meta.group) {
      top.ops.push(...tx.ops);
      top.inverses.push(...tx.inverses);
      this.redoStack.length = 0;
      this.commit("edit", top.actor, top.author, top.label, tx.ops, true);
      return result;
    }
    const step: UndoStep = { ops: tx.ops, inverses: tx.inverses, actor: meta.actor, author, label: meta.label };
    if (meta.group !== undefined) step.group = meta.group;
    this.undoStack.push(step);
    this.redoStack.length = 0;
    // Open before the patch goes out, so its listeners see the step as still growing.
    this.openStep = step;
    this.commit("edit", meta.actor, author, meta.label, tx.ops);
    return result;
  }

  /**
   * True when the last change extended the previous step instead of creating one: its history
   * entry was replaced (same step, newer revision), not added.
   */
  get lastChangeMerged(): boolean {
    return this.merged;
  }

  /** Stops a group from growing (the intervention ended): the next transaction is a new step. */
  closeGroup(group: string): void {
    if (this.openStep?.group !== group) return;
    this.openStep = null;
    // Nothing changed in the song, but the last step is now finished: "Con / Sin" can compare it.
    this.emit({ revision: this.song.revision, ops: [] });
  }

  /**
   * The last step, when an AI made it and its intervention has ended: what "Con / Sin" compares
   * (the user hears the song with and without it). Null as soon as anything else is on top.
   */
  get lastAiStep(): { label: string; author: Authorship; revision: number } | null {
    const top = this.undoStack.at(-1);
    if (!top || top.author.by !== "ai" || top === this.openStep) return null;
    return { label: top.label, author: top.author, revision: this.song.revision };
  }

  /** The song as it was before the last step (a copy; the song itself does not change). */
  songBeforeLastStep(): Song | null {
    const top = this.undoStack.at(-1);
    if (!top) return null;
    const before = structuredClone(this.song);
    for (const op of [...top.inverses].reverse()) applyOp(before, op);
    return before;
  }

  /** Undoes the last transaction, whoever made it. Returns false if there is nothing to undo. */
  undo(actor: Authorship): boolean {
    const step = this.undoStack.pop();
    if (!step) return false;
    const ops = [...step.inverses].reverse();
    for (const op of ops) applyOp(this.song, op);
    this.openStep = null;
    this.redoStack.push(step);
    this.commit("undo", actor, step.author, step.label, ops);
    return true;
  }

  redo(actor: Authorship): boolean {
    const step = this.redoStack.pop();
    if (!step) return false;
    const inverses: Op[] = [];
    for (const op of step.ops) inverses.push(applyOp(this.song, op));
    this.openStep = null;
    this.undoStack.push({ ...step, inverses });
    this.commit("redo", actor, step.author, step.label, step.ops);
    return true;
  }

  /** Changes the shared context. Not undoable, no new revision. */
  setContext(changes: Partial<SharedContext>): void {
    const ops: Op[] = [];
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) continue;
      const op: Op = { op: "set", path: ["context", key], value };
      applyOp(this.song, op);
      ops.push(op);
    }
    ops.push(...this.pruneContext());
    if (ops.length > 0) this.emit({ revision: this.song.revision, ops });
  }

  private commit(kind: HistoryEntry["kind"], actor: Authorship, author: Authorship, label: string, ops: Op[], merge = false): void {
    // A change to what a pending proposal touches makes it stale (it would no longer apply as made).
    if (this.proposals.length) {
      const keys = new Set(ops.map((op) => touchKey(op.path)));
      for (const p of this.proposals) if (!p.stale && p.ops.some((op) => keys.has(touchKey(op.path)))) p.stale = true;
    }
    this.song.revision += 1;
    const entry: HistoryEntry = { revision: this.song.revision, kind, actor, author, label, at: this.now() };
    if (merge) this.history[this.history.length - 1] = entry;
    else this.history.push(entry);
    this.merged = merge;
    const all: Op[] = [...ops, ...this.pruneContext(), { op: "set", path: ["counters"], value: this.song.counters }];
    this.emit({ revision: this.song.revision, ops: all });
  }

  /** Drops deleted notes and tracks from the shared context. */
  private pruneContext(): Op[] {
    const ops: Op[] = [];
    const ctx = this.song.context;
    const selection = ctx.selection.filter((id) => id in this.song.notes);
    if (selection.length !== ctx.selection.length) {
      ops.push({ op: "set", path: ["context", "selection"], value: selection });
      ctx.selection = selection;
    }
    if (ctx.activeTrackId !== null && !(ctx.activeTrackId in this.song.tracks)) {
      ops.push({ op: "set", path: ["context", "activeTrackId"], value: null });
      ctx.activeTrackId = null;
    }
    return ops;
  }

  private emit(patch: Patch): void {
    for (const listener of this.listeners) listener(clone(patch));
  }
}
