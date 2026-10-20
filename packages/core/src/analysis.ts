/**
 * `analyze`: the AI's substitute for ears (ESQUEMA_MCP.md, 4; PRD_MVP.md, 4.6;
 * ESTUDIO_SKILLS_COMPOSICION.md, 5).
 *
 * Mechanical findings with their place and notes. It describes what is in the score and never
 * judges or composes: what to do with a finding is the AI's (and the user's) call.
 *
 * Checks, in the order they are reported:
 * 1. Low register: close intervals below their low-interval limit, and too many notes below C3.
 * 2. Crowded register: four or more tracks living in the same octave in a bar.
 * 3. Identical repeats: a bar or block played the same way three or more times in a row.
 * 4. Formula dynamics: long straight velocity ramps and long runs of one velocity.
 * 5. Abrupt changes: several tracks stopping at the same bar line, or a sharp drop in loudness.
 * 6. Outside the instrument's range (the caller says what each track's range is).
 * 7. Outside the key, by pitch class.
 * 8. Long notes on the beat outside the written chord.
 * And first of all: leftovers of earlier versions, and the song concept's limits (a duration or a
 * tempo written in the concept, against the music), when the whole song is analysed.
 *
 * Muted tracks are left out of what is heard (1, 2, 5). Percussion (channel 10) is left out of
 * pitch checks (1, 2, 6, 7, 8).
 */
import { type Note, type Song, barAt, barStart, barTicks, beatTicks, notesOf } from "./model.js";
import { barHarmony, pitchName } from "./compact.js";
import { PPQ } from "./time.js";
import { tonicOf, keyText } from "./notation.js";

export interface AnalyzeOptions {
  /** First and last tick (end exclusive) to look at. */
  start: number;
  end: number;
  /** Tracks to look at; all when omitted. Context (what is heard around them) still counts every track. */
  trackIds?: readonly string[];
  /** Usual range [low, high] of a track's instrument, when the app knows it. */
  rangeOf?: (trackId: string) => readonly [number, number] | undefined;
  /** Label of the range for the heading ("c. 17–24", "whole song (c. 1–44)"). */
  label?: string;
}

export interface Finding {
  check: Check;
  /** One compact line, without the leading indent. */
  text: string;
}

export type Check = "concept" | "leftovers" | "low" | "crowded" | "repeats" | "loops" | "dynamics" | "abrupt" | "range" | "key" | "harmony";

const HEADINGS: Record<Check, string> = {
  concept: "Against the limits in the song concept",
  leftovers: "Left over from earlier versions (the song reads longer or fuller than the music)",
  low: "Low register (intervals too close for their height blur into a buzz)",
  crowded: "Crowded register (parts in the same octave mask each other)",
  repeats: "Identical repeats (the same bars, note for note)",
  loops: "Harmonic loops (the same chords over and over)",
  dynamics: "Formula dynamics",
  abrupt: "Abrupt changes at a bar line",
  range: "Outside the instrument's usual range (or the keys a bank's sound has samples for)",
  key: "Outside the key",
  harmony: "Long notes on the beat outside the written chord",
};

const CHECKS: readonly Check[] = ["concept", "leftovers", "low", "crowded", "repeats", "loops", "dynamics", "abrupt", "range", "key", "harmony"];

/**
 * Lowest comfortable bottom note (MIDI) for each interval in semitones, 1 to 11.
 * The orchestration rule of thumb (skill `orchestration-register`): m2 E3, M2 Eb3, m3 C3, M3 Bb2,
 * P4 Bb2, tritone B2, P5 Bb1, sixths and sevenths F2.
 */
export const LOW_INTERVAL_LIMITS: readonly number[] = [0, 52, 51, 48, 46, 46, 47, 34, 41, 41, 41, 41];
const INTERVAL_NAMES = ["unison", "minor 2nd", "major 2nd", "minor 3rd", "major 3rd", "4th", "tritone", "5th", "minor 6th", "major 6th", "minor 7th", "major 7th"];

/** Below C3, more sustained notes than this at once is usually mud. */
const LOW_CROWD_PITCH = 48;
const LOW_CROWD_COUNT = 4;
/** Tracks whose middle pitch falls inside one octave in a bar. */
const CROWD_TRACKS = 4;
const MAX_LINES_PER_CHECK = 8;
/** Overlaps shorter than a 32nd note are legato, not harmony. */
const TAIL = PPQ / 8;
const MAX_IDS = 4;

