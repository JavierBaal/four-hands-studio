/**
 * Volume and pan as people read them (H3.2): the window shows volume in dB, like the DAWs of the
 * niche; the AI keeps 0–100 (`set_mix`). Pan is C, L30 or R30 everywhere.
 *
 * Volume is CC7 (`round(volume × 127)`), and the General MIDI curve for CC7 is
 * 40 · log10(cc / 127) dB, so 0.8 (CC 102) is −3.8 dB and 1 is 0 dB. Values above 0 dB do not exist.
 */
import { type Song, type Track, busList, processingOrder } from "@fourhands/core";
import type { Lang } from "./i18n.js";

/** Lowest dB that still means a sound (CC7 = 1). Below it, silence. */
export const MIN_DB = 40 * Math.log10(1 / 127);

export function volumeToDb(volume: number): number {
  const cc = Math.round(Math.max(0, Math.min(1, volume)) * 127);
  return cc === 0 ? -Infinity : 40 * Math.log10(cc / 127);
}

export function dbToVolume(db: number): number {
  // Half a CC step of slack under the lowest value, so a shown "−84,2" reads back as CC7 = 1.
  if (!Number.isFinite(db) || db < MIN_DB - 0.5) return 0;
  return Math.max(1 / 127, Math.min(1, Math.pow(10, Math.min(0, db) / 40)));
}

function decimal(value: number, lang: Lang): string {
  const text = value.toFixed(1);
  return lang === "es" ? text.replace(".", ",") : text;
}

/** "−3,8" (es) or "−3.8" (en), with a true minus sign; "−∞" for silence; "0,0" at the top. */
export function formatDb(volume: number, lang: Lang): string {
  const db = volumeToDb(volume);
  if (db === -Infinity) return "−∞";
  const text = decimal(Math.abs(db), lang);
  return db < -0.05 ? `−${text}` : text;
}

/**
 * Reads a typed volume in dB: "-6", "−6", "-6,5", "-6.5 dB", "0", "-inf", "−∞". Positive values
 * are taken as negative (nobody means +6 dB here, and it does not exist). Null if unreadable.
 */
export function parseDb(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/db$/, "").trim().replace("−", "-").replace(",", ".");
  if (t === "-inf" || t === "-∞" || t === "inf" || t === "∞") return 0;
  if (!/^[-+]?\d+(\.\d+)?$|^[-+]?\.\d+$/.test(t)) return null;
  const db = -Math.abs(Number(t));
  return Number.isFinite(db) ? dbToVolume(db) : null;
}

/** "C", "L30", "R25" (pan −1…1 → percent). */
export function formatPan(pan: number): string {
  const p = Math.round(pan * 100);
  return p === 0 ? "C" : p < 0 ? `L${-p}` : `R${p}`;
}

/** Reads "C", "L30", "R 25", "I30" / "D30" (Spanish), "-30", "30". Null if unreadable. */
export function parsePan(text: string): number | null {
  const t = text.trim().toUpperCase().replace("−", "-").replace(/\s+/g, "");
  if (t === "C" || t === "0") return 0;
  const m = /^([LRID])?(-?\d+)$/.exec(t);
  if (!m) return null;
  let p = Number(m[2]);
  if (m[1] === "L" || m[1] === "I") p = -Math.abs(p);
  else if (m[1] === "R" || m[1] === "D") p = Math.abs(p);
  if (!Number.isFinite(p)) return null;
  return Math.max(-100, Math.min(100, p)) / 100;
}

/** Reverb send as people read it (H4): 0 to 100, "0" being dry. */
export function formatReverb(reverb: number): string {
  return String(Math.round(Math.max(0, Math.min(1, reverb)) * 100));
}

/** Reads "30", "30 %", "0". Null if unreadable; clamped to 0–100. */
export function parseReverb(text: string): number | null {
  const t = text.trim().replace(/\s*%$/, "");
  if (!/^\d{1,3}([.,]\d+)?$/.test(t)) return null;
  const v = Math.round(Number(t.replace(",", ".")));
  return Math.max(0, Math.min(100, v)) / 100;
}

