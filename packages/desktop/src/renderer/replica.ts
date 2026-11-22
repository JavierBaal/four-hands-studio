/**
 * The window's copy of the song (docs/architecture.md, 8), kept up to date with the main process's
 * patches. The window never changes it directly: every change goes out as commands and comes back
 * as a patch, the same way the AI's changes arrive.
 */
import { type CommandData, type HistoryEntry, type SharedContext, type Song, applyOp } from "@fourhands/core";
import type { FileState, PatchMessage, Reply, Request, UndoState } from "../shared/protocol.js";
import type { Bridge } from "./bridge.js";

export class Replica {
  song!: Song;
  history: HistoryEntry[] = [];
  file!: FileState;
  undo: UndoState = { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null, lastAi: null };
  /** Increases on every change, for React and the canvas. */
  version = 0;
  /** Notes added since the last draw, for the AI fade-in (docs/design.md, 9). */
  readonly fresh = new Map<string, number>();
  private listeners = new Set<() => void>();

  constructor(private readonly bridge: Bridge) {}

  async init(): Promise<void> {
    await this.load();
    this.bridge.onPatch((m) => this.apply(m));
    this.bridge.onFile((f) => {
      this.file = f;
      this.bump();
    });
    this.bridge.onReload(() => void this.load());
  }

  private async load(): Promise<void> {
    const s = await this.bridge.snapshot();
    this.song = s.song;
    this.history = s.history;
    this.file = s.file;
    this.undo = { canUndo: s.canUndo, canRedo: s.canRedo, undoLabel: s.undoLabel, redoLabel: s.redoLabel, lastAi: s.lastAi ?? null, proposals: s.proposals ?? [], steps: s.steps ?? [], baseRevision: s.baseRevision ?? 0 };
    this.fresh.clear();
    this.bump();
  }

  apply(m: PatchMessage): void {
    for (const op of m.patch.ops) {
      applyOp(this.song, op);
      if (op.op === "set" && op.path.length === 2 && op.path[0] === "notes") this.fresh.set(op.path[1]!, performance.now());
    }
    this.song.revision = m.patch.revision;
    if (m.replacesLast) this.history.splice(-1, 1, ...m.history);
    else this.history.push(...m.history);
    this.undo = { canUndo: m.canUndo, canRedo: m.canRedo, undoLabel: m.undoLabel, redoLabel: m.redoLabel, lastAi: m.lastAi ?? null, proposals: m.proposals ?? [], steps: m.steps ?? [], baseRevision: m.baseRevision ?? 0 };
    this.bump();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private bump(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** One gesture: one transaction, one undo step. */
  run(label: string, commands: CommandData[]): Promise<Reply> {
    if (commands.length === 0) return Promise.resolve({ ok: true, results: [] });
    return this.bridge.request({ type: "run", label, commands }).then((reply) => {
      if (!reply.ok) this.bridge.log({ type: "command_failed", label, error: reply.error });
      return reply;
    });
  }

  undoLast(): Promise<Reply> {
    return this.bridge.request({ type: "undo" });
  }

  /** The history panel: back or forward to right after a step (0: the song as opened). */
  goTo(revision: number): Promise<Reply> {
    return this.bridge.request({ type: "goTo", revision });
  }

  redoLast(): Promise<Reply> {
    return this.bridge.request({ type: "redo" });
  }

  /** Proposal mode (H4): accept or discard a pending proposal. */
  request(r: Extract<Request, { type: "acceptProposal" | "discardProposal" }>): Promise<Reply> {
    return this.bridge.request(r).then((reply) => {
      if (!reply.ok) this.bridge.log({ type: "proposal_failed", request: r.type, error: reply.error });
      else this.bridge.log({ type: r.type === "acceptProposal" ? "proposal_accepted" : "proposal_discarded", id: r.id });
      return reply;
    });
  }

  setContext(changes: Partial<SharedContext>): Promise<Reply> {
    return this.bridge.request({ type: "setContext", changes });
  }
}
