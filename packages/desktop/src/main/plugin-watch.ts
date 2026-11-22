/**
 * F2.1, keeping the files small (29/10/2026): what goes into the file for a plugin, and when
 * to look whether it changed.
 *
 * - Packed: the engine's text for a plugin's state, deflated. A sampler's state is mostly its
 *   settings as text, so it shrinks a lot; "z" marks it (the engine's own text starts with a digit).
 * - Watched only while its window is on screen (and once more after it closes): a plugin only
 *   changes from the user's hand there. Kontakt reports a new state on every question even when
 *   nobody touches it, so asking every 20 s saved the whole song every 20 s.
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { PluginStates } from "@fourhands/core";

const PACKED = "z";

export function packState(data: string): string {
  if (!data || data.startsWith(PACKED)) return data;
  return PACKED + deflateRawSync(Buffer.from(data, "latin1"), { level: 9 }).toString("base64");
}

export function unpackState(data: string): string {
  if (!data.startsWith(PACKED)) return data;
  return inflateRawSync(Buffer.from(data.slice(PACKED.length), "base64")).toString("latin1");
}

export function packStates(states: PluginStates): PluginStates {
  return Object.fromEntries(Object.entries(states).map(([k, s]) => [k, { id: s.id, data: packState(s.data) }]));
}

/** A state that cannot be unpacked is left out: the plugin opens as it starts. */
export function unpackStates(states: PluginStates): PluginStates {
  const out: PluginStates = {};
  for (const [k, s] of Object.entries(states)) {
    try {
      out[k] = { id: s.id, data: unpackState(s.data) };
    } catch {
      // Damaged: skip it.
    }
  }
  return out;
}

/** With an engine that cannot say which windows are open: watch a slot this long after showing it. */
export const SHOWN_WATCH_MS = 5 * 60_000;

export class PluginWatch {
  private shownAt = new Map<number, number>();
  private wasOpen = new Set<number>();

  /** The user opened a slot's window. */
  shown(slot: number, now: number): void {
    this.shownAt.set(slot, now);
  }

  /**
   * The slots to ask now. `open`: the slots with their window on screen, from the engine, or null
   * if it cannot tell (an engine built before 29/10/2026).
   */
  slotsToCheck(open: number[] | null, now: number): Set<number> {
    const out = new Set<number>();
    if (open) {
      for (const s of open) out.add(s);
      // Closed since the last look: one more time, for what changed just before closing.
      for (const s of this.wasOpen) out.add(s);
      this.wasOpen = new Set(open);
      return out;
    }
    for (const [slot, at] of this.shownAt) if (now - at < SHOWN_WATCH_MS) out.add(slot);
    return out;
  }
}
