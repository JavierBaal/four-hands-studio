/**
 * F2.3, the AI's ear (Fran, 04/11/2026): what the engine measured in the last playback, and the
 * sums Four Hands makes with it and the score (where each thing happens, in bars and sections).
 *
 * The engine gives, per strip, bus and the master, a frame per second: where the song was (in
 * quarter notes), its loudness (LUFS) and its energy in seven bands. Pure functions here; the text
 * the AI reads is in main/ai/listen.ts.
 */

/** The seven bands, as the engine measures them (Analyzer.h, kBandEdges). */
export const BANDS = [
  { id: "sub", name: "sub", lo: 20, hi: 60 },
  { id: "bass", name: "bass", lo: 60, hi: 250 },
  { id: "lowmid", name: "low-mids", lo: 250, hi: 500 },
  { id: "mid", name: "mids", lo: 500, hi: 2000 },
  { id: "highmid", name: "high-mids", lo: 2000, hi: 4000 },
  { id: "presence", name: "presence", lo: 4000, hi: 6000 },
  { id: "air", name: "air", lo: 6000, hi: 20000 },
] as const;

export interface AnalysisFrame {
  /** Where the second started, in quarter notes from the start of the song. */
  ppq: number;
  lufs: number;
  /** dB per band, BANDS order. */
  bands: number[];
  peakDb: number;
  /** Master only. */
  correlation?: number;
  side?: number;
}

export interface ChannelAnalysis {
  integrated: number;
  shortMax: number;
  range: number;
  peak: number;
  truePeak: number;
  seconds: number;
  frames: AnalysisFrame[];
}

export interface EngineAnalysis {
  strips: Array<ChannelAnalysis & { strip: number }>;
  buses: Array<ChannelAnalysis & { bus: number }>;
  master: ChannelAnalysis | null;
  gaps: number;
}

/** The engine's reply (frames as rows of numbers) as typed data; null if it is not one. */
export function parseAnalysis(reply: unknown): EngineAnalysis | null {
  if (!reply || typeof reply !== "object") return null;
  const r = reply as Record<string, unknown>;
  const channel = (c: Record<string, unknown>, master: boolean): ChannelAnalysis => ({
    integrated: Number(c.integrated ?? -100),
    shortMax: Number(c.shortMax ?? -100),
    range: Number(c.range ?? 0),
    peak: Number(c.peak ?? -120),
    truePeak: Number(c.truePeak ?? -120),
    seconds: Number(c.seconds ?? 0),
    frames: (Array.isArray(c.frames) ? (c.frames as number[][]) : []).map((row) => {
      const f: AnalysisFrame = { ppq: row[0]!, lufs: row[1]!, bands: row.slice(2, 2 + BANDS.length), peakDb: row[2 + BANDS.length]! };
      if (master) {
        f.correlation = row[3 + BANDS.length] ?? 1;
        f.side = row[4 + BANDS.length] ?? 0;
      }
      return f;
    }),
  });
  const list = (v: unknown) => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []);
  return {
    strips: list(r.strips).map((c) => ({ ...channel(c, false), strip: Number(c.strip) })),
    buses: list(r.buses).map((c) => ({ ...channel(c, false), bus: Number(c.bus) })),
    master: r.master && typeof r.master === "object" ? channel(r.master as Record<string, unknown>, true) : null,
    gaps: Number(r.gaps ?? 0),
  };
}

/** Energy average of dB values (what loudness and band levels add up as). */
export function energyMeanDb(values: readonly number[]): number {
  if (values.length === 0) return -120;
  const mean = values.reduce((s, v) => s + Math.pow(10, v / 10), 0) / values.length;
  return mean > 0 ? 10 * Math.log10(mean) : -120;
}

/** A frame counts as «playing» above this loudness. */
export const ACTIVE_LUFS = -50;

/**
 * A balanced mix's band levels, relative to the mids: a spectrum falling 4.5 dB per octave (the
 * average of finished mixes is close to it), through the engine's band filters (2nd-order band
 * passes, 0 dB at the centre). A guide, not a rule: orchestral music has less sub, rock more.
 */
export const REFERENCE_BANDS: number[] = (() => {
  const energy = BANDS.map((b) => {
    const f0 = Math.sqrt(b.lo * b.hi);
    const q = f0 / (b.hi - b.lo);
    let sum = 0;
    // Log-spaced integration of PSD(f) · |H(f)|² from 10 Hz to 24 kHz.
    const steps = 2000;
    for (let i = 0; i < steps; i++) {
      const fa = 10 * Math.pow(2400, i / steps);
      const fb = 10 * Math.pow(2400, (i + 1) / steps);
      const f = Math.sqrt(fa * fb);
      const x = f / f0;
      const h2 = (x / q) ** 2 / ((1 - x * x) ** 2 + (x / q) ** 2);
      sum += Math.pow(f, -1.5) * h2 * (fb - fa);
    }
    return 10 * Math.log10(sum);
  });
  const mid = energy[3]!;
  return energy.map((e) => e - mid);
})();