const isDrums = (song: Song, trackId: string) => song.tracks[trackId]?.channel === 9;

// ---------------------------------------------------------------------------
// Helpers

/** "c. 5", "c. 5–8", "c. 5–8, 12, 20–24". */
function barList(bars: readonly number[]): string {
  const sorted = [...new Set(bars)].sort((a, b) => a - b);
  const parts: string[] = [];
  let from = sorted[0];
  let prev = sorted[0];
  for (const b of [...sorted.slice(1), Infinity]) {
    if (b === prev! + 1) {
      prev = b;
      continue;
    }
    if (from !== undefined) parts.push(from === prev ? `${from}` : `${from}–${prev}`);
    from = b;
    prev = b;
  }
  return parts.length ? `c. ${parts.join(", ")}` : "";
}

function names(song: Song, trackIds: Iterable<string>): string {
  const order = new Map(song.trackOrder.map((t, i) => [t, i]));
  return [...new Set(trackIds)]
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .map((t) => song.tracks[t]?.name ?? t)
    .join(", ");
}

function ids(list: readonly string[]): string {
  const shown = list.slice(0, MAX_IDS).join(" ");
  return list.length > MAX_IDS ? `${shown} (+${list.length - MAX_IDS})` : shown;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
}

interface Ctx {
  song: Song;
  start: number;
  end: number;
  /** Tracks asked about. */
  wanted: Set<string>;
  /** Every note that overlaps the range (all tracks), for what is heard. */
  heard: Note[];
  /** Notes of the wanted tracks starting in the range. */
  own: Note[];
  rangeOf?: AnalyzeOptions["rangeOf"];
}

const audible = (ctx: Ctx, n: Note) => !ctx.song.tracks[n.trackId]?.mute && !isDrums(ctx.song, n.trackId);

// ---------------------------------------------------------------------------
// 1. Low register