/**
 * F2.2 (03/11/2026): the engine's strip for a track: its fader as audio, with the dB the window
 * shows (the same curve as CC7, so nothing jumps). Plugins get no CC7, CC10 or CC91; a plugin's
 * balance is the strip's. Parte D (04/11/2026): the built-in sounds' volume is the strip's too (their
 * synth gets CC7 at 127, so a send before the fader works for them as well); their pan stays CC10
 * in the synth, per voice, as always. What a track sends to buses goes in the routing.
 */
export interface EngineStrip {
  /** The strip (A2: the track's, from shared/strips.ts). */
  ch: number;
  gain: number;
  pan: number;
  /**
   * F2.2 part B: false when the track is muted, or a solo elsewhere leaves it out. The engine
   * silences the strip after its sound, so a plugin's own tail and its sends stop at once. Absent: on.
   */
  on?: boolean;
  /** Whose strip it is: the main process keeps the map for the levels and the plugins' state. */
  track?: string;
}

export function stripGain(volume: number): number {
  const db = volumeToDb(volume);
  return db === -Infinity ? 0 : Math.pow(10, db / 20);
}

type StripTrack = { id?: string; channel: number; strip?: number; output?: string | undefined; volume: number; pan: number; mute?: boolean; solo?: boolean };

/**
 * Every track's strip (neutral for the outside tracks), and `reset` strips back to neutral (they
 * belonged to tracks that are gone, or to the metronome). `audible`: who sounds with buses in the
 * song (core `audible`, Studio One's solo); without it, solo wins over mute among the tracks.
 */
export function engineStrips(tracks: ReadonlyArray<StripTrack>, reset: Iterable<number> = [], audible?: ReadonlySet<string>): EngineStrip[] {
  const out = new Map<number, EngineStrip>();
  for (const ch of reset) out.set(ch, { ch, gain: 1, pan: 0 });
  const anySolo = tracks.some((t) => t.solo);
  for (const t of tracks) {
    const ch = t.strip ?? t.channel;
    const strip: EngineStrip = t.output === "external" ? { ch, gain: 1, pan: 0 } : { ch, gain: stripGain(t.volume), pan: t.output === "plugin" ? t.pan : 0 };
    const on = audible && t.id !== undefined ? audible.has(t.id) : anySolo ? !!t.solo : !t.mute;
    if (!on) strip.on = false;
    if (t.id !== undefined) strip.track = t.id;
    out.set(ch, strip);
  }
  return [...out.values()];
}

/** A bus's fader, balance and on/off, as the engine gets it (F2.2 part D). */
export interface EngineBusMix {
  bus: number;
  gain: number;
  pan: number;
  on?: boolean;
  /** Whose it is, for the main process (levels for the AI). */
  id?: string;
}

export function engineBuses(song: Song, busIndex: (id: string) => number, audible: ReadonlySet<string>): EngineBusMix[] {
  return busList(song).map((b) => {
    const mix: EngineBusMix = { bus: busIndex(b.id), gain: stripGain(b.volume), pan: b.pan, id: b.id };
    if (!audible.has(b.id)) mix.on = false;
    return mix;
  });
}

/** The `strip` of a bus's chain for `engineInserts` (-1 is the Master): -2 - n. */
export function busChainKey(index: number): number {
  return -2 - index;
}

/** Where a strip or bus goes, as the engine gets it: `out` -1 is the master. */
export interface EngineRoute {
  out: number;
  sends: Array<{ bus: number; level: number; pre: boolean }>;
}

export interface EngineRouting {
  strips: Array<EngineRoute & { ch: number }>;
  buses: Array<EngineRoute & { bus: number }>;
  /** The buses in processing order: each after every bus that feeds it. */
  order: number[];
  /**
   * The bus that gets what a built-in instrument sends to reverb by itself (its SoundFont's
   * setting). Always -1 (04/11/2026): that reverb is part of the sound and stays in the
   * engine, as before part D, whatever buses the song has.
   */
  instrumentReverb: number;
}

/**
 * The song's routing for the engine (F2.2 part D): every track's and bus's output and sends.
 * Outside tracks do not sound in the engine and are left out.
 */
