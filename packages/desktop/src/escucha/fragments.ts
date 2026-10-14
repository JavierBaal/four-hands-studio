/**
 * The passages of the blind listening test (ARQUITECTURA.md, 7.2): the same notes of Dilatación
 * for every candidate SoundFont, as timed synth events.
 */
import { type Song, barStart, orderedTracks } from "@fourhands/core";
import type { SynthEvent } from "../shared/messages.js";
import { secondsPerTick } from "../audio/schedule.js";
import { type BankPreset, looksGeneralMidi } from "../shared/soundbank-info.js";

/** What a passage asks each bank for. */
export type Role = "piano" | "strings" | "cello";

export interface Fragment {
  id: "piano" | "strings";
  /** Track names to play (found by order: piano = 2nd track; strings = 3rd and 4th). */
  trackIndexes: number[];
  /** What each of those tracks plays (the piano track is a piano in any bank). */
  roles: Role[];
  fromBar: number;
  toBar: number;
}

export const FRAGMENTS: Fragment[] = [
  { id: "piano", trackIndexes: [1], roles: ["piano"], fromBar: 1, toBar: 8 },
  { id: "strings", trackIndexes: [2, 3], roles: ["strings", "cello"], fromBar: 9, toBar: 16 },
];

const GM: Record<Role, number> = { piano: 0, strings: 48, cello: 42 };
const NAMES: Record<Role, RegExp[]> = {
  piano: [/grand|concert piano|steinway|yamaha|bösendorfer|bosendorfer/i, /piano/i],
  strings: [/strings?\b(?!.*(pizz|stacc|trem|spicc))/i, /(1st |first )?violins?(?!.*(pizz|stacc|trem|spicc))/i, /ensemble/i],
  cello: [/cellos?(?!.*(pizz|stacc|trem|spicc))/i, /violoncell/i],
};
const SHORT = /pizz|stacc|trem|spicc|marcato|harmon/i;

/**
 * The preset of a bank that plays a role. A General MIDI bank answers by number (piano 0, strings
 * 48, cello 42); any other by name, so a bank that numbers its own way (Sonatina keeps its strings
 * on 2) is not asked for a number it does not have, which a synth would answer with its first
 * preset, often a piano (Fran, 14/10/2026). A cello falls back to the strings. Null: the bank has
 * no such instrument, and that bank sits out the passage.
 */
export function pickPreset(presets: readonly BankPreset[], role: Role): BankPreset | null {
  const melodic = presets.filter((p) => p.bankMSB < 128);
  if (looksGeneralMidi(melodic)) {
    const gm = melodic.find((p) => p.bankMSB === 0 && p.program === GM[role]);
    if (gm) return gm;
  }
  for (const pattern of NAMES[role]) {
    const found = melodic.find((p) => pattern.test(p.name) && !SHORT.test(p.name));
    if (found) return found;
  }
  return role === "cello" ? pickPreset(presets, "strings") : null;
}

/** The presets a bank uses for a passage, or null if it lacks one of its instruments. */
export function presetsFor(presets: readonly BankPreset[], f: Fragment): BankPreset[] | null {
  const out: BankPreset[] = [];
  for (const role of f.roles) {
    const p = pickPreset(presets, role);
    if (!p) return null;
    out.push(p);
  }
  return out;
}

/** The passage as events. `chosen`: the presets from `presetsFor` (by default, General MIDI numbers). */
export function fragmentEvents(song: Song, f: Fragment, chosen?: readonly BankPreset[]): { setup: SynthEvent[]; events: { at: number; ev: SynthEvent }[] } {
  const tracks = orderedTracks(song);
  const from = barStart(song.meter, f.fromBar);
  const to = barStart(song.meter, f.toBar + 1);
  const spt = secondsPerTick(song);
  const setup: SynthEvent[] = [];
  const events: { at: number; ev: SynthEvent }[] = [];
  f.trackIndexes.forEach((index, i) => {
    const track = tracks[index];
    if (!track) return;
    const preset = chosen?.[i] ?? { program: GM[f.roles[i]!], bankMSB: 0 };
    setup.push({ kind: "prog", ch: track.channel, prog: preset.program, bank: preset.bankMSB }, { kind: "cc", ch: track.channel, cc: 7, value: 110 });
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
