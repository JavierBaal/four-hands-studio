/**
 * Compact read format (ESQUEMA_MCP.md, 3.1 and 3.3): what the AI reads instead of ticks.
 *
 *   Four Hands · r1532 · Violines (t3) · c. 17–18
 *   c17 · Am
 *   n482 E5 17.1 1/4 v72 @u
 *   n483 D5 17.2 1/8 v65 @u ~s+0.03
 *
 * - Pitch in scientific notation, middle C = C4; sharps or flats according to the key.
 * - Position `bar.beat`, plus a fraction of a beat. The beat is the meter's denominator.
 * - Duration as a fraction of a whole note: `.` dotted, `t` triplet, `+` tie.
 * - Position and duration are the nominal ones (nearest sixteenth or eighth-note triplet);
 *   the deviation from them is computed here, on read, and only shown when it exists.
 */
import { type KeySignature, type Meter, type Note, type Song, barAt, barStart, beatTicks, idNumber, orderedTracks } from "./model.js";
import { EIGHTH_TRIPLET, PPQ, SIXTEENTH, nominalGridPosition } from "./time.js";

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** 60 → C4. Keys with flats spell black keys as flats; the rest, as sharps. */
export function pitchName(pitch: number, key: KeySignature = { fifths: 0, mode: "major" }): string {
  const names = key.fifths < 0 ? FLATS : SHARPS;
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function fraction(numerator: number, denominator: number): string {
  const g = gcd(numerator, denominator);
  return `${numerator / g}/${denominator / g}`;
}

/** 1-based `bar.beat`, plus `+n/d` of a beat when the position falls inside a beat. */
export function formatPosition(meter: Meter, tick: number): string {
  const bar = barAt(meter, tick);
  const inBar = tick - barStart(meter, bar);
  const beat = beatTicks(meter);
  const base = `${bar}.${Math.floor(inBar / beat) + 1}`;
  const rest = inBar % beat;
  return rest === 0 ? base : `${base}+${fraction(rest, beat)}`;
}

const WHOLE = 4 * PPQ;
/** Plain, dotted and triplet figures, largest first: [ticks, text]. */
const FIGURES: [number, string][] = [];
for (const d of [1, 2, 4, 8, 16, 32]) {
  const t = WHOLE / d;
  FIGURES.push([t, `1/${d}`], [(t * 3) / 2, `1/${d}.`], [(t * 2) / 3, `1/${d}t`]);
}
FIGURES.sort((a, b) => b[0] - a[0]);
const PLAIN = FIGURES.filter(([t, s]) => /^1\/\d+$/.test(s) && Number.isInteger(t)).map(([t]) => t);

/** A nominal duration as figures: `1/4`, `1/8.`, `1/8t`, `1/2+1/8`, `1/1+1/1`. */
export function formatDuration(ticks: number): string {
  const parts: string[] = [];
  let rest = ticks;
  while (rest > 0) {
    const exact = FIGURES.find(([t]) => t === rest);
    if (exact) {
      parts.push(exact[1]);
      break;
    }
    // Tie the largest plain figure that fits and keep going.
    const plain = PLAIN.find((t) => t < rest);
    if (plain === undefined) {
      parts.push(`${rest}t`); // unreachable for nominal durations; never hide a value
      break;
    }
    parts.push(`1/${WHOLE / plain}`);
    rest -= plain;
  }
  return parts.join("+");
}

/** Nominal duration: the nearest multiple of a sixteenth or an eighth-note triplet, never zero. */
export function nominalDuration(ticks: number): number {
  const { gridTick } = nominalGridPosition(ticks);
  if (gridTick > 0) return gridTick;
  return Math.abs(ticks - SIXTEENTH) <= Math.abs(ticks - EIGHTH_TRIPLET) ? SIXTEENTH : EIGHTH_TRIPLET;
}

/** `+0.03` / `-0.02` in beats, or null when it rounds to nothing. */
function deviation(ticks: number, beat: number): string | null {
  const value = Math.round((ticks / beat) * 100) / 100;
  if (value === 0) return null;
  return `${value > 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}`;
}

interface Placed {
  note: Note;
  start: number;
  duration: number;
  startDeviation: number;
  durationDeviation: number;
}

function place(note: Note): Placed {
  const start = nominalGridPosition(note.start).gridTick;
  const duration = nominalDuration(note.duration);
  return { note, start, duration, startDeviation: note.start - start, durationDeviation: note.duration - duration };
}

export function formatNote(song: Song, note: Note): string {
  return formatPlaced(song, place(note));
}

function formatPlaced(song: Song, p: Placed): string {
  const beat = beatTicks(song.meter);
  const parts = [
    p.note.id,
    pitchName(p.note.pitch, song.key),
    formatPosition(song.meter, p.start),
    formatDuration(p.duration),
    `v${p.note.velocity}`,
    p.note.shapedBy.by === "user" ? "@u" : "@ai",
  ];
  const s = deviation(p.startDeviation, beat);
  const d = deviation(p.durationDeviation, beat);
  if (s) parts.push(`~s${s}`);
  if (d) parts.push(`~d${d}`);
  return parts.join(" ");
}

/** Chords of a bar: those that start in it, or the one still sounding from before. "Am", "F, 17.3 G". */
export function barHarmony(song: Song, bar: number): string {
  const start = barStart(song.meter, bar);
  const end = barStart(song.meter, bar + 1);
  const chords = Object.entries(song.harmony)
    .map(([tick, symbol]) => ({ tick: Number(tick), symbol }))
    .sort((a, b) => a.tick - b.tick);
  const inBar = chords.filter((c) => c.tick >= start && c.tick < end);
  const carried = chords.filter((c) => c.tick < start).at(-1);
  const list = inBar[0]?.tick === start || !carried ? inBar : [{ tick: start, symbol: carried.symbol }, ...inBar];
  return list.map((c, i) => (i === 0 && c.tick === start ? c.symbol : `${formatPosition(song.meter, c.tick)} ${c.symbol}`)).join(", ");
}

export interface ReadNotesOptions {
  /** Track ids. All tracks when omitted. */
  trackIds?: readonly string[];
  /** Bars, inclusive, by the notes' nominal start. */
  fromBar?: number;
  toBar?: number;
  /** Only these notes (a page of a long read, or the user's selection). */
  noteIds?: ReadonlySet<string>;
}

/** Notes grouped by track and bar, with the harmony at the head of each bar. */
export function formatNotes(song: Song, options: ReadNotesOptions = {}): string {
  const wanted = options.trackIds ? new Set(options.trackIds) : null;
  const tracks = orderedTracks(song).filter((t) => !wanted || wanted.has(t.id));
  const from = options.fromBar ?? 1;
  const to = options.toBar ?? Infinity;
  const blocks: string[] = [];
  for (const track of tracks) {
    const placed = Object.values(song.notes)
      .filter((n) => n.trackId === track.id && (!options.noteIds || options.noteIds.has(n.id)))
      .map(place)
      .filter((p) => {
        const bar = barAt(song.meter, p.start);
        return bar >= from && bar <= to;
      })
      .sort((a, b) => a.start - b.start || a.note.pitch - b.note.pitch || idNumber(a.note.id) - idNumber(b.note.id));
    const bars = placed.map((p) => barAt(song.meter, p.start));
    const first = options.fromBar ?? bars[0] ?? from;
    const last = options.toBar ?? bars.at(-1) ?? first;
    const range = first === last ? `c. ${first}` : `c. ${first}–${last}`;
    const lines = [`Four Hands · r${song.revision} · ${track.name} (${track.id}) · ${range}`];
    if (placed.length === 0) lines.push("(no notes)");
    let currentBar = 0;
    placed.forEach((p, i) => {
      const bar = bars[i]!;
      if (bar !== currentBar) {
        currentBar = bar;
        const harmony = barHarmony(song, bar);
        lines.push(harmony ? `c${bar} · ${harmony}` : `c${bar}`);
      }
      lines.push(formatPlaced(song, p));
    });
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

// ---------------------------------------------------------------------------
// Curves (H4): expression (CC11) and modulation (CC1), read as ramps and holds

/** Points of a ramp from v1 to v2 over [start, end), one per step; repeated values are dropped. */
export function rampPoints(start: number, end: number, from: number, to: number, step: number): { tick: number; value: number }[] {
  const n = Math.max(1, Math.floor((end - start) / step));
  const out: { tick: number; value: number }[] = [];
  for (let k = 0; k < n; k++) {
    const value = Math.round(n === 1 ? to : from + ((to - from) * k) / (n - 1));
    if (out.at(-1)?.value !== value) out.push({ tick: start + k * step, value });
  }
  return out;
}

/**
 * A curve as the AI reads it: "17.1→20.4+3/4 40→100 · 21.1 100". Runs of points that follow a
 * straight line (within 2) become one ramp; the rest are single points.
 */
export function curveText(song: Song, points: readonly { tick: number; value: number }[], start = 0, end = Infinity): string {
  const ps = points.filter((p) => p.tick >= start && p.tick < end);
  const parts: string[] = [];
  let i = 0;
  while (i < ps.length) {
    let j = i + 1;
    // Extend while every point between i and j sits on the line from i to j, and the run goes one way.
    while (j < ps.length) {
      const a = ps[i]!;
      const b = ps[j]!;
      const dir = Math.sign(b.value - a.value);
      let fits = dir !== 0 && Math.sign(b.value - ps[j - 1]!.value) === dir;
      for (let k = i + 1; fits && k < j; k++) {
        const p = ps[k]!;
        const expected = a.value + ((b.value - a.value) * (p.tick - a.tick)) / (b.tick - a.tick);
        if (Math.abs(p.value - expected) > 2 || Math.sign(p.value - ps[k - 1]!.value) !== dir) fits = false;
      }
      if (!fits) break;
      j++;
    }
    const last = j - 1;
    if (last >= i + 2) {
      parts.push(`${formatPosition(song.meter, ps[i]!.tick)}→${formatPosition(song.meter, ps[last]!.tick)} ${ps[i]!.value}→${ps[last]!.value}`);
      i = last + 1;
    } else {
      parts.push(`${formatPosition(song.meter, ps[i]!.tick)} ${ps[i]!.value}`);
      i++;
    }
  }
  return parts.join(" · ");
}
