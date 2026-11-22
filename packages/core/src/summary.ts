/**
 * summarize (docs/mcp.md, 4): the song by section and track without reading every note.
 * For each section (or blocks of 8 bars when there are none) and each track: how many notes and
 * how dense, register (whole range and where most notes sit), the usual figure and how much falls
 * on the beat, the contour of the top line, dynamics, and who wrote it; plus the written chords.
 * Describes; does not judge.
 */
import { type Song, barStart, beatTicks, orderedSections, orderedTracks } from "./model.js";
import { formatDuration, nominalDuration, pitchName } from "./compact.js";
import { barsLabel, songBars } from "./notation.js";

export interface SummaryOptions {
  /** Bars, inclusive. The whole song when omitted. */
  fromBar?: number;
  toBar?: number;
  trackIds?: readonly string[];
}

interface Block {
  name: string;
  from: number;
  to: number;
}

function blocks(song: Song, from: number, to: number): Block[] {
  const sections = orderedSections(song).filter((s) => s.endBar >= from && s.startBar <= to);
  const out: Block[] = [];
  let bar = from;
  for (const s of sections) {
    const start = Math.max(from, s.startBar);
    if (start > bar) out.push(...plainBlocks(bar, start - 1));
    if (s.endBar >= start && start >= bar) out.push({ name: s.name, from: start, to: Math.min(to, s.endBar) });
    bar = Math.max(bar, Math.min(to, s.endBar) + 1);
  }
  if (bar <= to) out.push(...plainBlocks(bar, to));
  return out;
}

function plainBlocks(from: number, to: number): Block[] {
  const out: Block[] = [];
  for (let b = from; b <= to; b += 8) out.push({ name: "", from: b, to: Math.min(to, b + 7) });
  return out;
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!;
}

/** Rising, falling, arch, valley or level: the top line (highest note of each beat) by thirds. */
function contour(points: readonly number[]): string {
  if (points.length < 4) return "too short";
  const third = Math.max(1, Math.floor(points.length / 3));
  const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const a = mean(points.slice(0, third));
  const m = mean(points.slice(third, points.length - third));
  const z = mean(points.slice(points.length - third));
  const T = 2; // semitones
  if (m - Math.max(a, z) > T) return "arch";
  if (Math.min(a, z) - m > T) return "valley";
  if (z - a > T) return "rising";
  if (a - z > T) return "falling";
  return "level";
}

function chordsOf(song: Song, start: number, end: number): string {
  const ticks = Object.keys(song.harmony)
    .map(Number)
    .sort((x, y) => x - y);
  const before = ticks.filter((t) => t < start).at(-1);
  const list = [...(before !== undefined ? [before] : []), ...ticks.filter((t) => t >= start && t < end)].map((t) => song.harmony[String(t)]!);
  const collapsed = list.filter((c, i) => i === 0 || c !== list[i - 1]);
  if (!collapsed.length) return "no chords written";
  return collapsed.length > 12 ? `${collapsed.slice(0, 12).join(" ")} …` : collapsed.join(" ");
}

export function summaryText(song: Song, options: SummaryOptions = {}): string {
  const last = songBars(song);
  const from = Math.max(1, options.fromBar ?? 1);
  const to = Math.min(last, options.toBar ?? last);
  const wanted = options.trackIds ? new Set(options.trackIds) : null;
  const tracks = orderedTracks(song).filter((t) => !wanted || wanted.has(t.id));
  const beat = beatTicks(song.meter);
  const lines = [`Four Hands · r${song.revision} · summary · ${barsLabel(from, to)}`];
  lines.push("Per track: notes (per bar) · range, most notes in · usual figure, on the beat · top line · velocity · author");
  for (const b of blocks(song, from, to)) {
    const start = barStart(song.meter, b.from);
    const end = barStart(song.meter, b.to + 1);
    const nBars = b.to - b.from + 1;
    lines.push("", `${b.name ? `${b.name} ` : ""}${barsLabel(b.from, b.to)} · ${chordsOf(song, start, end)}`);
    for (const t of tracks) {
      const notes = Object.values(song.notes).filter((n) => n.trackId === t.id && n.start >= start && n.start < end);
      if (!notes.length) {
        lines.push(`  ${t.name} (${t.id}): silent`);
        continue;
      }
      const parts: string[] = [`${notes.length} (${Math.round((notes.length / nBars) * 10) / 10})`];
      const drums = t.channel === 9;
      if (!drums) {
        const pitches = notes.map((n) => n.pitch).sort((x, y) => x - y);
        const lo = pitches[0]!;
        const hi = pitches.at(-1)!;
        parts.push(`${pitchName(lo, song.key)}–${pitchName(hi, song.key)}, most ${pitchName(quantile(pitches, 0.25), song.key)}–${pitchName(quantile(pitches, 0.75), song.key)}`);
      }
      const figures = new Map<number, number>();
      for (const n of notes) figures.set(nominalDuration(n.duration), (figures.get(nominalDuration(n.duration)) ?? 0) + 1);
      const [fig, count] = [...figures.entries()].sort((x, y) => y[1] - x[1])[0]!;
      // On the beat: within a 64th of it (played notes are rarely exact).
      const tolerance = beat / 16;
      const onBeat = notes.filter((n) => {
        const off = (n.start - start) % beat;
        return off < tolerance || beat - off < tolerance;
      }).length;
      parts.push(`${formatDuration(fig)} ${Math.round((count / notes.length) * 100)}%, on the beat ${Math.round((onBeat / notes.length) * 100)}%`);
      if (!drums) {
        const tops = new Map<number, number>();
        for (const n of notes) {
          const k = Math.floor((n.start - start) / beat);
          tops.set(k, Math.max(tops.get(k) ?? 0, n.pitch));
        }
        parts.push(contour([...tops.entries()].sort((x, y) => x[0] - y[0]).map(([, p]) => p)));
      }
      const vs = notes.map((n) => n.velocity).sort((x, y) => x - y);
      parts.push(`v${Math.round(vs.reduce((a, x) => a + x, 0) / vs.length)} (${vs[0]}–${vs.at(-1)})`);
      const user = notes.filter((n) => n.shapedBy.by === "user").length;
      parts.push(user === notes.length ? "user" : user === 0 ? "AI" : `user ${Math.round((user / notes.length) * 100)}%`);
      if (t.mute) parts.push("muted");
      lines.push(`  ${t.name} (${t.id}): ${parts.join(" · ")}`);
    }
  }
  if (tracks.length === 0) lines.push("", "No tracks.");
  return lines.join("\n");
}
