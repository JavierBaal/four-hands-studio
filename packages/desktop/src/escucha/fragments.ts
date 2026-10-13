/**
 * The passages of the blind listening test (ARQUITECTURA.md, 7.2): the same notes of Dilatación
 * for every candidate SoundFont, as timed synth events.
 */
import { type Song, barStart, orderedTracks } from "@fourhands/core";
import type { SynthEvent } from "../shared/messages.js";
import { secondsPerTick } from "../audio/schedule.js";

export interface Fragment {
  id: "piano" | "strings";
  /** Track names to play (found by order: piano = 2nd track; strings = 3rd and 4th). */
  trackIndexes: number[];
  /** Program to force on those tracks (the piano track is piano in any SoundFont). */
  programs: (number | null)[];
  fromBar: number;
  toBar: number;
}

export const FRAGMENTS: Fragment[] = [
  { id: "piano", trackIndexes: [1], programs: [0], fromBar: 1, toBar: 8 },
  { id: "strings", trackIndexes: [2, 3], programs: [48, 42], fromBar: 9, toBar: 16 },
];

export function fragmentEvents(song: Song, f: Fragment): { setup: SynthEvent[]; events: { at: number; ev: SynthEvent }[] } {
  const tracks = orderedTracks(song);
  const from = barStart(song.meter, f.fromBar);
  const to = barStart(song.meter, f.toBar + 1);
  const spt = secondsPerTick(song);
  const setup: SynthEvent[] = [];
  const events: { at: number; ev: SynthEvent }[] = [];
  f.trackIndexes.forEach((index, i) => {
    const track = tracks[index];
    if (!track) return;
    const program = f.programs[i] ?? track.program ?? 0;
    setup.push({ kind: "prog", ch: track.channel, prog: program }, { kind: "cc", ch: track.channel, cc: 7, value: 110 });
    for (const n of Object.values(song.notes)) {
      if (n.trackId !== track.id || n.start < from || n.start >= to) continue;
      const end = Math.min(n.start + n.duration, to);
      events.push({ at: (n.start - from) * spt, ev: { kind: "on", ch: track.channel, note: n.pitch, vel: n.velocity } });
      events.push({ at: (end - from) * spt, ev: { kind: "off", ch: track.channel, note: n.pitch } });
    }
  });
  return { setup, events: events.sort((a, b) => a.at - b.at) };
}

/** Fisher–Yates with an injectable random source, so the order can be tested. */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
