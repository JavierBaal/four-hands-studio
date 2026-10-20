/**
 * What sounds when (ARQUITECTURA.md, 7.1): pure functions the player calls every 25 ms to send
 * the next ~200 ms to the synth worklet. Reading the replica at every window means notes the AI
 * writes ahead of the playhead simply play when it gets there.
 */
import { type Song, CURVE_CC, CURVE_DEFAULT, CURVE_KINDS, PPQ, beatTicks, barTicks, curveValueAt, type Track } from "@fourhands/core";
import type { SynthEvent } from "../shared/messages.js";

/** The metronome uses its own channel and a woodblock, so it never clashes with a track. */
export const METRONOME_CHANNEL = 15;
export const METRONOME_PROGRAM = 115;

export function secondsPerTick(song: Pick<Song, "tempo">): number {
  return song.tempo / 1_000_000 / PPQ;
}

/** Tracks that sound: solo wins over mute; with no solo, every track not muted. */
export function audibleTracks(song: Song): Set<string> {
  const tracks = song.trackOrder.map((id) => song.tracks[id]).filter((t) => t !== undefined);
  const solo = tracks.filter((t) => t.solo);
  return new Set((solo.length > 0 ? solo : tracks.filter((t) => !t.mute)).map((t) => t.id));
}

export interface TickEvent {
  tick: number;
  ev: SynthEvent;
}

/**
 * Note events that start in [from, to), plus their note-offs (which may fall after `to`).
 * `cutAt`: notes are cut there (the loop end), so nothing keeps ringing across the jump.
 */
export function noteEvents(song: Song, from: number, to: number, cutAt = Infinity): TickEvent[] {
  const audible = audibleTracks(song);
  const out: TickEvent[] = [];
  for (const n of Object.values(song.notes)) {
    if (n.start < from || n.start >= to || !audible.has(n.trackId)) continue;
    const track = song.tracks[n.trackId]!;
    const end = Math.min(n.start + n.duration, cutAt);
    out.push({ tick: n.start, ev: { kind: "on", ch: track.channel, note: n.pitch, vel: n.velocity } });
    out.push({ tick: Math.max(n.start + 1, end), ev: { kind: "off", ch: track.channel, note: n.pitch } });
  }
  for (const id of audible) {
    const track = song.tracks[id]!;
    for (const p of track.pedal) {
      if (p.start >= from && p.start < to) out.push({ tick: p.start, ev: { kind: "cc", ch: track.channel, cc: 64, value: 127 } });
      if (p.end >= from && p.end < to) out.push({ tick: Math.min(p.end, cutAt), ev: { kind: "cc", ch: track.channel, cc: 64, value: 0 } });
    }
    // Expression (CC11) and modulation (CC1), H4: each point when playback reaches it.
    for (const kind of CURVE_KINDS)
      for (const p of track.curves?.[kind] ?? []) {
        if (p.tick >= to) break;
        if (p.tick >= from) out.push({ tick: p.tick, ev: { kind: "cc", ch: track.channel, cc: CURVE_CC[kind], value: p.value } });
      }
  }
  return out.sort((a, b) => a.tick - b.tick || (a.ev.kind === "off" ? -1 : 0) - (b.ev.kind === "off" ? -1 : 0));
}

/**
 * Where the curves stand at a tick, for every track that has one: sent when playback starts or
 * jumps (the loop), so a crescendo heard from its middle starts at its middle value.
 */
export function curveStateEvents(song: Song, tick: number): SynthEvent[] {
  const out: SynthEvent[] = [];
  for (const id of song.trackOrder) {
    const t = song.tracks[id];
    if (!t?.curves) continue;
    for (const kind of CURVE_KINDS) if (t.curves[kind]?.length) out.push({ kind: "cc", ch: t.channel, cc: CURVE_CC[kind], value: curveValueAt(t.curves[kind], kind, tick) });
  }
  return out;
}

/** Back to the defaults after playing, so what the user auditions is not stuck at a quiet value. */
export function curveResetEvents(song: Song): SynthEvent[] {
  const out: SynthEvent[] = [];
  for (const id of song.trackOrder) {
    const t = song.tracks[id];
    if (!t?.curves) continue;
    for (const kind of CURVE_KINDS) if (t.curves[kind]?.length) out.push({ kind: "cc", ch: t.channel, cc: CURVE_CC[kind], value: CURVE_DEFAULT[kind] });
  }
  return out;
}

/** Metronome clicks in [from, to): a higher one on the first beat of each bar. */
export function clickEvents(song: Song, from: number, to: number): TickEvent[] {
  const beat = beatTicks(song.meter);
  const bar = barTicks(song.meter);
  const out: TickEvent[] = [];
  for (let t = Math.ceil(from / beat) * beat; t < to; t += beat) {
    const down = t % bar === 0;
    out.push({ tick: t, ev: { kind: "on", ch: METRONOME_CHANNEL, note: down ? 84 : 77, vel: down ? 110 : 80 } });
    out.push({ tick: t + PPQ / 8, ev: { kind: "off", ch: METRONOME_CHANNEL, note: down ? 84 : 77 } });
  }
  return out;
}

/** Bank select and preset a track plays with, when it is not the default bank's General MIDI program. */
export type SoundResolver = (track: Track) => { bank: number; prog: number } | null;

/** Programs (with their bank), volume and pan of every track, to send before playing. */
export function setupEvents(song: Song, soundFor: SoundResolver = () => null): SynthEvent[] {
  const out: SynthEvent[] = [{ kind: "prog", ch: METRONOME_CHANNEL, prog: METRONOME_PROGRAM, bank: 0 }];
  for (const id of song.trackOrder) {
    const t = song.tracks[id];
    if (!t) continue;
    const custom = t.channel !== 9 ? soundFor(t) : null;
    if (custom) out.push({ kind: "prog", ch: t.channel, prog: custom.prog, bank: custom.bank });
    else if (t.program !== null && t.channel !== 9) out.push({ kind: "prog", ch: t.channel, prog: t.program, bank: 0 });
    out.push({ kind: "cc", ch: t.channel, cc: 7, value: Math.round(t.volume * 127) });
    out.push({ kind: "cc", ch: t.channel, cc: 10, value: Math.round(64 + t.pan * 63) });
  }
  return out;
}

export interface LoopRange {
  start: number;
  end: number;
}

/**
 * Splits a window of song time into the pieces to schedule, following the loop: when the window
 * crosses the loop end, the rest continues from the loop start.
 * `at` is the song tick where the window starts; `length` its size in ticks.
 * Returns pieces with the song ticks they cover and the offset in ticks from the window start.
 */
export function windowPieces(at: number, length: number, loop: LoopRange | null): { from: number; to: number; offset: number }[] {
  if (!loop || loop.end <= loop.start || at >= loop.end) return [{ from: at, to: at + length, offset: 0 }];
  const out: { from: number; to: number; offset: number }[] = [];
  let pos = at;
  let offset = 0;
  let left = length;
  while (left > 0) {
    const room = loop.end - pos;
    const take = Math.min(room, left);
    out.push({ from: pos, to: pos + take, offset });
    left -= take;
    offset += take;
    pos = pos + take >= loop.end ? loop.start : pos + take;
  }
  return out;
}