export function engineRouting(song: Song, stripOf: (track: Track) => number, busIndex: (id: string) => number): EngineRouting {
  const route = (c: { bus?: string | undefined; sends?: ReadonlyArray<{ bus: string; level: number; pre?: boolean | undefined }> | undefined }): EngineRoute => ({
    out: c.bus && song.buses?.[c.bus] ? busIndex(c.bus) : -1,
    sends: (c.sends ?? []).filter((x) => song.buses?.[x.bus]).map((x) => ({ bus: busIndex(x.bus), level: x.level, pre: !!x.pre })),
  });
  const strips: EngineRouting["strips"] = [];
  for (const id of song.trackOrder) {
    const t = song.tracks[id];
    if (!t || t.output === "external") continue;
    const r = route(t);
    if (r.out >= 0 || r.sends.length) strips.push({ ch: stripOf(t), ...r });
  }
  const buses = busList(song).map((b) => ({ bus: busIndex(b.id), ...route(b) }));
  return { strips, buses, order: processingOrder(song).map(busIndex), instrumentReverb: -1 };
}

/** What the engine measured on each strip (linear), as `levels` gives it. */
export interface EngineLevels {
  channels: Array<{ peak: number; rms: number; clips: number }>;
  master: { peak: number; rms: number; clips: number };
  /** Parte D: each bus, by its engine index. */
  buses?: Array<{ peak: number; rms: number; clips: number }>;
}

/** dB, one decimal; −∞ for silence. */
export function levelDb(linear: number): number {
  return linear > 0 ? Math.round(200 * Math.log10(linear)) / 10 : -Infinity;
}

/** The levels of the song's tracks and the master, in dB, for the log (and the AI's reading). */
export function levelsReport(
  levels: EngineLevels,
  tracks: ReadonlyArray<{ name: string; channel: number; strip?: number | undefined }>,
  buses: ReadonlyArray<{ name: string; index: number }> = [],
) {
  const report: {
    master: { peakDb: number; rmsDb: number; clips: number };
    tracks: Array<{ track: string; strip: number; peakDb: number; rmsDb: number; clips: number }>;
    buses?: Array<{ bus: string; peakDb: number; rmsDb: number; clips: number }>;
  } = {
    master: { peakDb: levelDb(levels.master.peak), rmsDb: levelDb(levels.master.rms), clips: levels.master.clips },
    tracks: tracks.map((t) => {
      const strip = t.strip ?? t.channel;
      const c = levels.channels[strip] ?? { peak: 0, rms: 0, clips: 0 };
      return { track: t.name, strip, peakDb: levelDb(c.peak), rmsDb: levelDb(c.rms), clips: c.clips };
    }),
  };
  if (buses.length)
    report.buses = buses.map((b) => {
      const c = levels.buses?.[b.index] ?? { peak: 0, rms: 0, clips: 0 };
      return { bus: b.name, peakDb: levelDb(c.peak), rmsDb: levelDb(c.rms), clips: c.clips };
    });
  return report;
}

/** The master fader's gain (F2.2 part B): the song's `masterVolume`, same curve as a track. */
export function masterGain(masterVolume: number | undefined): number {
  return stripGain(masterVolume ?? 1);
}

/** What the engine says about its load (F2.2 part B, the «Carga» indicator). */
export interface EngineLoad {
  /** Average share of each block's budget used since the last reading (0–1). */
  avgLoad: number;
  maxLoad: number;
  /** Times the audio was cut since the last reading (blocks over budget, or the driver's count). */
  dropouts: number;
  /** Where the time went (09/11/2026), if the engine says: blocks, budget and ms per strip and stage. */
  cost?: EngineCost;
}

/** ms summed over `blocks` blocks and the worst block, per strip and per stage of the engine. */
export interface EngineCost {
  blocks: number;
  budgetMs: number;
  overruns: number;
  strips: Record<number, { sum: number; max: number }>;
  stages: Record<"wait" | "sounds" | "mix" | "analysis", { sum: number; max: number }>;
  /** Notes that reached the engine after their time (they play at once, out of time). */
  late: number;
  /** Blocks the device asked for over twice the budget late, and the longest time between two (ms). */
  gaps: number;
  gapMax: number;
  /** The longest the engine's message thread (plugin windows, the link) was busy, in ms. */
  messageStall: number;
}

const STAGES = ["wait", "sounds", "mix", "analysis"] as const;

