/**
 * Insert effects (F2.2 part C, 03/11/2026): a chain on each track, after its sound and before
 * its fader, and one on the Master, before its fader.
 *
 * Four Hands' own effects (EQ, compressor, limiter) keep every parameter in the song, readable and
 * undoable. A plugin (VST3) keeps only which plugin it is here; what it has inside is a closed state
 * kept with the song by the app, like an instrument's (F2.1). The engine only makes the sound.
 */
import { CommandError, type Transaction } from "./document.js";
import type { Insert, InsertKind, Song, TrackPlugin } from "./model.js";

/** A wrong effect command: the AI and the window get the message, nothing is written. */
export class EffectError extends CommandError {}

function check(ok: boolean, message: string): asserts ok {
  if (!ok) throw new EffectError(message);
}

export type ParamUnit = "Hz" | "dB" | "ms" | ":1" | "Q" | "on" | "%" | "note";

/** One parameter of an own effect: its id, the name people read, its range and unit. */
export interface ParamDef {
  id: string;
  /** "Low cut", "Threshold". */
  name: string;
  unit: ParamUnit;
  min: number;
  max: number;
  default: number;
  /** Frequencies, Q and times move on a log scale (for faders and for the AI's reading). */
  log?: boolean;
}

const hz = (id: string, name: string, min: number, max: number, d: number): ParamDef => ({ id, name, unit: "Hz", min, max, default: d, log: true });
const db = (id: string, name: string, min: number, max: number, d: number): ParamDef => ({ id, name, unit: "dB", min, max, default: d });
const ms = (id: string, name: string, min: number, max: number, d: number): ParamDef => ({ id, name, unit: "ms", min, max, default: d, log: true });
const on = (id: string, name: string, d: 0 | 1): ParamDef => ({ id, name, unit: "on", min: 0, max: 1, default: d });
/**
 * The delay's note values (F2.2, 04/11/2026), shortest first: `beats` in quarter notes. The song's
 * tempo turns them into time (the engine knows it from the transport).
 */
export const NOTE_VALUES: ReadonlyArray<{ id: string; beats: number; es: string; en: string }> = [
  { id: "1/32", beats: 0.125, es: "Fusa", en: "1/32" },
  { id: "1/16T", beats: 1 / 6, es: "Tresillo de semicorchea", en: "1/16 triplet" },
  { id: "1/16", beats: 0.25, es: "Semicorchea", en: "1/16" },
  { id: "1/16D", beats: 0.375, es: "Semicorchea con puntillo", en: "1/16 dotted" },
  { id: "1/8T", beats: 1 / 3, es: "Tresillo de corchea", en: "1/8 triplet" },
  { id: "1/8", beats: 0.5, es: "Corchea", en: "1/8" },
  { id: "1/8D", beats: 0.75, es: "Corchea con puntillo", en: "1/8 dotted" },
  { id: "1/4T", beats: 2 / 3, es: "Tresillo de negra", en: "1/4 triplet" },
  { id: "1/4", beats: 1, es: "Negra", en: "1/4" },
  { id: "1/4D", beats: 1.5, es: "Negra con puntillo", en: "1/4 dotted" },
  { id: "1/2", beats: 2, es: "Blanca", en: "1/2" },
  { id: "1/2D", beats: 3, es: "Blanca con puntillo", en: "1/2 dotted" },
  { id: "1/1", beats: 4, es: "Redonda", en: "1/1" },
];

const pct = (id: string, name: string, d: number): ParamDef => ({ id, name, unit: "%", min: 0, max: 100, default: d });
const q = (id: string, name: string, d: number): ParamDef => ({ id, name, unit: "Q", min: 0.3, max: 10, default: d, log: true });

