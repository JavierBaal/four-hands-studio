/**
 * MIDI import and export (ARQUITECTURA.md, 9), with `midi-file` (MIT), which reads and writes
 * events without interpreting them.
 *
 * Import turns what the model understands into model data (title, tempo, meter, key, markers on
 * bar lines as sections, notes, program, sustain pedal) and keeps every other event as it is.
 * Export rebuilds the file in a canonical order. A file written in that order (like Dilatacion.mid)
 * comes back byte for byte; any other file comes back with the same events at the same times.
 *
 * Pure: bytes in, bytes out. Reading and writing files is the app's job.
 */
import midiFile from "midi-file";
import type { MidiData, MidiEvent } from "midi-file";
import {
  type Note,
  type Section,
  type Song,
  type Track,
  USER,
  CURVE_CC,
  CURVE_KINDS,
  barAt,
  barStart,
  barTicks,
  emptySong,
  notesOf,
  orderedSections,
  orderedTracks,
  songEnd,
} from "./model.js";
import { PPQ } from "./time.js";

const { parseMidi, writeMidi } = midiFile;

export class MidiFileError extends Error {
  override name = "MidiFileError";
}

export interface MidiImportResult {
  song: Song;
  /** Things the user may want to know (in English, for the log; the window shows its own texts). */
  warnings: string[];
}

interface Timed {
  /** Absolute time in the file's ticks. */
  tick: number;
  /** Position in the source track, for a stable order. */
  seq: number;
  event: MidiEvent;
}

type RawEvent = { type: string; [field: string]: unknown };

const SUSTAIN = 64;
const BANK_SELECT = new Set([0, 32]);
const CONDUCTOR_TYPES = new Set(["setTempo", "timeSignature", "keySignature", "marker", "smpteOffset"]);

function isChannelEvent(e: MidiEvent): e is Extract<MidiEvent, { channel: number }> {
  return "channel" in e && typeof (e as { channel?: unknown }).channel === "number" && !("meta" in e && e.meta);
}

function toAbsolute(track: MidiEvent[]): Timed[] {
  let tick = 0;
  return track.map((event, seq) => {
    tick += event.deltaTime;
    return { tick, seq, event };
  });
}

/** Strips the fields that only make sense inside the file and turns byte arrays into plain arrays. */
function toRaw(event: MidiEvent): RawEvent {
  const { deltaTime: _d, running: _r, ...rest } = event as MidiEvent & { running?: boolean };
  const raw: RawEvent = { ...(rest as RawEvent) };
  if ("data" in raw && raw.data !== undefined) raw.data = Array.from(raw.data as ArrayLike<number>);
  return raw;
}

function mostCommon(values: number[], fallback: number): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = fallback;
  let bestCount = 0;
  for (const [v, c] of counts) if (c > bestCount) [best, bestCount] = [v, c];
  return best;
}

// ---------------------------------------------------------------------------
// Import

