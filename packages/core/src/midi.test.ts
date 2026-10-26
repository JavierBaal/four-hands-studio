import midiFile from "midi-file";
import type { MidiEvent } from "midi-file";
import { describe, expect, it } from "vitest";
import { addNotes, moveNotes, updateNotes } from "./commands.js";
import { SongDocument } from "./document.js";
import { MidiFileError, exportMidi, importMidi } from "./midi.js";
import { USER, barStart, notesOf, orderedSections, orderedTracks } from "./model.js";
import { DILATACION } from "./test-support/dilatacion.js";
import { PPQ } from "./time.js";

const { parseMidi, writeMidi } = midiFile;


/** Events of each track with absolute ticks, without file-only details, sorted. */
function eventsByTrack(bytes: ArrayLike<number>) {
  const data = parseMidi(bytes);
  return data.tracks.map((track) => {
    let tick = 0;
    return track
      .map((e) => {
        tick += e.deltaTime;
        const { deltaTime: _d, running: _r, ...rest } = e as MidiEvent & { running?: boolean };
        return `${tick} ${JSON.stringify(rest)}`;
      })
      .sort();
  });
}

function build(tracks: MidiEvent[][], ticksPerBeat = 480, format: 0 | 1 = 1): Uint8Array {
  return Uint8Array.from(writeMidi({ header: { format, numTracks: tracks.length, ticksPerBeat }, tracks }));
}

const name = (text: string, deltaTime = 0): MidiEvent => ({ deltaTime, meta: true, type: "trackName", text });
/** Conductor track in the canonical order: name, meter, key, then whatever follows, then tempo. */
const conductor = (title: string, ...rest: MidiEvent[]): MidiEvent[] => [
  name(title),
  { deltaTime: 0, meta: true, type: "timeSignature", numerator: 4, denominator: 4, metronome: 24, thirtyseconds: 8 },
  { deltaTime: 0, meta: true, type: "keySignature", key: 0, scale: 0 },
  ...rest,
];
const tempo = (deltaTime = 0, microsecondsPerBeat = 500000): MidiEvent => ({ deltaTime, meta: true, type: "setTempo", microsecondsPerBeat });
const end = (deltaTime = 0): MidiEvent => ({ deltaTime, meta: true, type: "endOfTrack" });
const on = (deltaTime: number, noteNumber: number, velocity = 80, channel = 0): MidiEvent => ({ deltaTime, type: "noteOn", channel, noteNumber, velocity });
const off = (deltaTime: number, noteNumber: number, velocity = 64, channel = 0): MidiEvent => ({ deltaTime, type: "noteOff", channel, noteNumber, velocity });
const cc = (deltaTime: number, controllerType: number, value: number, channel = 0): MidiEvent => ({ deltaTime, type: "controller", channel, controllerType, value });

describe("Dilatacion.mid (H1 closing test)", () => {
  it("goes in and comes out byte for byte", () => {
    const { song } = importMidi(DILATACION);
    expect(Buffer.from(exportMidi(song)).equals(Buffer.from(DILATACION))).toBe(true);
  });

  it("is understood as a song", () => {
    const { song, warnings } = importMidi(DILATACION);
    expect(song.title).toBe("Dilatacion");
    expect(Math.round(60_000_000 / song.tempo)).toBe(72);
    expect(song.meter).toEqual({ numerator: 4, denominator: 4 });
    expect(song.key).toEqual({ fifths: 0, mode: "minor" });
    expect(orderedTracks(song).map((t) => t.name)).toEqual([
      "Organo",
      "Piano ostinato",
      "Melodia (cuerdas)",
      "Contramelodia (cello)",
      "Bajo (contrabajo)",
      "Bateria",
    ]);
    expect(orderedTracks(song).at(-1)).toMatchObject({ channel: 9, program: null });
    expect(orderedSections(song).map((s) => `${s.name} ${s.startBar}-${s.endBar}`)).toEqual([
      "Intro 1-8",
      "Verso 9-16",
      "Precoro 17-20",
      "Verso 2 21-28",
      "Puente 29-36",
      "Coro 37-44",
      "Outro 45-52",
    ]);
    expect(Object.keys(song.notes)).toHaveLength(1024);
    expect(song.notes.n1).toMatchObject({ pitch: 45, start: 0, duration: 4 * PPQ, velocity: 40, createdBy: USER, shapedBy: USER });
    // The final ritardando (H4): into the tempo map, so it plays; nothing left to warn about.
    expect(song.tempoChanges).toEqual([
      { tick: barStart(song.meter, 51), tempo: 909_091 },
      { tick: barStart(song.meter, 52), tempo: 1_034_483 },
    ]);
    expect(song.conductorEvents).toEqual([]);
    expect(warnings).toHaveLength(0);
  });

  it("keeps the edits when exported", () => {
    const { song } = importMidi(DILATACION);
    const doc = new SongDocument(song);
    doc.transact({ actor: USER, label: "Editar" }, (tx) => {
      updateNotes(tx, [{ id: "n1", pitch: 44, velocity: 50 }]);
      moveNotes(tx, ["n2"], { ticks: 37 }); // off the file's grid: exported at 960
      addNotes(tx, song.trackOrder[0]!, [{ pitch: 81, start: 0, duration: PPQ, velocity: 90 }]);
    });
    const out = exportMidi(doc.song);
    expect(parseMidi(out).header.ticksPerBeat).toBe(960);
    const again = importMidi(out).song;
    const key = (n: { trackId: string; start: number; pitch: number }) => `${n.trackId} ${n.start} ${n.pitch}`;
    const strip = (notes: ReturnType<typeof notesOf>) =>
      notes.map(({ id: _i, ...n }) => n).sort((a, b) => key(a).localeCompare(key(b)));
    expect(strip(notesOf(again))).toEqual(strip(notesOf(doc.song)));
  });
});