/** The own effects (docs/audio-engine.md, decisión 10): simple, and enough without paid plugins. */
export const OWN_EFFECTS: Record<Exclude<InsertKind, "plugin">, { name: { es: string; en: string }; params: ParamDef[] }> = {
  eq: {
    name: { es: "EQ", en: "EQ" },
    // Four bands (low shelf, two bells, high shelf) and the two cuts, all flat by default.
    params: [
      on("lowCut", "Low cut", 0),
      hz("lowCutFreq", "Low cut freq", 20, 1000, 80),
      hz("lowFreq", "Low shelf freq", 30, 1000, 120),
      db("lowGain", "Low shelf gain", -18, 18, 0),
      hz("lowMidFreq", "Low-mid freq", 80, 5000, 400),
      db("lowMidGain", "Low-mid gain", -18, 18, 0),
      q("lowMidQ", "Low-mid Q", 1),
      hz("highMidFreq", "High-mid freq", 400, 16000, 2500),
      db("highMidGain", "High-mid gain", -18, 18, 0),
      q("highMidQ", "High-mid Q", 1),
      hz("highFreq", "High shelf freq", 1500, 18000, 8000),
      db("highGain", "High shelf gain", -18, 18, 0),
      on("highCut", "High cut", 0),
      hz("highCutFreq", "High cut freq", 2000, 20000, 16000),
    ],
  },
  compressor: {
    name: { es: "Compresor", en: "Compressor" },
    params: [
      db("threshold", "Threshold", -60, 0, -18),
      { id: "ratio", name: "Ratio", unit: ":1", min: 1, max: 20, default: 3, log: true },
      ms("attack", "Attack", 0.1, 100, 10),
      ms("release", "Release", 10, 1000, 120),
      db("knee", "Knee", 0, 12, 6),
      db("makeup", "Makeup gain", 0, 24, 0),
    ],
  },
  limiter: {
    name: { es: "Limitador", en: "Limiter" },
    // A short look-ahead (5 ms, fixed): the engine compensates it on the other tracks.
    params: [db("gain", "Input gain", 0, 24, 0), db("ceiling", "Ceiling", -12, 0, -1), ms("release", "Release", 1, 500, 50)],
  },
  reverb: {
    name: { es: "Reverb", en: "Reverb" },
    // F2.2 part D (04/11/2026): the GS reverb the built-in sounds had, now an effect like the
    // others. Its defaults are that reverb exactly, all wet: it sits on the «Reverb» bus.
    params: [
      pct("mix", "Mix", 100),
      pct("time", "Time", 50),
      pct("tone", "Tone", 100),
      { id: "preDelay", name: "Pre-delay", unit: "ms", min: 0, max: 200, default: 0 },
    ],
  },
  delay: {
    name: { es: "Delay", en: "Delay" },
    // 04/11/2026: an own delay, the reverb's partner on a send bus. Its repeats follow the
    // song's tempo (a note value) or a time in ms; the cuts darken the repeats, as a tape does.
    params: [
      on("sync", "Sync", 1),
      { id: "note", name: "Note", unit: "note", min: 0, max: NOTE_VALUES.length - 1, default: NOTE_VALUES.findIndex((n) => n.id === "1/4") },
      { id: "time", name: "Time", unit: "ms", min: 1, max: 2000, default: 375, log: true },
      // Below 100 %: the repeats always die out.
      { id: "feedback", name: "Feedback", unit: "%", min: 0, max: 95, default: 35 },
      pct("mix", "Mix", 100),
      hz("lowCut", "Low cut", 20, 2000, 150),
      hz("highCut", "High cut", 1000, 20000, 6000),
      on("pingPong", "Ping-pong", 0),
    ],
  },
};

export const OWN_KINDS = Object.keys(OWN_EFFECTS) as Array<Exclude<InsertKind, "plugin">>;

/** Effects per chain, at most: the limit is the machine, this only stops a runaway loop. */
export const MAX_INSERTS = 64;

export function paramDefs(kind: InsertKind): ParamDef[] {
  return kind === "plugin" ? [] : OWN_EFFECTS[kind].params;
}

export function defaultParams(kind: InsertKind): Record<string, number> {
  return Object.fromEntries(paramDefs(kind).map((p) => [p.id, p.default]));
}