export function importMidi(bytes: ArrayLike<number>, options: { title?: string } = {}): MidiImportResult {
  let data: MidiData;
  try {
    data = parseMidi(bytes);
  } catch (error) {
    throw new MidiFileError(`Not a valid MIDI file: ${(error as Error).message}`);
  }
  const tpb = data.header.ticksPerBeat;
  if (!tpb) throw new MidiFileError("MIDI files timed in SMPTE frames are not supported");

  const warnings: string[] = [];
  let rounded = false;
  const toTicks = (t: number): number => {
    const exact = (t * PPQ) / tpb;
    const r = Math.round(exact);
    if (r !== exact) rounded = true;
    return r;
  };

  const song = emptySong(options.title ?? "Sin título");
  song.midiFile.ticksPerBeat = tpb;
  const sources = data.tracks.map(toAbsolute);
  song.midiFile.runningStatus = data.tracks.some((t) => t.some((e) => (e as { running?: boolean }).running));

  // Split into the conductor and the note tracks.
  const conductor: Timed[] = [];
  const noteSources: { events: Timed[] }[] = [];
  if (data.header.format === 0) {
    const only = sources[0] ?? [];
    const byChannel = new Map<number, Timed[]>();
    for (const t of only) {
      if (isChannelEvent(t.event)) {
        const list = byChannel.get(t.event.channel) ?? [];
        list.push(t);
        byChannel.set(t.event.channel, list);
      } else {
        conductor.push(t);
      }
    }
    for (const [, events] of [...byChannel].sort((a, b) => a[0] - b[0])) noteSources.push({ events });
  } else {
    sources.forEach((events, index) => {
      if (index === 0 && !events.some((t) => isChannelEvent(t.event))) {
        conductor.push(...events);
        return;
      }
      if (index === 0) {
        conductor.push(...events.filter((t) => CONDUCTOR_TYPES.has(t.event.type)));
        events = events.filter((t) => !CONDUCTOR_TYPES.has(t.event.type));
      }
      // A track that uses several channels becomes one track per channel.
      const channels = [...new Set(events.filter((t) => isChannelEvent(t.event)).map((t) => (t.event as { channel: number }).channel))];
      if (channels.length <= 1) {
        noteSources.push({ events });
      } else {
        channels.forEach((ch, i) => {
          noteSources.push({
            events: events.filter((t) => (isChannelEvent(t.event) ? t.event.channel === ch : i === 0)),
          });
        });
      }
    });
  }

  // Conductor: title, tempo, meter and key at tick 0; everything else is kept.
  const markers: { tick: number; name: string; raw: Timed }[] = [];
  const taken = new Set<Timed>();
  const takeFirst = (type: string): Timed | undefined => {
    const found = conductor.find((t) => t.tick === 0 && t.event.type === type && !taken.has(t));
    if (found) taken.add(found);
    return found;
  };
  const title = takeFirst("trackName");
  if (title && "text" in title.event && options.title === undefined) song.title = title.event.text;
  const tempo = takeFirst("setTempo");
  if (tempo && tempo.event.type === "setTempo") song.tempo = tempo.event.microsecondsPerBeat;
  const meter = takeFirst("timeSignature");
  if (meter && meter.event.type === "timeSignature") {
    const { numerator, denominator } = meter.event;
    if (numerator >= 1 && [1, 2, 4, 8, 16, 32].includes(denominator)) song.meter = { numerator, denominator };
    else taken.delete(meter);
  }
  const key = takeFirst("keySignature");
  if (key && key.event.type === "keySignature") {
    if (Math.abs(key.event.key) <= 7 && (key.event.scale === 0 || key.event.scale === 1)) {
      song.key = { fifths: key.event.key, mode: key.event.scale === 1 ? "minor" : "major" };
    } else {
      taken.delete(key);
    }
  }
  if (conductor.some((t) => t.tick > 0 && (t.event.type === "setTempo" || t.event.type === "timeSignature"))) {
    warnings.push("The file changes tempo or meter: the changes are kept for export, but the MVP works with the first ones.");
  }
  const bar = barTicks(song.meter);
  for (const t of conductor) {
    if (taken.has(t) || t.event.type === "endOfTrack") continue;
    const tick = toTicks(t.tick);
    if (t.event.type === "marker" && tick % bar === 0) {
      const name = t.event.text.trim();
      const last = markers.at(-1);
      if (name.length > 0 && (!last || last.tick !== tick)) {
        markers.push({ tick, name: t.event.text, raw: t });
        continue;
      }
    }
    song.conductorEvents.push({ tick, event: toRaw(t.event) });
  }

  // Note tracks.
  const offStyles: boolean[] = [];
  const releaseVelocities: number[] = [];
  const pendingRelease = new Map<Note, number>();
  let zeroLength = 0;
  noteSources.forEach((source, index) => {
    const events = [...source.events].sort((a, b) => a.tick - b.tick || a.seq - b.seq);
    const channelEvents = events.filter((t) => isChannelEvent(t.event));
    const channel = channelEvents.length > 0 ? (channelEvents[0]!.event as { channel: number }).channel : 0;
    const id = `t${song.counters.t++}`;
    const track: Track = {
      id,
      name: "",
      program: null,
      channel,
      volume: 0.8,
      pan: 0,
      mute: false,
      solo: false,
      color: index,
      pedal: [],
      extraEvents: [],
    };
    const used = new Set<Timed>();
    const name = events.find((t) => t.tick === 0 && t.event.type === "trackName");
    if (name && "text" in name.event) {
      track.name = name.event.text;
      used.add(name);
    }
    if (!track.name.trim()) track.name = channel === 9 ? "Percusión" : `Pista ${index + 1}`;
    const program = channelEvents.find((t) => t.event.type === "programChange");
    if (program && program.tick === 0 && program.event.type === "programChange") {
      track.program = program.event.programNumber;
      used.add(program);
    }

    // Sustain pedal: only when it is a clean on/off sequence (127/0), so it comes back unchanged.
    const sustain = channelEvents.filter((t) => t.event.type === "controller" && t.event.controllerType === SUSTAIN);
    let pedalOk = sustain.length > 0 && sustain.length % 2 === 0;
    const spans: { start: number; end: number }[] = [];
    for (let i = 0; pedalOk && i < sustain.length; i += 2) {
      const down = sustain[i]!.event as { value: number };
      const up = sustain[i + 1]!.event as { value: number };
      const start = toTicks(sustain[i]!.tick);
      const end = toTicks(sustain[i + 1]!.tick);
      if (down.value !== 127 || up.value !== 0 || end <= start || (spans.at(-1)?.end ?? -1) > start) pedalOk = false;
      else spans.push({ start, end });
    }
    if (pedalOk) {
      track.pedal = spans;
      for (const t of sustain) used.add(t);
    }

    // Expression (CC11) and modulation (CC1) curves (H4): each event is a point. Left as they are
    // when two share a tick, since the model keeps one point per tick.
    for (const kind of CURVE_KINDS) {
      const cc = channelEvents.filter((t) => t.event.type === "controller" && t.event.controllerType === CURVE_CC[kind] && (t.event as { channel: number }).channel === channel);
      if (!cc.length) continue;
      const points = cc.map((t) => ({ tick: toTicks(t.tick), value: (t.event as { value: number }).value }));
      if (new Set(points.map((p) => p.tick)).size !== points.length) continue;
      track.curves = { ...(track.curves ?? {}), [kind]: points };
      for (const t of cc) used.add(t);
    }

    // Notes: note-ons pair with the oldest open note-off of the same pitch.
    const open = new Map<number, { start: number; velocity: number; seq: number }[]>();
    const notes: { note: Omit<Note, "id">; onSeq: number }[] = [];
    const lastTick = events.at(-1)?.tick ?? 0;
    const close = (pitch: number, endTick: number, release: number | undefined, byte9: boolean | undefined) => {
      const queue = open.get(pitch);
      const started = queue?.shift();
      if (!started) return false;
      const start = toTicks(started.start);
      const end = toTicks(endTick);
      if (end <= start) {
        zeroLength++;
        return true;
      }
      const note: Omit<Note, "id"> = { trackId: id, pitch, start, duration: end - start, velocity: started.velocity, createdBy: USER, shapedBy: USER };
      notes.push({ note, onSeq: started.seq });
      if (release !== undefined) {
        releaseVelocities.push(release);
        pendingRelease.set(note as Note, release);
      }
      if (byte9 !== undefined) offStyles.push(byte9);
      return true;
    };
    for (const t of events) {
      const e = t.event;
      if (e.type === "noteOn" && e.velocity > 0) {
        const queue = open.get(e.noteNumber) ?? [];
        queue.push({ start: t.tick, velocity: e.velocity, seq: t.seq });
        open.set(e.noteNumber, queue);
        used.add(t);
      } else if (e.type === "noteOff" || e.type === "noteOn") {
        if (close(e.noteNumber, t.tick, e.velocity, e.type === "noteOff" ? e.byte9 === true : true)) used.add(t);
      }
    }
    for (const [pitch, queue] of open) while (queue.length > 0) close(pitch, lastTick, undefined, undefined);

    // Ids follow the order of the note-ons in the file.
    notes.sort((a, b) => a.note.start - b.note.start || a.onSeq - b.onSeq);
    for (const { note } of notes) {
      const nid = `n${song.counters.n++}`;
      const full = note as Note;
      full.id = nid;
      song.notes[nid] = full;
    }

    for (const t of events) {
      if (used.has(t) || t.event.type === "endOfTrack") continue;
      track.extraEvents.push({ tick: toTicks(t.tick), event: toRaw(t.event) });
    }
    song.tracks[id] = track;
    song.trackOrder.push(id);
  });

  // Note-off style and release velocity: the most common become the song's defaults.
  song.midiFile.noteOffAsNoteOn = offStyles.filter(Boolean).length > offStyles.length / 2;
  const release = song.midiFile.noteOffAsNoteOn ? 0 : mostCommon(releaseVelocities, 64);
  song.midiFile.releaseVelocity = release;
  for (const [note, v] of pendingRelease) if (v !== release && !song.midiFile.noteOffAsNoteOn) note.releaseVelocity = v;

  // Sections from the markers on bar lines.
  const lastBar = Math.max(1, barAt(song.meter, Math.max(0, songEnd(song) - 1)));
  markers.forEach((m, i) => {
    const startBar = m.tick / bar + 1;
    const next = markers[i + 1];
    const endBar = next ? next.tick / bar : Math.max(startBar, lastBar);
    const sid = `s${song.counters.s++}`;
    song.sections[sid] = { id: sid, name: m.name, startBar, endBar } satisfies Section;
  });

  if (rounded) warnings.push(`Some times were rounded: the file uses ${tpb} ticks per quarter note.`);
  if (zeroLength > 0) warnings.push(`${zeroLength} zero-length notes were skipped.`);
  return { song, warnings };
}

