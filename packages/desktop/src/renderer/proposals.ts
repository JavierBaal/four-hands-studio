/**
 * Proposal mode (H4, off by default): what the window needs of a pending proposal. The song with it
 * applied (to hear it with "Con" and to draw its notes with a dashed outline) and its notes.
 */
import { type Note, type Song, applyOp } from "@fourhands/core";
import type { ProposalInfo } from "../shared/protocol.js";

/** The latest pending proposal, the one the bar shows. */
export function currentProposal(proposals: readonly ProposalInfo[] | undefined): ProposalInfo | null {
  return proposals?.at(-1) ?? null;
}

const cache = new WeakMap<ProposalInfo, { revision: number; song: Song | null }>();

/** The song with the proposal applied (a copy), or null if it no longer applies. */
export function songWithProposal(song: Song, p: ProposalInfo): Song | null {
  const hit = cache.get(p);
  if (hit && hit.revision === song.revision) return hit.song;
  let out: Song | null = structuredClone(song);
  try {
    for (const op of p.ops) applyOp(out, op);
  } catch {
    out = null;
  }
  cache.set(p, { revision: song.revision, song: out });
  return out;
}

/** The notes of a track that the proposal adds or changes, as they would be. */
export function proposalNotes(song: Song, p: ProposalInfo, trackId: string): Note[] {
  const touched = new Set(p.ops.filter((op) => op.path[0] === "notes" && op.path[1]).map((op) => op.path[1]!));
  if (touched.size === 0) return [];
  const after = songWithProposal(song, p);
  if (!after) return [];
  return [...touched].map((id) => after.notes[id]).filter((n): n is Note => !!n && n.trackId === trackId);
}

/** How many notes it adds, changes and removes, for the bar. */
export function proposalCounts(song: Song, p: ProposalInfo): { added: number; changed: number; removed: number } {
  const ids = new Set(p.ops.filter((op) => op.path[0] === "notes" && op.path[1]).map((op) => op.path[1]!));
  const after = songWithProposal(song, p);
  let added = 0;
  let changed = 0;
  let removed = 0;
  for (const id of ids) {
    const was = song.notes[id];
    const will = after?.notes[id];
    if (!was && will) added++;
    else if (was && !will) removed++;
    else if (was && will) changed++;
  }
  return { added, changed, removed };
}