/** A parameter's value as people read it: "80 Hz", "2,5 kHz", "−6,0 dB", "3:1", "10 ms", "on". */
export function paramText(def: ParamDef, value: number, lang: "es" | "en" = "en"): string {
  const dec = (v: number, digits: number) => {
    const t = v.toFixed(digits);
    return lang === "es" ? t.replace(".", ",") : t;
  };
  switch (def.unit) {
    case "Hz":
      return value >= 1000 ? `${dec(value / 1000, value >= 10000 ? 1 : 2).replace(/[.,]?0+$/, "")} kHz` : `${Math.round(value)} Hz`;
    case "dB": {
      const t = dec(Math.abs(value), 1);
      return `${value < -0.05 ? "−" : value > 0.05 ? "+" : ""}${t} dB`;
    }
    case "ms":
      return `${value < 10 ? dec(value, 1) : Math.round(value)} ms`;
    case ":1":
      return `${dec(value, value < 10 ? 1 : 0).replace(/[.,]0$/, "")}:1`;
    case "Q":
      return dec(value, 2);
    case "on":
      return value >= 0.5 ? "on" : "off";
    case "%":
      return `${Math.round(value)} %`;
    case "note": {
      const n = NOTE_VALUES[Math.max(0, Math.min(NOTE_VALUES.length - 1, Math.round(value)))]!;
      return lang === "es" ? n.es : n.en;
    }
  }
}

/** Where a chain is: a track or a bus (its id), or the Master. */
export type ChainTarget = string | "master";

export function chainOf(song: Song, target: ChainTarget): Insert[] {
  if (target === "master") return song.masterInserts ?? [];
  if (/^b\d+$/.test(target)) {
    const bus = song.buses?.[target];
    check(!!bus, `Unknown bus: ${target}`);
    return bus.inserts ?? [];
  }
  const track = song.tracks[target];
  check(!!track, `Unknown track: ${target}`);
  return track.inserts ?? [];
}

function writeChain(tx: Transaction, target: ChainTarget, chain: Insert[]): void {
  const path = target === "master" ? ["masterInserts"] : /^b\d+$/.test(target) ? ["buses", target, "inserts"] : ["tracks", target, "inserts"];
  if (chain.length === 0) {
    if (chainOf(tx.song, target).length > 0) tx.remove(path);
  } else tx.set(path, chain);
}

/** The effect with that id, and where it is. */
export function findInsert(song: Song, id: string): { target: ChainTarget; index: number; insert: Insert } | null {
  const chains: Array<[ChainTarget, Insert[]]> = [
    ["master", song.masterInserts ?? []],
    ...song.trackOrder.map((t): [ChainTarget, Insert[]] => [t, song.tracks[t]?.inserts ?? []]),
    ...(song.busOrder ?? []).map((b): [ChainTarget, Insert[]] => [b, song.buses?.[b]?.inserts ?? []]),
  ];
  for (const [target, chain] of chains) {
    const index = chain.findIndex((x) => x.id === id);
    if (index >= 0) return { target, index, insert: chain[index]! };
  }
  return null;
}

export type InsertSpec = { kind: Exclude<InsertKind, "plugin">; params?: Record<string, number> } | { kind: "plugin"; plugin: TrackPlugin };

/** Adds an effect to a chain at `index` (the end if left out). Returns its id. */
export function addInsert(tx: Transaction, target: ChainTarget, spec: InsertSpec, index?: number): string {
  const chain = [...chainOf(tx.song, target)];
  check(chain.length < MAX_INSERTS, `A chain holds at most ${MAX_INSERTS} effects`);
  const id = tx.nextId("x");
  let insert: Insert;
  if (spec.kind === "plugin") {
    check(!!spec.plugin?.id && !!spec.plugin?.name, "A plugin effect needs the plugin");
    insert = { id, kind: "plugin", plugin: { id: spec.plugin.id, name: spec.plugin.name } };
  } else {
    check(spec.kind in OWN_EFFECTS, `Unknown effect: ${String(spec.kind)}`);
    insert = { id, kind: spec.kind, params: { ...defaultParams(spec.kind), ...cleanParams(spec.kind, spec.params ?? {}) } };
  }
  const at = index === undefined ? chain.length : Math.max(0, Math.min(chain.length, Math.round(index)));
  chain.splice(at, 0, insert);
  writeChain(tx, target, chain);
  return id;
}

export function removeInsert(tx: Transaction, id: string): void {
  const found = findInsert(tx.song, id);
  check(!!found, `Unknown effect: ${id}`);
  writeChain(tx, found.target, chainOf(tx.song, found.target).filter((x) => x.id !== id));
}

