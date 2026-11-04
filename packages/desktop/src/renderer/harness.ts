/**
 * Songs for the browser harness (no Electron): the window runs against `memoryBridge`.
 * - `?song=boceto`: the data of the approved sketch (bocetos/lienzo/dil.json), to compare the
 *   window with capture 01 under the same conditions.
 * - otherwise: Dilatacion.mid imported, as the app opens it the first time.
 */
import { PPQ, type Song, USER, ai, emptySong, importMidi, starterSong, withDefaultBuses } from "@fourhands/core";
import type { AiState } from "../shared/protocol.js";

interface Sketch {
  title: string;
  tempo: number;
  sections: [string, number, number][];
  chords: string[];
  tracks: { name: string; inst: string; notes: [number, number, number, number, "u" | "a"][] }[];
}

const PROGRAMS: Record<string, number | null> = { Órgano: 19, Piano: 0, Cuerdas: 48, Chelo: 42, Contrabajo: 43, Timbales: null };

export function songFromSketch(d: Sketch): Song {
  const song = emptySong(d.title);
  song.tempo = Math.round(60_000_000 / d.tempo);
  song.key = { fifths: 0, mode: "minor" };
  const claude = ai("claude-ai");
  d.tracks.forEach((tr, i) => {
    const id = `t${song.counters.t++}`;
    const program = PROGRAMS[tr.inst] ?? null;
    song.tracks[id] = {
      id,
      name: tr.name,
      program,
      channel: program === null ? 9 : i,
      volume: 0.8,
      pan: 0,
      mute: false,
      solo: false,
      color: i,
      pedal: [],
      extraEvents: [],
    };
    song.trackOrder.push(id);
    for (const [start, dur, pitch, vel, who] of tr.notes) {
      const nid = `n${song.counters.n++}`;
      const author = who === "a" ? claude : USER;
      song.notes[nid] = {
        id: nid,
        trackId: id,
        pitch,
        start: Math.round(start * PPQ),
        duration: Math.max(1, Math.round(dur * PPQ)),
        velocity: vel,
        createdBy: author,
        shapedBy: author,
      };
    }
  });
  for (const [name, startBar, endBar] of d.sections) {
    const id = `s${song.counters.s++}`;
    song.sections[id] = { id, name, startBar, endBar };
  }
  d.chords.forEach((c, i) => (song.harmony[String(i * 4 * PPQ)] = c));
  const a = `a${song.counters.a++}`;
  song.annotations[a] = { id: a, start: 24 * 4 * PPQ, end: 26 * 4 * PPQ, trackIds: [], text: "que respire", author: USER };
  const melody = song.trackOrder[2]!;
  song.context = {
    activeTrackId: melody,
    selection: [],
    loop: { start: 20 * 4 * PPQ, end: 28 * 4 * PPQ },
    cursor: 22 * 4 * PPQ,
    visible: null,
  };
  // Like every song the app makes (F2.2 parte D): the «Reverb» bus.
  return withDefaultBuses(song);
}

export async function harnessSong(params: URLSearchParams): Promise<Song> {
  if (params.get("song") === "boceto") {
    const d = (await (await fetch("boceto-dilatacion.json")).json()) as Sketch;
    return songFromSketch(d);
  }
  if (params.get("song") === "empty") return starterSong(params.get("lang") === "en" ? "Untitled" : "Sin título");
  const bytes = new Uint8Array(await (await fetch("Dilatacion.mid")).arrayBuffer());
  return importMidi(bytes).song;
}

/**
 * `?ai=…`: the AI's side for the harness, to compare with capture 07 without a real AI.
 * conectada · leyendo · escribiendo (with a mark) · fuera (writing out of view: the edge tab).
 */
export function harnessAi(name: string | null, song: Song): AiState | null {
  if (!name) return null;
  const claude = { client: "claude-ai", name: "Claude" };
  const bar = (n: number) => (n - 1) * 4 * PPQ;
  const cello = song.trackOrder.find((id) => /chelo|cello/i.test(song.tracks[id]!.name)) ?? song.trackOrder[0] ?? "t1";
  const writing = (from: number, to: number) => ({ id: "i3", name: "Claude", description: "Reharmonizo el coro", notes: 14, trackIds: [cello], start: bar(from), end: bar(to + 1) });
  switch (name) {
    case "conectada":
      return { clients: [claude], reading: null, writing: [], mark: null };
    case "leyendo":
      return { clients: [claude], reading: "Claude", writing: [], mark: null };
    case "escribiendo":
      return {
        clients: [claude],
        reading: null,
        writing: [writing(17, 20)],
        mark: { id: "m1", name: "Claude", start: bar(23), end: bar(24), trackIds: [cello], noteIds: [], reason: "aquí el chelo cruza a la viola", at: 0 },
      };
    case "fuera":
      return { clients: [claude], reading: null, writing: [writing(45, 48)], mark: null };
    default:
      return null;
  }
}
