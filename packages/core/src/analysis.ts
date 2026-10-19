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
 *
 * Muted tracks are left out of what is heard (1, 2, 5). Percussion (channel 10) is left out of
 * pitch checks (1, 2, 6, 7, 8).
 */
import { type Note, type Song, barAt, barStart, barTicks, beatTicks, notesOf } from "./model.js";
import { pitchName } from "./compact.js";
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

export type Check = "low" | "crowded" | "repeats" | "dynamics" | "abrupt" | "range" | "key" | "harmony";

const HEADINGS: Record<Check, string> = {
  low: "Low register (intervals too close for their height blur into a buzz)",
  crowded: "Crowded register (parts in the same octave mask each other)",
  repeats: "Identical repeats (the same bars, note for note)",
  dynamics: "Formula dynamics",
  abrupt: "Abrupt changes at a bar line",
  range: "Outside the instrument's usual range",
  key: "Outside the key",
  harmony: "Long notes on the beat outside the written chord",
};

const CHECKS: readonly Check[] = ["low", "crowded", "repeats", "dynamics", "abrupt", "range", "key", "harmony"];

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
  const acc = (s: string | undefined) => (s === "#" || s === "♯" ? 1 : s === "b" || s === "♭" ? -1 : 0);
  const root = (NOTE_CLASS[m[1]!]! + acc(m[2]) + 12) % 12;
  const q = m[3]!.toLowerCase();
  let iv: number[];
  if (q.startsWith("5")) iv = [0, 7];
  else if (q.startsWith("dim") || q.startsWith("°")) iv = [0, 3, 6];
  else if (q.startsWith("aug") || q.startsWith("+")) iv = [0, 4, 8];
  else if (q.startsWith("m") && !q.startsWith("maj")) iv = [0, 3, 7];
  else iv = [0, 4, 7];
  if (q.includes("sus4")) iv = iv.filter((x) => x !== 3 && x !== 4).concat(5);
  if (q.includes("sus2")) iv = iv.filter((x) => x !== 3 && x !== 4).concat(2);
  if (q.includes("maj7")) iv.push(11);
  else if (q.includes("dim7")) iv.push(9);
  else if (/(^|[^a-z])7|m7|ø/.test(q) || q === "7") iv.push(10);
  if (/9|add9/.test(q)) iv.push(2);
  if (/6/.test(q) && !q.startsWith("5")) iv.push(9);
  if (/11/.test(q)) iv.push(5);
  if (/13/.test(q)) iv.push(9);
  const out = new Set(iv.map((x) => (root + x) % 12));
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
    low: lowRegister,
    crowded,
    repeats,
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
  const lines = [head];
  const empty: Check[] = [];
  for (const check of CHECKS) {
    const mine = findings.filter((f) => f.check === check);
    if (mine.length === 0) {
      if (check !== "range" || options.rangeOf) empty.push(check);
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
  low: "low register",
  crowded: "crowded register",
  repeats: "identical repeats",
  dynamics: "formula dynamics",
  abrupt: "abrupt changes",
  range: "instrument ranges",
  key: "notes outside the key",
  harmony: "notes outside the chord",
};