// ---------------------------------------------------------------------------
// Export

interface OutEvent {
  tick: number;
  rank: number;
  order: number;
  event: RawEvent;
}

/**
 * Order of events that share a tick:
 * conductor — name, meter, key, section markers, tempo, other events;
 * tracks — name, meta events, note-offs, bank select, program, other channel events, note-ons.
 */
const RANK = {
  name: 0,
  meta: 1,
  noteOff: 2,
  bank: 3,
  program: 4,
  channel: 5,
  noteOn: 6,
  meter: 1,
  key: 2,
  marker: 3,
  tempo: 4,
  conductorOther: 5,
} as const;

function chooseResolution(song: Song): number {
  const wanted = song.midiFile.ticksPerBeat;
  if (!(wanted > 0) || PPQ % wanted !== 0) return PPQ;
  const step = PPQ / wanted;
  const fits = (t: number) => t % step === 0;
  for (const n of Object.values(song.notes)) if (!fits(n.start) || !fits(n.duration)) return PPQ;
  for (const t of Object.values(song.tracks)) {
    if (!t.pedal.every((p) => fits(p.start) && fits(p.end))) return PPQ;
    for (const kind of CURVE_KINDS) if (!(t.curves?.[kind] ?? []).every((p) => fits(p.tick))) return PPQ;
    if (!t.extraEvents.every((e) => fits(e.tick))) return PPQ;
  }
  if (!song.conductorEvents.every((e) => fits(e.tick))) return PPQ;
  return wanted;
}

