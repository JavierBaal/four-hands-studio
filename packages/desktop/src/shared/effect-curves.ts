/**
 * What the own effects do, drawn (F2.2 parte C2): the EQ's frequency response and the compressor's
 * transfer curve, with the same formulas as the engine (engine/src/Effects.cpp), so the curve on
 * screen is the one heard. Pure.
 */

interface Coeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function norm(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Coeffs {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function cut(rate: number, f: number, high: boolean): Coeffs {
  const w = (2 * Math.PI * f) / rate;
  const c = Math.cos(w);
  const a = Math.sin(w) / (2 * 0.7071);
  return high ? norm((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + a, -2 * c, 1 - a) : norm((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + a, -2 * c, 1 - a);
}

function bell(rate: number, f: number, gainDb: number, q: number): Coeffs | null {
  if (Math.abs(gainDb) < 0.01) return null;
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * f) / rate;
  const c = Math.cos(w);
  const a = Math.sin(w) / (2 * q);
  return norm(1 + a * A, -2 * c, 1 - a * A, 1 + a / A, -2 * c, 1 - a / A);
}

function shelf(rate: number, f: number, gainDb: number, high: boolean): Coeffs | null {
  if (Math.abs(gainDb) < 0.01) return null;
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * f) / rate;
  const c = Math.cos(w);
  const s = Math.sin(w);
  const a = (s / 2) * Math.sqrt(2);
  const k = 2 * Math.sqrt(A) * a;
  return high
    ? norm(A * (A + 1 + (A - 1) * c + k), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - k), A + 1 - (A - 1) * c + k, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - k)
    : norm(A * (A + 1 - (A - 1) * c + k), 2 * A * (A - 1 - (A + 1) * c), A * (A + 1 - (A - 1) * c - k), A + 1 + (A - 1) * c + k, -2 * (A - 1 + (A + 1) * c), A + 1 + (A - 1) * c - k);
}

/** |H(e^jw)| in dB of one biquad. */
function magnitudeDb(k: Coeffs, f: number, rate: number): number {
  const w = (2 * Math.PI * f) / rate;
  const cos1 = Math.cos(w);
  const cos2 = Math.cos(2 * w);
  const sin1 = Math.sin(w);
  const sin2 = Math.sin(2 * w);
  const nr = k.b0 + k.b1 * cos1 + k.b2 * cos2;
  const ni = -(k.b1 * sin1 + k.b2 * sin2);
  const dr = 1 + k.a1 * cos1 + k.a2 * cos2;
  const di = -(k.a1 * sin1 + k.a2 * sin2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** The EQ's six stages, as the engine builds them from its parameters. */
function eqStages(p: Record<string, number>, rate: number): Coeffs[] {
  const nyq = rate * 0.49;
  const f = (v: number | undefined, d: number) => Math.min(v ?? d, nyq);
  const out: Array<Coeffs | null> = [
    (p.lowCut ?? 0) >= 0.5 ? cut(rate, f(p.lowCutFreq, 80), true) : null,
    shelf(rate, f(p.lowFreq, 120), p.lowGain ?? 0, false),
    bell(rate, f(p.lowMidFreq, 400), p.lowMidGain ?? 0, p.lowMidQ ?? 1),
    bell(rate, f(p.highMidFreq, 2500), p.highMidGain ?? 0, p.highMidQ ?? 1),
    shelf(rate, f(p.highFreq, 8000), p.highGain ?? 0, true),
    (p.highCut ?? 0) >= 0.5 ? cut(rate, f(p.highCutFreq, 16000), false) : null,
  ];
  return out.filter((k): k is Coeffs => k !== null);
}

/** The EQ's response in dB at each frequency (Hz). */
export function eqResponse(params: Record<string, number>, freqs: readonly number[], rate = 48000): number[] {
  const stages = eqStages(params, rate);
  return freqs.map((f) => stages.reduce((sum, k) => sum + magnitudeDb(k, f, rate), 0));
}

/** Frequencies spread on a log scale from `lo` to `hi`, for drawing. */
export function logFreqs(n: number, lo = 20, hi = 20000): number[] {
  return Array.from({ length: n }, (_, i) => lo * Math.pow(hi / lo, i / (n - 1)));
}

/** The compressor's output level for an input level (dB), with its soft knee: as the engine computes it. */
export function compressorOut(params: Record<string, number>, inDb: number): number {
  const threshold = params.threshold ?? -18;
  const ratio = Math.max(1, params.ratio ?? 3);
  const knee = Math.max(0, params.knee ?? 6);
  const over = inDb - threshold;
  if (knee > 0 && 2 * Math.abs(over) <= knee) return inDb + ((1 / ratio - 1) * Math.pow(over + knee / 2, 2)) / (2 * knee);
  if (over > 0) return threshold + over / ratio;
  return inDb;
}