/** Band levels of a set of frames, energy-averaged over the frames that play. */
export function bandLevels(frames: readonly AnalysisFrame[]): number[] {
  const active = frames.filter((f) => f.lufs > ACTIVE_LUFS);
  return BANDS.map((_, i) => energyMeanDb(active.map((f) => f.bands[i] ?? -120)));
}

/** Loudness while it plays (energy average of its active seconds). */
export function playingLoudness(frames: readonly AnalysisFrame[]): number {
  const active = frames.filter((f) => f.lufs > ACTIVE_LUFS);
  return active.length ? energyMeanDb(active.map((f) => f.lufs)) : -120;
}

/**
 * The master's tonal balance against the reference, per band, in dB (both normalised so their
 * total energy is the same).
 */
export function tonalBalance(levels: readonly number[]): number[] {
  const total = energyMeanDb(levels);
  const refTotal = energyMeanDb(REFERENCE_BANDS);
  return levels.map((l, i) => l - total - (REFERENCE_BANDS[i]! - refTotal));
}

/** Frames whose second starts in [fromPpq, toPpq). */
export function framesIn<T extends { ppq: number }>(frames: readonly T[], fromPpq: number, toPpq: number): T[] {
  return frames.filter((f) => f.ppq >= fromPpq - 1e-6 && f.ppq < toPpq - 1e-6);
}

export interface Masking {
  a: string;
  b: string;
  band: number;
  /** Bars where it happens: first and last. */
  from: number;
  to: number;
  /** How far apart the two are in that band (dB): close means they fight. */
  gap: number;
  /** How strong the band is there, against the whole mix's level (dB). */
  level: number;
}

/**
 * Two parts that fight: in a window of bars, both have most of their energy in the same band (within
 * 3 dB of their own strongest), within 6 dB of each other there, and loud enough to matter in the
 * mix (within 12 dB of the mix's level in that band). Adjacent windows with the same pair and band
 * join into one range.
 */
export function findMasking(
  windows: ReadonlyArray<{ from: number; to: number; fromPpq: number; toPpq: number }>,
  parts: ReadonlyArray<{ name: string; frames: readonly AnalysisFrame[] }>,
  mix: readonly AnalysisFrame[],
): Masking[] {
  const found: Masking[] = [];
  for (const w of windows) {
    const mixLevels = bandLevels(framesIn(mix, w.fromPpq, w.toPpq));
    const levels = parts
      .map((p) => ({ name: p.name, levels: bandLevels(framesIn(p.frames, w.fromPpq, w.toPpq)) }))
      .filter((p) => Math.max(...p.levels) > -80);
    for (let i = 0; i < levels.length; i++)
      for (let j = i + 1; j < levels.length; j++) {
        const a = levels[i]!;
        const b = levels[j]!;
        const topA = Math.max(...a.levels);
        const topB = Math.max(...b.levels);
        for (let band = 1; band < BANDS.length - 1; band++) {
          const la = a.levels[band]!;
          const lb = b.levels[band]!;
          if (la < topA - 3 || lb < topB - 3) continue;
          if (Math.abs(la - lb) > 6) continue;
          const level = Math.max(la, lb) - mixLevels[band]!;
          if (level < -12) continue;
          const last = found.find((m) => m.a === a.name && m.b === b.name && m.band === band && m.to === w.from - 1);
          if (last) {
            last.to = w.to;
            last.gap = Math.min(last.gap, Math.abs(la - lb));
            last.level = Math.max(last.level, level);
          } else found.push({ a: a.name, b: b.name, band, from: w.from, to: w.to, gap: Math.abs(la - lb), level });
        }
      }
  }
  // The closest and strongest first.
  return found.sort((x, y) => x.gap - x.level - (y.gap - y.level));
}

/** A loudness target: integrated LUFS and the true peak ceiling. */
export interface LoudnessTarget {
  name: string;
  lufs: number | null;
  truePeak: number | null;
}

/** The targets of serie (Fran, 04/11/2026); others come from the conversation. */
export const TARGETS: Record<string, LoudnessTarget> = {
  streaming: { name: "streaming (Spotify, Apple Music, YouTube)", lufs: -14, truePeak: -1 },
  cinema: { name: "cinema and TV (EBU R128; the US uses -24, ATSC A/85)", lufs: -23, truePeak: -1 },
  none: { name: "no target: balance only", lufs: null, truePeak: null },
};