function finish(events: OutEvent[], step: number): MidiEvent[] {
  events.sort((a, b) => a.tick - b.tick || a.rank - b.rank || a.order - b.order);
  let previous = 0;
  const out: MidiEvent[] = events.map(({ tick, event }) => {
    const t = tick / step;
    const deltaTime = t - previous;
    previous = t;
    return { ...event, deltaTime } as unknown as MidiEvent;
  });
  out.push({ deltaTime: 0, meta: true, type: "endOfTrack" });
  return out;
}

export function exportMidi(song: Song): Uint8Array {
  const settings = song.midiFile;
  const tpb = chooseResolution(song);
  const step = PPQ / tpb;
  const tracks: MidiEvent[][] = [];

  // Conductor.
  const conductor: OutEvent[] = [
    { tick: 0, rank: RANK.name, order: 0, event: { meta: true, type: "trackName", text: song.title } },
    {
      tick: 0,
      rank: RANK.meter,
      order: 0,
      event: { meta: true, type: "timeSignature", numerator: song.meter.numerator, denominator: song.meter.denominator, metronome: 24, thirtyseconds: 8 },
    },
    { tick: 0, rank: RANK.key, order: 0, event: { meta: true, type: "keySignature", key: song.key.fifths, scale: song.key.mode === "minor" ? 1 : 0 } },
    { tick: 0, rank: RANK.tempo, order: 0, event: { meta: true, type: "setTempo", microsecondsPerBeat: song.tempo } },
  ];
  orderedSections(song).forEach((s, i) =>
    conductor.push({ tick: barStart(song.meter, s.startBar), rank: RANK.marker, order: i, event: { meta: true, type: "marker", text: s.name } }),
  );
  song.conductorEvents.forEach((e, i) => conductor.push({ tick: e.tick, rank: RANK.conductorOther, order: i, event: e.event }));
  tracks.push(finish(conductor, step));

  // Note tracks.
  for (const track of orderedTracks(song)) {
    const ch = track.channel;
    const events: OutEvent[] = [{ tick: 0, rank: RANK.name, order: 0, event: { meta: true, type: "trackName", text: track.name } }];
    if (track.program !== null) {
      events.push({ tick: 0, rank: RANK.program, order: 0, event: { type: "programChange", channel: ch, programNumber: track.program } });
    }
    notesOf(song, track.id).forEach((n, i) => {
      events.push({ tick: n.start, rank: RANK.noteOn, order: i, event: { type: "noteOn", channel: ch, noteNumber: n.pitch, velocity: n.velocity } });
      const off: RawEvent = settings.noteOffAsNoteOn
        ? { type: "noteOff", channel: ch, noteNumber: n.pitch, velocity: 0, byte9: true }
        : { type: "noteOff", channel: ch, noteNumber: n.pitch, velocity: n.releaseVelocity ?? settings.releaseVelocity };
      events.push({ tick: n.start + n.duration, rank: RANK.noteOff, order: i, event: off });
    });
    // Pedal: at a shared tick, lift before pressing again.
    track.pedal.forEach((p) => {
      events.push({ tick: p.start, rank: RANK.channel, order: Number.MAX_SAFE_INTEGER, event: { type: "controller", channel: ch, controllerType: SUSTAIN, value: 127 } });
      events.push({ tick: p.end, rank: RANK.channel, order: -1, event: { type: "controller", channel: ch, controllerType: SUSTAIN, value: 0 } });
    });
    // Curves: after a pedal lift and before the other controllers at the same tick.
    CURVE_KINDS.forEach((kind, k) =>
      (track.curves?.[kind] ?? []).forEach((p) =>
        events.push({ tick: p.tick, rank: RANK.channel, order: -0.5 + k * 0.1, event: { type: "controller", channel: ch, controllerType: CURVE_CC[kind], value: p.value } }),
      ),
    );
    track.extraEvents.forEach((e, i) => {
      const ev = e.event;
      const rank =
        ev.meta === true
          ? RANK.meta
          : ev.type === "controller" && BANK_SELECT.has(ev.controllerType as number)
            ? RANK.bank
            : RANK.channel;
      events.push({ tick: e.tick, rank, order: i, event: ev });
    });
    tracks.push(finish(events, step));
  }

  const data: MidiData = { header: { format: 1, numTracks: tracks.length, ticksPerBeat: tpb }, tracks };
  // Note-off style travels on each event (byte9), so useByte9ForNoteOff is left unset.
  return Uint8Array.from(writeMidi(data, { running: settings.runningStatus }));
}