/** From the engine's `stats` reply. */
export function engineLoad(stats: Record<string, unknown>): EngineLoad {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const load: EngineLoad = {
    avgLoad: Math.max(0, num(stats.avgLoad)),
    maxLoad: Math.max(0, num(stats.maxLoad)),
    // The driver's count and ours often see the same cut: take the larger, not the sum.
    dropouts: Math.max(0, num(stats.overruns), num(stats.xruns)),
  };
  if (Array.isArray(stats.strips) && num(stats.blocks) > 0) {
    const pair = (v: unknown) => (Array.isArray(v) ? { sum: num(v[0]), max: num(v[1]) } : { sum: 0, max: 0 });
    const cost: EngineCost = {
      blocks: num(stats.blocks),
      budgetMs: num(stats.budgetMs),
      overruns: num(stats.overruns),
      strips: {},
      stages: { wait: pair(stats.wait), sounds: pair(stats.sounds), mix: pair(stats.mix), analysis: pair(stats.analysis) },
      late: num(stats.late),
      gaps: num(stats.gaps),
      gapMax: num(stats.gapMax),
      messageStall: num(stats.messageStall),
    };
    for (const row of stats.strips as unknown[]) if (Array.isArray(row)) cost.strips[num(row[0])] = { sum: num(row[1]), max: num(row[2]) };
    load.cost = cost;
  }
  return load;
}

/** Adds a reading to what a playback has cost so far. */
export function addCost(total: EngineCost | null, next: EngineCost): EngineCost {
  if (!total) return structuredClone(next);
  const add = (a: { sum: number; max: number } | undefined, b: { sum: number; max: number }) => ({ sum: (a?.sum ?? 0) + b.sum, max: Math.max(a?.max ?? 0, b.max) });
  for (const [k, v] of Object.entries(next.strips)) total.strips[Number(k)] = add(total.strips[Number(k)], v);
  for (const k of STAGES) total.stages[k] = add(total.stages[k], next.stages[k]);
  total.blocks += next.blocks;
  total.overruns += next.overruns;
  total.late += next.late;
  total.gaps += next.gaps;
  total.gapMax = Math.max(total.gapMax, next.gapMax);
  total.messageStall = Math.max(total.messageStall, next.messageStall);
  total.budgetMs = next.budgetMs || total.budgetMs;
  return total;
}

/**
 * What a playback cost, for the log: the average share of the budget, then per track (and the
 * engine's stages) the average and the worst block, as shares of one block's budget (1 = all of it).
 */
export function costReport(cost: EngineCost, tracks: ReadonlyArray<{ name: string; strip: number }>) {
  const share = (ms: number) => Math.round((ms / Math.max(1e-9, cost.budgetMs)) * 1000) / 1000;
  const avg = (v: { sum: number }) => share(v.sum / Math.max(1, cost.blocks));
  const total = Object.values(cost.strips).reduce((s, v) => s + v.sum, 0) + STAGES.reduce((s, k) => s + cost.stages[k].sum, 0);
  const byStrip = new Map(tracks.map((t) => [t.strip, t.name]));
  return {
    blocks: cost.blocks,
    budgetMs: Math.round(cost.budgetMs * 100) / 100,
    overruns: cost.overruns,
    late: cost.late,
    gaps: cost.gaps,
    gapMaxMs: Math.round(cost.gapMax * 10) / 10,
    messageStallMs: Math.round(cost.messageStall),
    avgLoad: share(total / Math.max(1, cost.blocks)),
    tracks: Object.entries(cost.strips)
      .map(([k, v]) => ({ track: byStrip.get(Number(k)) ?? `strip ${k}`, avg: avg(v), max: share(v.max) }))
      .sort((a, b) => b.avg - a.avg),
    stages: Object.fromEntries(STAGES.map((k) => [k, { avg: avg(cost.stages[k]), max: share(cost.stages[k].max) }])),
  };
}

/** F2.2 part C: one link of a chain as the engine gets it. */
export interface EngineInsert {
  id: string;
  kind: string;
  /** The plugin's engine id, for a plugin effect. */
  plugin?: string;
  bypass: boolean;
  params: Record<string, number>;
}

/** A song's chain, as the engine gets it. */
export function engineChain(inserts: ReadonlyArray<{ id: string; kind: string; bypass?: boolean; params?: Record<string, number>; plugin?: { id: string } }>): EngineInsert[] {
  return inserts.map((x) => {
    const link: EngineInsert = { id: x.id, kind: x.kind, bypass: !!x.bypass, params: { ...(x.params ?? {}) } };
    if (x.plugin) link.plugin = x.plugin.id;
    return link;
  });
}