/** Moves an effect inside its chain, or to another chain (`target`). */
export function moveInsert(tx: Transaction, id: string, index: number, target?: ChainTarget): void {
  const found = findInsert(tx.song, id);
  check(!!found, `Unknown effect: ${id}`);
  const to = target ?? found.target;
  if (to === found.target) {
    const chain = chainOf(tx.song, to).filter((x) => x.id !== id);
    chain.splice(Math.max(0, Math.min(chain.length, Math.round(index))), 0, found.insert);
    if (chain.map((x) => x.id).join() !== chainOf(tx.song, to).map((x) => x.id).join()) writeChain(tx, to, chain);
    return;
  }
  const dest = [...chainOf(tx.song, to)];
  check(dest.length < MAX_INSERTS, `A chain holds at most ${MAX_INSERTS} effects`);
  writeChain(tx, found.target, chainOf(tx.song, found.target).filter((x) => x.id !== id));
  dest.splice(Math.max(0, Math.min(dest.length, Math.round(index))), 0, found.insert);
  writeChain(tx, to, dest);
}

function cleanParams(kind: InsertKind, params: Record<string, number>): Record<string, number> {
  const defs = paramDefs(kind);
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(params)) {
    const def = defs.find((d) => d.id === key);
    check(!!def, `The ${kind} has no parameter '${key}'`);
    check(Number.isFinite(value), `Invalid value for ${def.name}: ${value}`);
    out[key] = def.unit === "on" ? (value >= 0.5 ? 1 : 0) : Math.max(def.min, Math.min(def.max, value));
  }
  return out;
}

/** A name the user gives an effect: at most this long. */
export const EFFECT_NAME_MAX = 60;

export interface InsertChanges {
  bypass?: boolean;
  /** The user's own name; "" goes back to the effect's name. */
  name?: string;
  /** Own effects only: the parameters that change (clamped to their range). */
  params?: Record<string, number>;
  /**
   * Plugin effects only: parameters the AI set, by index, normalised, with the value each had
   * before (kept only the first time, so undoing it all goes back to the plugin as it was).
   */
  pluginParams?: Record<string, { value: number; base: number }>;
}

export function updateInsert(tx: Transaction, id: string, changes: InsertChanges): void {
  const found = findInsert(tx.song, id);
  check(!!found, `Unknown effect: ${id}`);
  const next: Insert = { ...found.insert };
  if (changes.name !== undefined) {
    const name = changes.name.trim();
    check(name.length <= EFFECT_NAME_MAX, `An effect's name has at most ${EFFECT_NAME_MAX} characters`);
    if (name && name !== kindName(next)) next.name = name;
    else delete next.name;
  }
  if (changes.bypass !== undefined) {
    if (changes.bypass) next.bypass = true;
    else delete next.bypass;
  }
  if (changes.params && Object.keys(changes.params).length) {
    check(next.kind !== "plugin", "A plugin's parameters are read and set through the engine, not stored in the song");
    next.params = { ...(next.params ?? defaultParams(next.kind)), ...cleanParams(next.kind, changes.params) };
  }
  if (changes.pluginParams && Object.keys(changes.pluginParams).length) {
    check(next.kind === "plugin", "Only a plugin effect has plugin parameters");
    const values = { ...(next.pluginParams ?? {}) };
    const base = { ...(next.pluginBase ?? {}) };
    for (const [key, { value, base: was }] of Object.entries(changes.pluginParams)) {
      check(/^\d+$/.test(key), `Invalid parameter index: ${key}`);
      check(Number.isFinite(value) && Number.isFinite(was), `Invalid value for parameter ${key}`);
      values[key] = Math.max(0, Math.min(1, value));
      if (!(key in base)) base[key] = Math.max(0, Math.min(1, was));
    }
    next.pluginParams = values;
    next.pluginBase = base;
  }
  if (JSON.stringify(next) === JSON.stringify(found.insert)) return;
  const chain = [...chainOf(tx.song, found.target)];
  chain[found.index] = next;
  writeChain(tx, found.target, chain);
}

