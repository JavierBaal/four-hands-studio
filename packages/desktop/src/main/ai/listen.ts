/**
 * F2.3, the AI's ear (Fran, 04/11/2026): `analyze_mix`, what the last playback measured, read with
 * the score. Loudness against a target, the master's tonal balance, each section's loudness, where
 * each part has its energy, and which parts fight in the same band, in which bars.
 *
 * A meter, not ears: the text says so, and the AI says it to the user.
 */
import { PPQ, type Song, barAt, barStart, busList, orderedSections, orderedTracks } from "@fourhands/core";
import { ACTIVE_LUFS, BANDS, type ChannelAnalysis, type EngineAnalysis, type LoudnessTarget, bandLevels, findMasking, framesIn, playingLoudness, tonalBalance } from "../../shared/analysis.js";

export interface AnalysisContext {
  analysis: EngineAnalysis;
  at: number;
  /** Each track's strip and each bus's place in the engine, as they were when it was measured. */
  strips: Record<string, number>;
  buses: Record<string, number>;
}

const n1 = (v: number) => (Number.isFinite(v) && v > -99 ? v.toFixed(1) : "silent");
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;
const bandName = (i: number) => `${BANDS[i]!.name} (${hz(BANDS[i]!.lo)}–${hz(BANDS[i]!.hi)})`;
function hz(f: number): string {
  return f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`;
}

/** "c. 9–16" or "c. 9". */
function bars(from: number, to: number): string {
  return from === to ? `c. ${from}` : `c. ${from}–${to}`;
}

/** Bar ranges covered by the measured seconds: "1–24, 37–52". */
function coverage(song: Song, frames: ReadonlyArray<{ ppq: number }>): { text: string; count: number } {
  const set = new Set(frames.map((f) => barAt(song.meter, Math.round(f.ppq * PPQ))));
  const sorted = [...set].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    ranges.push(sorted[i] === sorted[j] ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j;
  }
  return { text: ranges.join(", "), count: sorted.length };
}

export interface MixReportOptions {
  target: LoudnessTarget;
  /** Only these bars (from the playback). */
  fromBar?: number | undefined;
  toBar?: number | undefined;
}

export function mixReport(song: Song, ctx: AnalysisContext | null, options: MixReportOptions): string {
  const master = ctx?.analysis.master;
  if (!ctx || !master || master.frames.length === 0)
    return "Nothing measured yet: the engine listens while the song plays. Ask the user to play the song (or the part you care about) through the audio engine and stop; then call analyze_mix again.";
  const toPpq = (bar: number) => barStart(song.meter, bar) / PPQ;
  const fromPpq = options.fromBar ? toPpq(options.fromBar) : -Infinity;
  const untilPpq = options.toBar ? toPpq(options.toBar + 1) : Infinity;
  const cut = <T extends { ppq: number }>(frames: readonly T[]) => framesIn(frames, fromPpq, untilPpq);
  const masterFrames = cut(master.frames);
  if (masterFrames.length === 0) return `Nothing measured in ${bars(options.fromBar ?? 1, options.toBar ?? options.fromBar ?? 1)}: the last playback did not go through those bars. Ask the user to play them.`;

  const lines: string[] = [];
  const cov = coverage(song, masterFrames);
  const when = new Date(ctx.at).toISOString().slice(11, 16);
  lines.push(`Four Hands · the AI's ear · last playback (${when} UTC), measured after each fader: bars ${cov.text}${options.fromBar ? " (the bars you asked for)" : ""}, ${masterFrames.length} s.`);
  if (ctx.analysis.gaps > 0) lines.push(`(${ctx.analysis.gaps} audio blocks could not be measured: the computer was busy. The figures are close, not exact.)`);

  // The master against the target. Integrated loudness is the engine's own (gated, the whole playback);
  // for a range of bars, the energy average of its seconds.
  const whole = !options.fromBar && !options.toBar;
  const integrated = whole ? master.integrated : playingLoudness(masterFrames);
  const t = options.target;
  const parts: string[] = [`${n1(integrated)} LUFS ${whole ? "integrated" : "in those bars"}`];
  if (t.lufs !== null) {
    const d = integrated - t.lufs;
    parts[0] += Math.abs(d) <= 1 ? " (on target)" : d > 0 ? ` (${d.toFixed(1)} dB above target)` : ` (${(-d).toFixed(1)} dB below target)`;
  }
  if (whole) parts.push(`loudest 3 s ${n1(master.shortMax)} LUFS`, `loudness range ${master.range.toFixed(1)} LU`);
  const tp = whole ? master.truePeak : Math.max(...masterFrames.map((f) => f.peakDb));
  parts.push(`${whole ? "true peak" : "peak"} ${n1(tp)} ${whole ? "dBTP" : "dBFS"}${t.truePeak !== null ? (tp > t.truePeak ? ` (OVER the ${t.truePeak} ceiling: a limiter on the Master)` : " (under the ceiling)") : tp > -0.1 ? " (at 0: it may clip)" : ""}`);
  const corr = masterFrames.map((f) => f.correlation ?? 1);
  const side = masterFrames.map((f) => f.side ?? 0);
  const meanCorr = corr.reduce((s, v) => s + v, 0) / corr.length;
  const meanSide = side.reduce((s, v) => s + v, 0) / side.length;
  const width = meanSide < 0.05 ? "almost mono" : meanSide < 0.15 ? "narrow" : meanSide < 0.3 ? "medium" : meanSide < 0.45 ? "wide" : "very wide";
  parts.push(`stereo ${width} (correlation ${meanCorr.toFixed(2)}${Math.min(...corr) < 0 ? `, below 0 in some seconds: phase problems, it will sound thin in mono` : ""})`);
  lines.push(`Target: ${t.name}${t.lufs !== null ? `, ${t.lufs} LUFS integrated, true peak ≤ ${t.truePeak} dBTP` : ""}.`);
  lines.push(`Master: ${parts.join(" · ")}.`);

  // Tonal balance.
  const balance = tonalBalance(bandLevels(masterFrames));
  const note = (i: number, d: number) => {
    if (d > 4) return [" (heavy)", " (boomy)", " (muddy)", " (boxy)", " (harsh)", " (sibilant)", " (bright)"][i]!;
    if (d < -4) return [" (light, normal in orchestral music)", " (thin)", " (hollow)", " (scooped)", " (soft)", " (dull)", " (dull, dark)"][i]!;
    return "";
  };
  lines.push(`Tonal balance of the master against a balanced mix (±4 dB is normal; style changes it): ${balance.map((d, i) => `${BANDS[i]!.name} ${signed(d)}${note(i, d)}`).join(", ")}.`);

  // Sections: loudness of each, from the master.
  const sections = orderedSections(song).filter((s) => !options.fromBar || (s.endBar >= options.fromBar && s.startBar <= (options.toBar ?? Infinity)));
  const sectionText = sections
    .map((s) => ({ s, frames: cut(framesIn(master.frames, toPpq(s.startBar), toPpq(s.endBar + 1))) }))
    .filter((x) => x.frames.length)
    .map((x) => `${x.s.name} ${bars(x.s.startBar, x.s.endBar)} ${n1(playingLoudness(x.frames))}`);
  if (sectionText.length) lines.push(`Loudness by section (LUFS while playing): ${sectionText.join(" · ")}.`);

  // Tracks and buses: how loud while they play, and where their energy is.
  const channels: Array<{ name: string; kind: "track" | "bus"; data: ChannelAnalysis }> = [];
  for (const t of orderedTracks(song)) {
    if (t.output === "external") continue;
    const strip = ctx.strips[t.id];
    const data = ctx.analysis.strips.find((c) => c.strip === strip);
    if (data) channels.push({ name: t.name, kind: "track", data });
  }
  for (const b of busList(song)) {
    const index = ctx.buses[b.id];
    const data = ctx.analysis.buses.find((c) => c.bus === index);
    if (data) channels.push({ name: b.name, kind: "bus", data });
  }
  const masterLoud = playingLoudness(masterFrames);
  const describe = (c: (typeof channels)[number]) => {
    const frames = cut(c.data.frames);
    const loud = playingLoudness(frames);
    if (loud <= ACTIVE_LUFS) return null;
    const levels = bandLevels(frames);
    const top = Math.max(...levels);
    const main = levels.map((l, i) => ({ l, i })).filter((x) => x.l >= top - 6).map((x) => BANDS[x.i]!.name);
    const peak = Math.max(...frames.map((f) => f.peakDb));
    const playing = frames.filter((f) => f.lufs > ACTIVE_LUFS).length;
    return `- ${c.kind === "bus" ? "bus " : ""}${c.name}: ${n1(loud)} LUFS while playing (${signed(loud - masterLoud)} against the master), energy in ${main.join(" and ")}, peak ${n1(peak)} dBFS, sounding ${playing} of ${frames.length} s${peak > -0.1 ? ", AT 0 dBFS" : ""}`;
  };
  const rows = channels.map(describe).filter((r): r is string => !!r);
  const silent = channels.filter((c) => !describe(c)).map((c) => c.name);
  if (rows.length) lines.push("Parts (LUFS while each plays; 'energy in' = bands within 6 dB of its strongest):", ...rows);
  if (silent.length) lines.push(`Silent there: ${silent.join(", ")}.`);
  const outside = orderedTracks(song).filter((t) => t.output === "external").map((t) => t.name);
  if (outside.length) lines.push(`Not measured (they sound in the user's DAW): ${outside.join(", ")}.`);

  // Masking, in 4-bar windows inside the measured range.
  const measuredBars = [...new Set(masterFrames.map((f) => barAt(song.meter, Math.round(f.ppq * PPQ))))].sort((a, b) => a - b);
  const windows: Array<{ from: number; to: number; fromPpq: number; toPpq: number }> = [];
  if (measuredBars.length) {
    for (let start = measuredBars[0]!; start <= measuredBars.at(-1)!; start += 4) {
      const end = start + 3;
      windows.push({ from: start, to: end, fromPpq: Math.max(fromPpq, toPpq(start)), toPpq: Math.min(untilPpq, toPpq(end + 1)) });
    }
  }
  const tracks = channels.filter((c) => c.kind === "track").map((c) => ({ name: c.name, frames: c.data.frames }));
  const masking = findMasking(windows, tracks, master.frames).slice(0, 8);
  const sectionOf = (bar: number) => orderedSections(song).find((s) => bar >= s.startBar && bar <= s.endBar)?.name;
  if (masking.length) {
    lines.push("Possible masking (two parts strong in the same band at the same time; the first ones fight most):");
    for (const m of masking) {
      const where = sectionOf(m.from);
      lines.push(`- ${m.a} and ${m.b}: ${bandName(m.band)}, ${bars(m.from, m.to)}${where ? ` (${where})` : ""}, ${m.gap.toFixed(1)} dB apart`);
    }
  } else if (tracks.length > 1) lines.push("No clear masking between parts in these bars.");

  lines.push(
    "This is a meter, not hearing: it measures loudness and energy by band, not timbre or taste. Say so when you base an opinion on it. " +
      "Before reaching for an EQ, consider the score (a part an octave up, a thinner chord, another instrument on the line); after any change, ask the user to play it again and measure.",
  );
  return lines.join("\n");
}