function lowRegister(ctx: Ctx): string[] {
  const { song } = ctx;
  const pitched = ctx.heard.filter((n) => audible(ctx, n) && n.pitch < 64);
  const onsets = [...new Set(pitched.filter((n) => n.start >= ctx.start && n.start < ctx.end).map((n) => n.start))].sort((a, b) => a - b);
  // Close intervals, grouped by the two pitches and their tracks.
  const pairs = new Map<string, { low: number; high: number; tracks: Set<string>; bars: number[]; ids: string[] }>();
  const crowd = new Map<string, { bars: number[]; tracks: Set<string>; most: number }>();
  for (const t of onsets) {
    // A note about to end (a legato overlap, a release tail) is not heard against the new one.
    const sounding = pitched.filter((n) => n.start <= t && n.start + n.duration > t + TAIL).sort((a, b) => a.pitch - b.pitch);
    if (!sounding.some((n) => ctx.wanted.has(n.trackId))) continue;
    const bar = barAt(song.meter, t);
    for (let i = 0; i + 1 < sounding.length; i++) {
      const a = sounding[i]!;
      const b = sounding[i + 1]!;
      const interval = b.pitch - a.pitch;
      if (interval < 1 || interval > 11 || a.pitch >= LOW_INTERVAL_LIMITS[interval]!) continue;
      if (!ctx.wanted.has(a.trackId) && !ctx.wanted.has(b.trackId)) continue;
      const tracks = [a.trackId, b.trackId].sort();
      const key = `${a.pitch}:${b.pitch}:${tracks.join(",")}`;
      const entry = pairs.get(key) ?? { low: a.pitch, high: b.pitch, tracks: new Set(tracks), bars: [], ids: [] };
      entry.bars.push(bar);
      for (const id of [a.id, b.id]) if (!entry.ids.includes(id)) entry.ids.push(id);
      pairs.set(key, entry);
    }
    const low = sounding.filter((n) => n.pitch < LOW_CROWD_PITCH);
    if (low.length >= LOW_CROWD_COUNT) {
      const tracks = new Set(low.map((n) => n.trackId));
      const key = [...tracks].sort().join(",");
      const entry = crowd.get(key) ?? { bars: [], tracks, most: 0 };
      entry.bars.push(bar);
      entry.most = Math.max(entry.most, low.length);
      crowd.set(key, entry);
    }
  }
  const lines = [...pairs.values()]
    .sort((x, y) => y.bars.length - x.bars.length || x.low - y.low)
    .map((p) => {
      const interval = p.high - p.low;
      const limit = pitchName(LOW_INTERVAL_LIMITS[interval]!, song.key);
      return `${barList(p.bars)} · ${pitchName(p.low, song.key)}+${pitchName(p.high, song.key)} ${INTERVAL_NAMES[interval]} (comfortable from ${limit} up) · ${names(song, p.tracks)} · ${ids(p.ids)}`;
    });
  for (const c of crowd.values()) {
    lines.push(`${barList(c.bars)} · up to ${c.most} notes at once below ${pitchName(LOW_CROWD_PITCH, song.key)} · ${names(song, c.tracks)}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// 2. Crowded register

function crowded(ctx: Ctx): string[] {
  const { song } = ctx;
  const bt = barTicks(song.meter);
  const fromBar = barAt(song.meter, ctx.start);
  const toBar = barAt(song.meter, ctx.end - 1);
  const groups = new Map<string, { bars: number[]; low: number; high: number }>();
  for (let bar = fromBar; bar <= toBar; bar++) {
    const s = barStart(song.meter, bar);
    const e = s + bt;
    const byTrack = new Map<string, number[]>();
    for (const n of ctx.heard) {
      if (!audible(ctx, n) || n.start >= e || n.start + n.duration <= s) continue;
      const list = byTrack.get(n.trackId) ?? [];
      list.push(n.pitch);
      byTrack.set(n.trackId, list);
    }
    const mids = [...byTrack.entries()].map(([trackId, pitches]) => ({ trackId, mid: median(pitches) })).sort((a, b) => a.mid - b.mid);
    // The largest set of tracks whose middle pitches fit in one octave.
    let best: typeof mids = [];
    for (let i = 0; i < mids.length; i++) {
      const window = mids.filter((m) => m.mid >= mids[i]!.mid && m.mid <= mids[i]!.mid + 12);
      if (window.length > best.length) best = window;
    }
    if (best.length < CROWD_TRACKS || !best.some((m) => ctx.wanted.has(m.trackId))) continue;
    const key = best.map((m) => m.trackId).sort().join(",");
    const entry = groups.get(key) ?? { bars: [], low: 127, high: 0 };
    entry.bars.push(bar);
    entry.low = Math.min(entry.low, best[0]!.mid);
    entry.high = Math.max(entry.high, best.at(-1)!.mid);
    groups.set(key, entry);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].bars.length - a[1].bars.length)
    .map(([key, g]) => `${barList(g.bars)} · ${key.split(",").length} tracks centred between ${pitchName(g.low, song.key)} and ${pitchName(g.high, song.key)} · ${names(song, key.split(","))}`);
}

// ---------------------------------------------------------------------------
// 3. Identical repeats

function repeats(ctx: Ctx): string[] {
  const { song } = ctx;
  const fromBar = barAt(song.meter, ctx.start);
  const toBar = barAt(song.meter, ctx.end - 1);
  const found = new Map<string, { tracks: Set<string>; size: number; from: number; to: number; times: number }>();
  for (const trackId of ctx.wanted) {
    const sig = new Map<number, string>();
    for (const n of ctx.own) {
      if (n.trackId !== trackId) continue;
      const bar = barAt(song.meter, n.start);
      const off = n.start - barStart(song.meter, bar);
      sig.set(bar, `${sig.get(bar) ?? ""}${off}:${n.pitch}:${n.duration}:${n.velocity};`);
    }
    const covered = new Set<number>();
    for (const size of [1, 2, 4, 8]) {
      let bar = fromBar + size;
      while (bar <= toBar) {
        const same = (b: number) => sig.has(b) && sig.get(b) === sig.get(b - size);
        if (!same(bar) || covered.has(bar)) {
          bar++;
          continue;
        }
        let last = bar;
        while (last + 1 <= toBar && same(last + 1)) last++;
        const run = last - bar + 1;
        // The block appears run / size + 1 times; report three or more.
        if (run >= 2 * size) {
          const from = bar - size;
          const times = Math.floor(run / size) + 1;
          const key = `${size}:${from}:${last}`;
          const entry = found.get(key) ?? { tracks: new Set<string>(), size, from, to: last, times };
          entry.tracks.add(trackId);
          found.set(key, entry);
          for (let b = from; b <= last; b++) covered.add(b);
        }
        bar = last + 1;
      }
    }
  }
  return [...found.values()]
    .sort((a, b) => a.from - b.from)
    .map((r) => {
      const block = r.size === 1 ? "one bar" : `a ${r.size}-bar block`;
      return `${barList(range(r.from, r.to))} · ${names(song, r.tracks)}: ${block} played ${r.times} times in a row, identical`;
    });
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let b = from; b <= to; b++) out.push(b);
  return out;
}

// ---------------------------------------------------------------------------
// 4. Formula dynamics

function dynamics(ctx: Ctx): string[] {
  const { song } = ctx;
  const lines: string[] = [];
  for (const trackId of ctx.wanted) {
    // One velocity per onset (the loudest note of a chord).
    const onsets = new Map<number, Note>();
    for (const n of ctx.own) {
      if (n.trackId !== trackId) continue;
      const prev = onsets.get(n.start);
      if (!prev || n.velocity > prev.velocity) onsets.set(n.start, n);
    }
    const seq = [...onsets.values()].sort((a, b) => a.start - b.start);
    let i = 0;
    while (i + 1 < seq.length) {
      const step = seq[i + 1]!.velocity - seq[i]!.velocity;
      let j = i + 1;
      while (j + 1 < seq.length && seq[j + 1]!.velocity - seq[j]!.velocity === step) j++;
      const count = j - i + 1;
      const bars = [barAt(song.meter, seq[i]!.start), barAt(song.meter, seq[j]!.start)];
      const where = barList(range(bars[0]!, bars[1]!));
      const name = song.tracks[trackId]?.name ?? trackId;
      if (step !== 0 && count >= 8) {
        lines.push(`${where} · ${name}: ${count} notes in a straight ramp, ${step > 0 ? "+" : ""}${step} each (v${seq[i]!.velocity} → v${seq[j]!.velocity})`);
      } else if (step === 0 && count >= 16) {
        lines.push(`${where} · ${name}: ${count} notes in a row at the same velocity (v${seq[i]!.velocity})`);
      }
      i = step === 0 || count >= 8 ? j : i + 1;
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// 5. Abrupt changes

function abrupt(ctx: Ctx): string[] {
  const { song } = ctx;
  const fromBar = barAt(song.meter, ctx.start);
  const toBar = barAt(song.meter, ctx.end - 1);
  const lastEnd = ctx.heard.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
  const lastNoteBar = barAt(song.meter, Math.max(0, lastEnd - 1));
  const bt = barTicks(song.meter);
  const info = (bar: number) => {
    const s = barStart(song.meter, bar);
    const tracks = new Set<string>();
    const vels: number[] = [];
    for (const n of ctx.heard) {
      if (song.tracks[n.trackId]?.mute) continue;
      if (n.start < s + bt && n.start + n.duration > s) tracks.add(n.trackId);
      if (n.start >= s && n.start < s + bt) vels.push(n.velocity);
    }
    const avg = vels.length ? vels.reduce((a, b) => a + b, 0) / vels.length : 0;
    return { tracks, avg };
  };
  const lines: string[] = [];
  for (let bar = fromBar; bar < toBar && bar < lastNoteBar; bar++) {
    const a = info(bar);
    const b = info(bar + 1);
    if (b.tracks.size === 0) continue; // a cut to silence is a decision, not a drop
    const stopped = [...a.tracks].filter((t) => !b.tracks.has(t));
    const touches = stopped.some((t) => ctx.wanted.has(t)) || ctx.wanted.size === song.trackOrder.length;
    const parts: string[] = [];
    if (stopped.length >= 3 && touches) parts.push(`${stopped.length} tracks stop at once (${names(song, stopped)})`);
    if (a.avg > 0 && b.avg > 0 && a.avg - b.avg >= 25) parts.push(`average velocity v${Math.round(a.avg)} → v${Math.round(b.avg)}`);
    if (parts.length) lines.push(`c. ${bar}→${bar + 1} · ${parts.join("; ")}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// 6. Instrument range

function instrumentRange(ctx: Ctx): string[] {
  if (!ctx.rangeOf) return [];
  const { song } = ctx;
  const lines: string[] = [];
  for (const trackId of ctx.wanted) {
    if (isDrums(song, trackId)) continue;
    const r = ctx.rangeOf(trackId);
    if (!r) continue;
    const [low, high] = r;
    const notes = ctx.own.filter((n) => n.trackId === trackId);
    const below = notes.filter((n) => n.pitch < low);
    const above = notes.filter((n) => n.pitch > high);
    const name = song.tracks[trackId]?.name ?? trackId;
    if (below.length) lines.push(`${name} · ${below.length} below ${pitchName(low, song.key)} (lowest ${pitchName(Math.min(...below.map((n) => n.pitch)), song.key)}) · ${barList(below.map((n) => barAt(song.meter, n.start)))} · ${ids(below.map((n) => n.id))}`);
    if (above.length) lines.push(`${name} · ${above.length} above ${pitchName(high, song.key)} (highest ${pitchName(Math.max(...above.map((n) => n.pitch)), song.key)}) · ${barList(above.map((n) => barAt(song.meter, n.start)))} · ${ids(above.map((n) => n.id))}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// 7. Key

function scaleOf(song: Song): Set<number> {
  const tonic = tonicOf(song.key);
  // Minor accepts the raised 6th and 7th (melodic and harmonic minor): they are not "outside".
  const steps = song.key.mode === "minor" ? [0, 2, 3, 5, 7, 8, 9, 10, 11] : [0, 2, 4, 5, 7, 9, 11];
  return new Set(steps.map((s) => (tonic + s) % 12));
}

function key(ctx: Ctx): string[] {
  const { song } = ctx;
  const scale = scaleOf(song);
  const byClass = new Map<number, { count: number; tracks: Set<string>; bars: number[] }>();
  for (const n of ctx.own) {
    if (isDrums(song, n.trackId) || scale.has(n.pitch % 12)) continue;
    const entry = byClass.get(n.pitch % 12) ?? { count: 0, tracks: new Set<string>(), bars: [] };
    entry.count++;
    entry.tracks.add(n.trackId);
    entry.bars.push(barAt(song.meter, n.start));
    byClass.set(n.pitch % 12, entry);
  }
  return [...byClass.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([pc, e]) => `${pitchName(pc + 60, song.key).replace(/-?\d+$/, "")} ×${e.count} (${keyText(song.key)}) · ${names(song, e.tracks)} · ${barList(e.bars)}`);
}

// ---------------------------------------------------------------------------
// 8. Harmony

const NOTE_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Pitch classes of a chord symbol ("Am", "F/A", "E7sus4", "Bbmaj7", "D5", "Gm/D"), or null if unreadable. */
export function chordPitchClasses(symbol: string): Set<number> | null {
  const m = /^([A-G])([#b♯♭]?)([^/]*)(?:\/([A-G])([#b♯♭]?))?$/.exec(symbol.trim());
  if (!m) return null;
  const acc = (s: string | undefined) => (s === "#" || s === "♯" || s === "+" ? 1 : s === "b" || s === "♭" || s === "-" ? -1 : 0);
  const root = (NOTE_CLASS[m[1]!]! + acc(m[2]) + 12) % 12;
  // "M7" and "Δ" are major sevenths; everything else is read in lower case.
  const q = m[3]!.replace(/M7|Δ7?/g, "maj7").toLowerCase();
  let iv: number[];
  if (/^5/.test(q)) iv = [0, 7];
  else if (q.startsWith("dim") || q.startsWith("°")) iv = [0, 3, 6];
  else if (q.startsWith("aug") || q.startsWith("+")) iv = [0, 4, 8];
  else if (q.startsWith("m") && !q.startsWith("maj")) iv = [0, 3, 7];
  else iv = [0, 4, 7];
  if (q.includes("sus4") || /sus(?!2)/.test(q)) iv = iv.filter((x) => x !== 3 && x !== 4).concat(5);
  if (q.includes("sus2")) iv = iv.filter((x) => x !== 3 && x !== 4).concat(2);
  // Sevenths.
  let seventh = false;
  if (q.includes("maj7") || q.includes("maj9") || q.includes("maj11") || q.includes("maj13")) (iv.push(11), (seventh = true));
  else if (q.includes("dim7")) (iv.push(9), (seventh = true));
  else if (/(^|[^#b♯♭+\-\d])7/.test(q) || q.includes("ø")) (iv.push(10), (seventh = true));
  // Extensions with their alterations: 9, b9, #9, 11, #11, 13, b13, add9.
  const rest = q.replace(/maj|dim|aug|sus[24]?|add/g, " ");
  let extended = false;
  for (const e of rest.matchAll(/([#b♯♭+\-]?)(13|11|9)/g)) {
    iv.push(({ "9": 2, "11": 5, "13": 9 } as Record<string, number>)[e[2]!]! + acc(e[1]));
    if (!q.includes("add")) extended = true;
  }
  // A plain 9, 11 or 13 chord implies its seventh.
  if (extended && !seventh) iv.push(q.startsWith("maj") ? 11 : 10);
  // Altered fifth: b5, #5.
  const fifth = /([#b♯♭+\-])5/.exec(rest);
  if (fifth && !/^5/.test(q)) iv = iv.filter((x) => x !== 7).concat(7 + acc(fifth[1]));
  if (/(^|[^1#b♯♭+\-\d])6/.test(rest)) iv.push(9);
  const out = new Set(iv.map((x) => (root + x + 12) % 12));
  if (m[4]) out.add((NOTE_CLASS[m[4]]! + acc(m[5]) + 12) % 12);
  return out;
}

function harmony(ctx: Ctx): string[] {
  const { song } = ctx;
  const chords = Object.entries(song.harmony)
    .map(([tick, symbol]) => ({ tick: Number(tick), symbol }))
    .sort((a, b) => a.tick - b.tick);
  if (chords.length === 0) return [];
  const beat = beatTicks(song.meter);
  const byChord = new Map<string, { symbol: string; bars: number[]; ids: string[]; pitches: Set<string>; tracks: Set<string> }>();
  for (const n of ctx.own) {
    if (isDrums(song, n.trackId) || n.duration < beat || n.start % beat !== 0) continue;
    const chord = chords.filter((c) => c.tick <= n.start).at(-1);
    if (!chord || chord.symbol === "-") continue;
    const tones = chordPitchClasses(chord.symbol);
    if (!tones || tones.has(n.pitch % 12)) continue;
    const k = `${chord.tick}`;
    const entry = byChord.get(k) ?? { symbol: chord.symbol, bars: [], ids: [], pitches: new Set<string>(), tracks: new Set<string>() };
    entry.bars.push(barAt(song.meter, n.start));
    entry.ids.push(n.id);
    entry.pitches.add(pitchName(n.pitch, song.key));
    entry.tracks.add(n.trackId);
    byChord.set(k, entry);
  }
  return [...byChord.values()].map((e) => `${barList(e.bars)} · ${e.symbol}: ${[...e.pitches].join(" ")} · ${names(song, e.tracks)} · ${ids(e.ids)}`);
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 0. Leftovers: chords, sections and annotations past the music, empty tracks

/** "1:15" for a number of bars at the song's tempo. */
function duration(song: Song, bars: number): string {
  const seconds = Math.round((bars * barTicks(song.meter) * song.tempo) / PPQ / 1_000_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// 0. The song concept's limits

/** Durations written in a concept, in seconds: "1:12", "45 s", "90 segundos", "2 min", "1 min 30 s". */
export function conceptDurations(text: string): number[] {
  const out: number[] = [];
  const t = text.toLowerCase();
  for (const m of t.matchAll(/(?<![\d:])(\d{1,2}):([0-5]\d)(?![\d:])/g)) out.push(Number(m[1]) * 60 + Number(m[2]));
  for (const m of t.matchAll(/(\d+)\s*(?:min|minutos?|minutes?)\b(?:\s*(?:y\s*)?(\d+)\s*(?:s|seg|segs|segundos?|sec|secs|seconds?)\b)?/g)) out.push(Number(m[1]) * 60 + Number(m[2] ?? 0));
  for (const m of t.matchAll(/(?<![\d:.,])(\d+(?:[.,]\d+)?)\s*(?:s|seg|segs|segundos?|sec|secs|seconds?)\b/g)) {
    const before = t.slice(0, m.index);
    if (/\d+\s*(?:min|minutos?|minutes?)\s*(?:y\s*)?$/.test(before)) continue;
    out.push(Number(m[1]!.replace(",", ".")));
  }
  return out;
}

/** A tempo written in a concept ("a 120 BPM"), if there is one. */
export function conceptTempo(text: string): number | null {
  const m = /(\d{2,3}(?:[.,]\d+)?)\s*bpm\b/i.exec(text);
  return m ? Number(m[1]!.replace(",", ".")) : null;
}

function clock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function conceptLimits(ctx: Ctx): string[] {
  const { song } = ctx;
  const text = song.concept?.text;
  const all = notesOf(song);
  if (!text || all.length === 0) return [];
  const lastEnd = Math.max(...all.map((n) => n.start + n.duration));
  // Only when the whole song is analysed: the limits are about the whole.
  if (ctx.start > 0 || ctx.end < lastEnd) return [];
  const out: string[] = [];
  const seconds = (lastEnd * song.tempo) / PPQ / 1_000_000;
  const lastBar = barAt(song.meter, lastEnd - 1);
  for (const target of [...new Set(conceptDurations(text))]) {
    const off = seconds - target;
    if (Math.abs(off) <= Math.max(2, target * 0.05)) continue;
    out.push(`the concept says ${clock(target)}; the music lasts ${clock(seconds)} (last note ends in c. ${lastBar}): ${Math.round(Math.abs(off))} s ${off > 0 ? "longer" : "shorter"}`);
  }
  const tempo = conceptTempo(text);
  const now = 60_000_000 / song.tempo;
  if (tempo !== null && Math.abs(tempo - now) >= 1) out.push(`the concept says ${tempo} BPM; the song is at ${Math.round(now * 100) / 100} BPM`);
  return out;
}

function leftovers(ctx: Ctx): string[] {
  const { song } = ctx;
  const all = notesOf(song);
  if (all.length === 0) return [];
  const lastBar = barAt(song.meter, Math.max(...all.map((n) => n.start + n.duration)) - 1);
  const after = barStart(song.meter, lastBar + 1);
  const lines: string[] = [];
  const chords = Object.keys(song.harmony).map(Number).filter((t) => t >= after);
  const sections = Object.values(song.sections).filter((x) => x.endBar > lastBar);
  const notes = Object.values(song.annotations).filter((x) => x.start >= after);
  const total = Math.max(lastBar, ...chords.map((t) => barAt(song.meter, t)), ...sections.map((x) => x.endBar), ...notes.map((x) => barAt(song.meter, x.end - 1)));
  if (total > lastBar) {
    const what = [chords.length ? `${chords.length} chord${chords.length === 1 ? "" : "s"}` : "", sections.length ? `section${sections.length === 1 ? "" : "s"} ${sections.map((x) => x.name).join(", ")}` : "", notes.length ? `annotation${notes.length === 1 ? "" : "s"} ${notes.map((x) => x.id).join(" ")}` : ""].filter(Boolean);
    lines.push(`c. ${lastBar + 1}–${total} · ${what.join(", ")} after the last note: the song reads ${total} bars (${duration(song, total)}) but the music ends at c. ${lastBar} (${duration(song, lastBar)})`);
  }
  const empty = song.trackOrder.filter((t) => !all.some((n) => n.trackId === t));
  if (empty.length) lines.push(`${names(song, empty)} · no notes`);
  return lines;
}

// ---------------------------------------------------------------------------
// 3b. Harmonic loops

function loops(ctx: Ctx): string[] {
  const { song } = ctx;
  if (Object.keys(song.harmony).length === 0) return [];
  const fromBar = barAt(song.meter, ctx.start);
  // Chords after the last note are leftovers (reported apart), not a loop that sounds.
  const lastEnd = notesOf(song).reduce((m, n) => Math.max(m, n.start + n.duration), 0);
  const toBar = Math.min(barAt(song.meter, ctx.end - 1), barAt(song.meter, Math.max(0, lastEnd - 1)));
  const chord = new Map<number, string>();
  for (let b = fromBar; b <= toBar; b++) chord.set(b, barHarmony(song, b));
  const out: string[] = [];
  const covered = new Set<number>();
  for (const size of [1, 2, 3, 4, 8]) {
    let bar = fromBar + size;
    while (bar <= toBar) {
      const same = (b: number) => !!chord.get(b) && chord.get(b) === chord.get(b - size);
      if (!same(bar) || covered.has(bar)) {
        bar++;
        continue;
      }
      let last = bar;
      while (last + 1 <= toBar && same(last + 1)) last++;
      const run = last - bar + 1;
      const times = Math.floor(run / size) + 1;
      // A held chord (size 1) is a pedal, not a loop: report only from eight bars on.
      if (times >= (size === 1 ? 8 : 3)) {
        const from = bar - size;
        const block = range(from, from + size - 1).map((b) => chord.get(b)).join(" | ");
        out.push(`${barList(range(from, last))} · ${size === 1 ? `one chord held ${times} bars` : `the same ${size}-bar progression ${times} times in a row`}: ${block}`);
        for (let b = from; b <= last; b++) covered.add(b);
      }
      bar = last + 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The shape: how much happens, section by section

/** "Shape: Intro 6 notes/bar · 2 tracks · v50 → Lumon 55 · 8 · v62 → … Peak c. 27 (97 notes, 9 tracks)." */
export function shapeText(song: Song, start: number, end: number): string {
  const fromBar = barAt(song.meter, start);
  const toBar = barAt(song.meter, end - 1);
  const notes = notesOf(song).filter((n) => !song.tracks[n.trackId]?.mute);
  const sections = Object.values(song.sections)
    .filter((x) => x.endBar >= fromBar && x.startBar <= toBar)
    .sort((a, b) => a.startBar - b.startBar);
  const spans: { name: string; from: number; to: number }[] = sections.length
    ? sections.map((x) => ({ name: x.name, from: Math.max(x.startBar, fromBar), to: Math.min(x.endBar, toBar) }))
    : range(fromBar, toBar)
        .filter((b) => (b - fromBar) % 4 === 0)
        .map((b) => ({ name: `c. ${b}–${Math.min(b + 3, toBar)}`, from: b, to: Math.min(b + 3, toBar) }));
  const stat = (from: number, to: number) => {
    const s = barStart(song.meter, from);
    const e = barStart(song.meter, to + 1);
    const inside = notes.filter((n) => n.start >= s && n.start < e);
    const bars = to - from + 1;
    const vel = inside.length ? Math.round(inside.reduce((a, n) => a + n.velocity, 0) / inside.length) : 0;
    return { perBar: Math.round(inside.length / bars), tracks: new Set(inside.map((n) => n.trackId)).size, vel };
  };
  const parts = spans.map((x) => {
    const st = stat(x.from, x.to);
    return `${x.name} ${st.perBar}·${st.tracks}·v${st.vel}`;
  });
  let peak = { bar: fromBar, count: -1, tracks: 0 };
  for (let b = fromBar; b <= toBar; b++) {
    const st = stat(b, b);
    if (st.perBar > peak.count) peak = { bar: b, count: st.perBar, tracks: st.tracks };
  }
  return `Shape (notes per bar · tracks · average velocity): ${parts.join(" → ")}. Busiest bar: c. ${peak.bar} (${peak.count} notes, ${peak.tracks} tracks).`;
}

/** Findings, check by check, for the given range and tracks. */
export function analyze(song: Song, options: AnalyzeOptions): Finding[] {
  const wanted = new Set(options.trackIds && options.trackIds.length ? options.trackIds : song.trackOrder);
  const all = notesOf(song);
  const ctx: Ctx = {
    song,
    start: options.start,
    end: options.end,
    wanted,
    heard: all.filter((n) => n.start < options.end && n.start + n.duration > options.start),
    own: all.filter((n) => wanted.has(n.trackId) && n.start >= options.start && n.start < options.end),
    rangeOf: options.rangeOf,
  };
  const run: Record<Check, (c: Ctx) => string[]> = {
    concept: conceptLimits,
    leftovers,
    low: lowRegister,
    crowded,
    repeats,
    loops,
    dynamics,
    abrupt,
    range: instrumentRange,
    key,
    harmony,
  };
  const out: Finding[] = [];
  for (const check of CHECKS) for (const text of run[check](ctx)) out.push({ check, text });
  return out;
}

/** The compact text `analyze` returns to the AI. */
export function analysisText(song: Song, options: AnalyzeOptions): string {
  const findings = analyze(song, options);
  const tracks = options.trackIds && options.trackIds.length ? names(song, options.trackIds) : "all tracks";
  const head = `Analysis of ${options.label ?? "the range"}, ${tracks} (r${song.revision}). It describes what is in the score; whether it is a problem is your call and the user's.`;
  const lines = [head, shapeText(song, options.start, options.end)];
  const empty: Check[] = [];
  for (const check of CHECKS) {
    const mine = findings.filter((f) => f.check === check);
    if (mine.length === 0) {
      if ((check !== "range" || options.rangeOf) && (check !== "concept" || song.concept)) empty.push(check);
      continue;
    }
    lines.push(`${HEADINGS[check]}:`);
    for (const f of mine.slice(0, MAX_LINES_PER_CHECK)) lines.push(`  ${f.text}`);
    if (mine.length > MAX_LINES_PER_CHECK) lines.push(`  … and ${mine.length - MAX_LINES_PER_CHECK} more (analyze a smaller range to see them)`);
  }
  if (empty.length) lines.push(`Nothing found for: ${empty.map((c) => CHECK_NAMES[c]).join(", ")}.`);
  lines.push("It cannot hear sounds: samples, balance and mix are still for the user's ears.");
  return lines.join("\n");
}

const CHECK_NAMES: Record<Check, string> = {
  concept: "the concept's limits",
  leftovers: "leftovers",
  low: "low register",
  crowded: "crowded register",
  repeats: "identical repeats",
  loops: "harmonic loops",
  dynamics: "formula dynamics",
  abrupt: "abrupt changes",
  range: "instrument ranges",
  key: "notes outside the key",
  harmony: "notes outside the chord",
};