/** What it is: "EQ", "Compresor", or the plugin's name. */
export function kindName(insert: Pick<Insert, "kind" | "plugin">, lang: "es" | "en" = "en"): string {
  return insert.kind === "plugin" ? (insert.plugin?.name ?? "Plugin") : OWN_EFFECTS[insert.kind].name[lang];
}

/** What people call it: the user's name if it has one ("EQ graves"), else what it is. */
export function insertName(insert: Insert, lang: "es" | "en" = "en"): string {
  return insert.name ?? kindName(insert, lang);
}

/** Every effect id in the song, for the file's counters. */
export function allInsertIds(song: Song): string[] {
  return allInserts(song).map((x) => x.id);
}

/** Every effect in the song: the Master's, the tracks' and the buses'. */
export function allInserts(song: Song): Insert[] {
  return [...(song.masterInserts ?? []), ...Object.values(song.tracks).flatMap((t) => t.inserts ?? []), ...Object.values(song.buses ?? {}).flatMap((b) => b.inserts ?? [])];
}

/** A parameter's place on a fader, 0–1 (log for frequencies, Q and times), and back. */
export function paramToUnit(def: ParamDef, value: number): number {
  const v = Math.max(def.min, Math.min(def.max, value));
  if (def.log && def.min > 0) return Math.log(v / def.min) / Math.log(def.max / def.min);
  return (v - def.min) / (def.max - def.min);
}

export function unitToParam(def: ParamDef, unit: number): number {
  const u = Math.max(0, Math.min(1, unit));
  const v = def.log && def.min > 0 ? def.min * Math.pow(def.max / def.min, u) : def.min + u * (def.max - def.min);
  // Readable steps: whole Hz under 1 kHz, tenths of dB, ms and ratios with one decimal.
  if (def.unit === "on") return u >= 0.5 ? 1 : 0;
  if (def.unit === "Hz") return v < 1000 ? Math.round(v) : Math.round(v / 10) * 10;
  if (def.unit === "Q") return Math.round(v * 100) / 100;
  if (def.unit === "%" || def.unit === "note") return Math.round(v);
  return Math.round(v * 10) / 10;
}

/**
 * A value people type: "-24", "-24 dB", "2,5 kHz", "4:1", "5 ms", "on". Null if it cannot be read
 * or is out of range (the field stays open and says the range).
 */
export function parseParamValue(def: ParamDef, text: string): number | null {
  const t = text.trim().toLowerCase().replace("−", "-").replace(",", ".");
  if (def.unit === "note") return parseNote(t);
  if (def.unit === "on") {
    if (["on", "si", "sí", "1", "true"].includes(t)) return 1;
    if (["off", "no", "0", "false"].includes(t)) return 0;
    return null;
  }
  const m = /^([-+]?\d+(?:\.\d+)?)\s*(khz|hz|db|ms|s|:1|q|%)?$/.exec(t);
  if (!m) return null;
  let v = Number(m[1]);
  if (m[2] === "khz" || (def.unit === "Hz" && !m[2] && v > 0 && v < 20 && def.min >= 20)) v *= 1000;
  if (m[2] === "s" && def.unit === "ms") v *= 1000;
  if (!Number.isFinite(v) || v < def.min - 1e-9 || v > def.max + 1e-9) return null;
  return v;
}

/**
 * A note value as people write it: "1/8", "1/8 dotted", "1/8d", "1/8.", "1/4 triplet", "1/4t", or
 * its Spanish name ("corchea con puntillo", "negra"). Its index in NOTE_VALUES, or null.
 */
function parseNote(text: string): number | null {
  const t = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  const byName = NOTE_VALUES.findIndex((n) => n.es.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === t || n.en.toLowerCase() === t || n.id.toLowerCase() === t);
  if (byName >= 0) return byName;
  const m = /^1\/(\d+)\s*(\.|d|dotted|punt\.?|puntillo|t|triplet|tres\.?|tresillo)?$/.exec(t);
  if (!m) return null;
  const suffix = !m[2] ? "" : /^(t|triplet|tres)/.test(m[2]) ? "T" : "D";
  const i = NOTE_VALUES.findIndex((n) => n.id === `1/${m[1]}${suffix}`);
  return i >= 0 ? i : null;
}
