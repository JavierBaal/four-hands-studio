/**
 * Tempo and key over time (H4, Fran 26/10/2026): the song's first tempo and key plus their
 * changes. Every conversion between ticks and seconds goes through here, so playback, the summary,
 * analysis and the AI all agree.
 *
 * Ramps are linear in BPM between two points. Seconds inside a ramp come from the integral of
 * 60 / (PPQ * bpm(x)), which has a closed form: 60 / (PPQ * k) * ln(b1 / b0), with k the BPM per tick.
 */
import { type KeySignature, type Song, type TempoPoint } from "./model.js";
import { PPQ } from "./time.js";

type TempoSong = Pick<Song, "tempo" | "tempoChanges">;
type KeySong = Pick<Song, "key" | "keyChanges">;

/** A stretch of constant or gliding tempo, from `tick` up to the next segment. */
interface Segment {
  tick: number;
  /** BPM at `tick`. */
  bpm: number;
  /** BPM per tick: 0 when constant. */
  slope: number;
  /** Seconds from the start of the song to `tick`. */
  seconds: number;
}

const cache = new WeakMap<object, { key: string; segments: Segment[] }>();

/** The tempo points with the start included: tick 0 first, sorted, one per tick. */
export function tempoPoints(song: TempoSong): TempoPoint[] {
  return [{ tick: 0, tempo: song.tempo }, ...(song.tempoChanges ?? []).filter((p) => p.tick > 0)];
}

function segments(song: TempoSong): Segment[] {
  const key = `${song.tempo}|${JSON.stringify(song.tempoChanges ?? [])}`;
  const hit = cache.get(song);
  if (hit && hit.key === key) return hit.segments;
  const points = tempoPoints(song);
  const out: Segment[] = [];
  let seconds = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const next = points[i + 1];
    const b0 = 60_000_000 / p.tempo;
    const slope = next?.ramp ? (60_000_000 / next.tempo - b0) / (next.tick - p.tick) : 0;
    out.push({ tick: p.tick, bpm: b0, slope, seconds });
    if (next) seconds += spanSeconds(b0, slope, next.tick - p.tick);
  }
  cache.set(song, { key, segments: out });
  return out;
}

/** Seconds to cover `ticks` from a point at `bpm` that changes by `slope` BPM per tick. */
function spanSeconds(bpm: number, slope: number, ticks: number): number {
  if (Math.abs(slope) < 1e-12) return (ticks * 60) / (PPQ * bpm);
  return (60 / (PPQ * slope)) * Math.log((bpm + slope * ticks) / bpm);
}

/** Ticks covered in `seconds` from a point at `bpm` that changes by `slope` BPM per tick. */
function spanTicks(bpm: number, slope: number, seconds: number): number {
  if (Math.abs(slope) < 1e-12) return (seconds * PPQ * bpm) / 60;
  return (bpm * (Math.exp((seconds * PPQ * slope) / 60) - 1)) / slope;
}

function segmentAt(segs: Segment[], tick: number): Segment {
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid]!.tick <= tick) lo = mid;
    else hi = mid - 1;
  }
  return segs[lo]!;
}

/** BPM at a tick (inside a ramp, the BPM at that exact point). */
export function bpmAt(song: TempoSong, tick: number): number {
  const s = segmentAt(segments(song), Math.max(0, tick));
  return s.bpm + s.slope * (Math.max(0, tick) - s.tick);
}

/** Seconds from the start of the song to a tick. Negative ticks use the first tempo. */
export function secondsAt(song: TempoSong, tick: number): number {
  if (tick <= 0) return (tick * 60) / (PPQ * (60_000_000 / song.tempo));
  const s = segmentAt(segments(song), tick);
  return s.seconds + spanSeconds(s.bpm, s.slope, tick - s.tick);
}

/** Seconds between two ticks (`to` after `from`). */
export function secondsBetween(song: TempoSong, from: number, to: number): number {
  return secondsAt(song, to) - secondsAt(song, from);
}

/** The tick reached `seconds` after the start of the song (fractional). */
export function tickAtSeconds(song: TempoSong, seconds: number): number {
  if (seconds <= 0) return (seconds * PPQ * (60_000_000 / song.tempo)) / 60;
  const segs = segments(song);
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid]!.seconds <= seconds) lo = mid;
    else hi = mid - 1;
  }
  const s = segs[lo]!;
  return s.tick + spanTicks(s.bpm, s.slope, seconds - s.seconds);
}

/** The tick `seconds` after `from` (fractional). */
export function tickAfter(song: TempoSong, from: number, seconds: number): number {
  return tickAtSeconds(song, secondsAt(song, from) + seconds);
}

/** True when the song has a single tempo. */
export function steadyTempo(song: TempoSong): boolean {
  return !(song.tempoChanges ?? []).some((p) => p.tick > 0);
}

/** The key in force at a tick. */
export function keyAt(song: KeySong, tick: number): KeySignature {
  let key = song.key;
  for (const c of song.keyChanges ?? []) {
    if (c.tick > tick) break;
    key = c.key;
  }
  return key;
}

/** The keys over a span, with where each starts (the first one at `from`). */
export function keysIn(song: KeySong, from: number, to: number): { tick: number; key: KeySignature }[] {
  const out = [{ tick: from, key: keyAt(song, from) }];
  for (const c of song.keyChanges ?? []) if (c.tick > from && c.tick < to) out.push({ tick: c.tick, key: c.key });
  return out;
}
