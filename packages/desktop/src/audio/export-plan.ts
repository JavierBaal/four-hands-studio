/**
 * Export (F2.4, docs/audio-engine.md, 5): the whole song, or the loop, as the engine messages that
 * play it, timed from the start of the export. The same events and the same translation as playback
 * (schedule.ts, router.ts), so the file sounds as Four Hands sounds: only "now" becomes "the start".
 * Tracks sent to another program by MIDI are not in the file.
 */
import { type Song, PPQ, barAt, barStart, bpmAt, secondsBetween, songEnd } from "@fourhands/core";
import type { SynthEvent } from "../shared/messages.js";
import { type EngineMidiEvent, type EngineTransportPoint, SOUNDS_SLOT } from "../shared/engine.js";
import { engineBytes, soundsBytes } from "./router.js";
import { type SoundResolver, type StripResolver, curveStateEvents, noteEvents, setupEvents } from "./schedule.js";

export type ExportRangeKind = "song" | "loop";

/** Song ticks: from `from` to `to` (the tail comes after, in the engine). */
export interface ExportRange {
  from: number;
  to: number;
}

/** The whole song (bar 1 to the end of the last note) or the loop; null when there is nothing to export. */
export function exportRange(song: Song, kind: ExportRangeKind): ExportRange | null {
  if (kind === "loop") {
    const loop = song.context.loop;
    return loop && loop.end > loop.start ? { from: loop.start, to: loop.end } : null;
  }
  const end = songEnd(song);
  return end > 0 ? { from: 0, to: end } : null;
}

export interface ExportRouting {
  stripOf: StripResolver;
  soundFor: SoundResolver;
  /** Strips whose track plays through a plugin of the engine. */
  plugin: ReadonlySet<number>;
  /** Strips whose track is sent to another program by MIDI: left out of the file. */
  external: ReadonlySet<number>;
  /** The metronome's strip (its program goes in the setup, as in playback; it never plays). */
  metronomeStrip?: number;
}

export interface ExportMessages {
  midi: EngineMidiEvent[];
  transport: EngineTransportPoint[];
  /** The range's length in seconds, with the tempo map. */
  seconds: number;
}

/** The plugins' transport at a song tick, `delay` seconds after the start of the export. */
function transportAt(song: Song, tick: number, delay: number): EngineTransportPoint {
  const bar = barStart(song.meter, barAt(song.meter, tick));
  return { delay, playing: true, ppq: tick / PPQ, bpm: bpmAt(song, tick), num: song.meter.numerator, den: song.meter.denominator, bar: bar / PPQ };
}

export function exportMessages(song: Song, range: ExportRange, routing: ExportRouting): ExportMessages {
  const at = (tick: number) => Math.max(0, secondsBetween(song, range.from, tick));
  const stripOf = (ev: Exclude<SynthEvent, { kind: "panic" }>) => ev.strip ?? ev.ch;
  const midi: EngineMidiEvent[] = [];
  const add = (time: number, ev: SynthEvent) => {
    if (ev.kind === "panic") return;
    const strip = stripOf(ev);
    if (routing.plugin.has(strip)) {
      const data = engineBytes(ev);
      if (data) midi.push({ slot: strip, delay: time, data });
      return;
    }
    if (routing.external.has(strip)) return;
    for (const data of soundsBytes(ev)) midi.push({ slot: SOUNDS_SLOT, delay: time, data, ch: strip });
  };
  // Programs, volume and pan first, then the curves as they stand where the export starts.
  for (const ev of setupEvents(song, routing.soundFor, routing.stripOf, routing.metronomeStrip)) add(0, ev);
  for (const ev of curveStateEvents(song, range.from, routing.stripOf)) add(0, ev);
  // A loop cuts its notes at its end, as playback does; the whole song lets them ring.
  const cutAt = range.from > 0 || range.to < songEnd(song) ? range.to : Infinity;
  const notes = noteEvents(song, range.from, range.to, cutAt, routing.stripOf).sort((a, b) => a.tick - b.tick);
  for (const e of notes) add(at(e.tick), e.ev);
  // Stable: events at the same moment keep their order (a note-off before the next note-on).
  midi.sort((a, b) => a.delay - b.delay);

  // Where the song is for the plugins: the start, then every quarter note.
  const transport: EngineTransportPoint[] = [transportAt(song, range.from, 0)];
  for (let tick = Math.floor(range.from / PPQ) * PPQ + PPQ; tick < range.to; tick += PPQ) transport.push(transportAt(song, tick, at(tick)));
  return { midi, transport, seconds: secondsBetween(song, range.from, range.to) };
}

/** Engine messages are framed one by one: a long song goes in pieces. */
export function chunks<T>(items: readonly T[], size = 2000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
