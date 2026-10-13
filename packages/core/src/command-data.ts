/**
 * Commands as data: what the window sends to the main process for one gesture, and what an AI
 * proposal stores until it is accepted (H4). `runCommands` applies a list inside one transaction.
 */
import {
  type NoteChange,
  type NoteSpec,
  type SongProperties,
  type TrackChanges,
  type TrackSpec,
  addAnnotation,
  addNotes,
  addSection,
  addTrack,
  deleteNotes,
  moveNotes,
  moveTrack,
  removeAnnotation,
  removeSection,
  removeTrack,
  setChord,
  setPedal,
  setSongProperties,
  updateNotes,
  updateSection,
  updateTrack,
} from "./commands.js";
import { CommandError, type Transaction } from "./document.js";
import type { Annotation, PedalSpan, Section } from "./model.js";

export type CommandData =
  | { type: "addNotes"; trackId: string; notes: NoteSpec[] }
  | { type: "updateNotes"; changes: NoteChange[] }
  | { type: "moveNotes"; ids: string[]; ticks?: number; semitones?: number }
  | { type: "deleteNotes"; ids: string[] }
  | { type: "addTrack"; spec: TrackSpec }
  | { type: "updateTrack"; id: string; changes: TrackChanges }
  | { type: "removeTrack"; id: string }
  | { type: "moveTrack"; id: string; index: number }
  | { type: "setPedal"; trackId: string; spans: PedalSpan[] }
  | { type: "addSection"; spec: Omit<Section, "id"> }
  | { type: "updateSection"; id: string; changes: Partial<Omit<Section, "id">> }
  | { type: "removeSection"; id: string }
  | { type: "setChord"; tick: number; symbol: string | null }
  | { type: "addAnnotation"; spec: Omit<Annotation, "id" | "author"> }
  | { type: "removeAnnotation"; id: string }
  | { type: "setSongProperties"; props: SongProperties };

/** What each command returns: new ids for the commands that create things, otherwise null. */
export type CommandResult = string[] | string | null;

export function runCommand(tx: Transaction, c: CommandData): CommandResult {
  switch (c.type) {
    case "addNotes":
      return addNotes(tx, c.trackId, c.notes);
    case "updateNotes":
      updateNotes(tx, c.changes);
      return null;
    case "moveNotes": {
      const by: { ticks?: number; semitones?: number } = {};
      if (c.ticks !== undefined) by.ticks = c.ticks;
      if (c.semitones !== undefined) by.semitones = c.semitones;
      moveNotes(tx, c.ids, by);
      return null;
    }
    case "deleteNotes":
      deleteNotes(tx, c.ids);
      return null;
    case "addTrack":
      return addTrack(tx, c.spec);
    case "updateTrack":
      updateTrack(tx, c.id, c.changes);
      return null;
    case "removeTrack":
      removeTrack(tx, c.id);
      return null;
    case "moveTrack":
      moveTrack(tx, c.id, c.index);
      return null;
    case "setPedal":
      setPedal(tx, c.trackId, c.spans);
      return null;
    case "addSection":
      return addSection(tx, c.spec);
    case "updateSection":
      updateSection(tx, c.id, c.changes);
      return null;
    case "removeSection":
      removeSection(tx, c.id);
      return null;
    case "setChord":
      setChord(tx, c.tick, c.symbol);
      return null;
    case "addAnnotation":
      return addAnnotation(tx, c.spec);
    case "removeAnnotation":
      removeAnnotation(tx, c.id);
      return null;
    case "setSongProperties":
      setSongProperties(tx, c.props);
      return null;
    default:
      throw new CommandError(`Unknown command: ${(c as { type?: unknown }).type}`);
  }
}

/** Applies a list of commands in order and returns their results, in the same order. */
export function runCommands(tx: Transaction, commands: readonly CommandData[]): CommandResult[] {
  return commands.map((c) => runCommand(tx, c));
}