describe("importMidi", () => {
  it("keeps every event of a file written in another order", () => {
    const bytes = build([
      conductor("Tema", tempo(0, 600000), { deltaTime: 0, meta: true, type: "copyrightNotice", text: "©" }, end()),
      [
        name("Piano"),
        cc(0, 7, 100),
        { deltaTime: 0, type: "programChange", channel: 0, programNumber: 0 },
        cc(0, 10, 40),
        on(0, 64),
        on(0, 60),
        { deltaTime: 100, type: "pitchBend", channel: 0, value: 9000 },
        off(380, 60),
        off(0, 64),
        { deltaTime: 0, meta: true, type: "text", text: "fin" },
        end(),
      ],
    ]);
    const out = exportMidi(importMidi(bytes).song);
    expect(eventsByTrack(out)).toEqual(eventsByTrack(bytes));
  });

  it("splits a format 0 file into one track per channel", () => {
    const bytes = build(
      [
        [
          name("Uno"),
          { deltaTime: 0, type: "programChange", channel: 0, programNumber: 40 },
          { deltaTime: 0, type: "programChange", channel: 1, programNumber: 42 },
          on(0, 72, 80, 0),
          on(0, 48, 70, 1),
          off(480, 72, 64, 0),
          off(0, 48, 64, 1),
          end(),
        ],
      ],
      480,
      0,
    );
    const { song } = importMidi(bytes);
    expect(song.title).toBe("Uno");
    expect(orderedTracks(song).map((t) => [t.channel, t.program])).toEqual([
      [0, 40],
      [1, 42],
    ]);
    expect(notesOf(song).map((n) => [song.tracks[n.trackId]!.channel, n.pitch])).toEqual([
      [0, 72],
      [1, 48],
    ]);
  });

  it("turns a clean sustain pedal into spans and gives it back", () => {
    const bytes = build([
      conductor("Pedal", tempo(), end()),
      [name("Piano"), cc(0, 64, 127), on(0, 60), off(480, 60), cc(0, 64, 0), cc(0, 64, 127), on(0, 62), off(480, 62), cc(0, 64, 0), end()],
    ]);
    const { song } = importMidi(bytes);
    expect(orderedTracks(song)[0]!.pedal).toEqual([
      { start: 0, end: PPQ },
      { start: PPQ, end: 2 * PPQ },
    ]);
    expect(eventsByTrack(exportMidi(song))).toEqual(eventsByTrack(bytes));
  });

  it("turns CC11 and CC1 into expression and modulation curves and gives them back (H4)", () => {
    const bytes = build([
      conductor("Curvas", tempo(), end()),
      [name("Chelos"), cc(0, 11, 40), cc(0, 1, 10), on(0, 48), cc(240, 11, 70), cc(240, 11, 100), cc(0, 7, 90), off(0, 48), end()],
    ]);
    const { song } = importMidi(bytes);
    const track = orderedTracks(song)[0]!;
    expect(track.curves?.expression).toEqual([
      { tick: 0, value: 40 },
      { tick: PPQ / 2, value: 70 },
      { tick: PPQ, value: 100 },
    ]);
    expect(track.curves?.modulation).toEqual([{ tick: 0, value: 10 }]);
    expect(track.extraEvents.map((e) => e.event.controllerType)).toEqual([7]); // other controllers stay raw
    expect(eventsByTrack(exportMidi(song))).toEqual(eventsByTrack(bytes));
  });

  it("leaves CC11 raw when two events share a tick, so nothing is lost", () => {
    const bytes = build([conductor("x", tempo(), end()), [name("Viola"), cc(0, 11, 40), cc(0, 11, 60), on(0, 60), off(480, 60), end()]]);
    const { song } = importMidi(bytes);
    expect(orderedTracks(song)[0]!.curves).toBeUndefined();
    expect(eventsByTrack(exportMidi(song))).toEqual(eventsByTrack(bytes));
  });

  it("keeps a half-pedal as raw controller events", () => {
    const bytes = build([conductor("x", tempo(), end()), [name("Piano"), cc(0, 64, 90), on(0, 60), off(480, 60), cc(0, 64, 0), end()]]);
    const { song } = importMidi(bytes);
    expect(orderedTracks(song)[0]!.pedal).toEqual([]);
    expect(eventsByTrack(exportMidi(song))).toEqual(eventsByTrack(bytes));
  });

  it("keeps note-offs written as note-on with velocity 0", () => {
    const bytes = build([conductor("x", tempo(), end()), [name("P"), on(0, 60), { deltaTime: 480, type: "noteOff", channel: 0, noteNumber: 60, velocity: 0, byte9: true }, end()]]);
    const { song } = importMidi(bytes);
    expect(song.midiFile.noteOffAsNoteOn).toBe(true);
    expect(Buffer.from(exportMidi(song)).equals(Buffer.from(bytes))).toBe(true);
  });

  it("keeps an unusual release velocity on its note", () => {
    const bytes = build([conductor("x", tempo(), end()), [name("P"), on(0, 60), off(480, 60, 64), on(0, 62), off(480, 62, 20), on(0, 64), off(480, 64, 64), end()]]);
    const { song } = importMidi(bytes);
    expect(song.midiFile.releaseVelocity).toBe(64);
    expect(notesOf(song).map((n) => n.releaseVelocity)).toEqual([undefined, 20, undefined]);
    expect(Buffer.from(exportMidi(song)).equals(Buffer.from(bytes))).toBe(true);
  });

  it("pairs overlapping notes of the same pitch first in, first out", () => {
    const bytes = build([conductor("x", tempo(), end()), [name("P"), on(0, 60, 90), on(240, 60, 50), off(240, 60), off(240, 60), end()]]);
    const notes = notesOf(importMidi(bytes).song);
    expect(notes.map((n) => [n.start, n.duration, n.velocity])).toEqual([
      [0, 960, 90],
      [480, 960, 50],
    ]);
  });

  it("closes notes left open and skips zero-length ones, with warnings", () => {
    const bytes = build([conductor("x", tempo(), end()), [name("P"), on(0, 60), off(0, 60), on(0, 62), on(480, 64), off(480, 64), end()]]);
    const { song, warnings } = importMidi(bytes);
    expect(notesOf(song).map((n) => [n.pitch, n.start, n.duration])).toEqual([
      [62, 0, 2 * PPQ],
      [64, PPQ, PPQ],
    ]);
    expect(warnings.join(" ")).toMatch(/zero-length/);
  });

  it("converts other resolutions to 960 and writes them back at their own", () => {
    const bytes = build([conductor("x", tempo(), end()), [name("P"), on(0, 60), off(96, 60), on(0, 62), off(48, 62), end()]], 96);
    const { song } = importMidi(bytes);
    expect(notesOf(song).map((n) => [n.start, n.duration])).toEqual([
      [0, PPQ],
      [PPQ, PPQ / 2],
    ]);
    expect(Buffer.from(exportMidi(song)).equals(Buffer.from(bytes))).toBe(true);
  });

  it("warns when a resolution does not fit exactly", () => {
    const bytes = build([conductor("x", tempo(), end()), [name("P"), on(0, 60), off(1, 60), end()]], 7);
    expect(importMidi(bytes).warnings.join(" ")).toMatch(/rounded/);
  });

  it("only takes markers on bar lines as sections", () => {
    const bytes = build([
      conductor(
        "x",
        { deltaTime: 0, meta: true, type: "marker", text: "A" },
        tempo(),
        { deltaTime: 1000, meta: true, type: "marker", text: "fuera de compás" },
        { deltaTime: 2840, meta: true, type: "marker", text: "B" },
        end(),
      ),
      [name("P"), on(0, 60), off(4 * 1920, 60), end()],
    ]);
    const { song } = importMidi(bytes);
    expect(orderedSections(song).map((s) => [s.name, s.startBar, s.endBar])).toEqual([
      ["A", 1, 2],
      ["B", 3, 4],
    ]);
    expect(song.conductorEvents.map((e) => e.event.text)).toEqual(["fuera de compás"]);
    expect(eventsByTrack(exportMidi(song))).toEqual(eventsByTrack(bytes));
  });

  it("adds tempo, meter and key when the file has none", () => {
    const bytes = build([[name("x"), end()], [name("P"), on(0, 60), off(480, 60), end()]]);
    const out = eventsByTrack(exportMidi(importMidi(bytes).song));
    expect(out[0]!.map((e) => JSON.parse(e.slice(2)).type).sort()).toEqual(["endOfTrack", "keySignature", "setTempo", "timeSignature", "trackName"]);
    expect(out[1]).toEqual(eventsByTrack(bytes)[1]);
  });

  it("rejects what is not a MIDI file", () => {
    expect(() => importMidi(new Uint8Array([1, 2, 3, 4]))).toThrow(MidiFileError);
    const smpte = build([[end()]]);
    smpte[12] = 0xe7; // -25 frames per second
    smpte[13] = 40;
    expect(() => importMidi(smpte)).toThrow(/SMPTE/);
  });
});
