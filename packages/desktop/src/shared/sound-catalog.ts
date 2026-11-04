/**
 * The catalog of sounds behind the Sonidos browser (ESTUDIO_INTERFAZ_2.md, 5.3): Four Hands's
 * own sounds, the banks the user installed and the plugins the engine found, as one list with an
 * origin and a category each. Pure: the window builds it, filters it and groups it.
 */
import type { EnginePlugin } from "./engine.js";
import type { Lang } from "./i18n.js";
import { PALETTE, type PaletteItem, paletteName } from "./instruments.js";
import type { BankPreset } from "./soundbank-info.js";

export const CATEGORIES = ["keys", "strings", "winds", "brass", "perc", "synths", "samplers", "ideas", "other"] as const;
export type SoundCategory = (typeof CATEGORIES)[number];

export const CATEGORY_NAMES: Record<SoundCategory, [es: string, en: string]> = {
  keys: ["Teclados", "Keyboards"],
  strings: ["Cuerdas", "Strings"],
  winds: ["Viento y voces", "Winds and voices"],
  brass: ["Metales", "Brass"],
  perc: ["Percusión", "Percussion"],
  synths: ["Sintes", "Synths"],
  samplers: ["Muestreadores", "Samplers"],
  ideas: ["Generadores de ideas", "Idea generators"],
  other: ["Otros", "Others"],
};

export type SoundOrigin = "builtin" | "bank" | "plugin";

/** What choosing it does: a sound of the default bank, a preset of a bank, or a plugin. */
export type SoundTarget =
  | { kind: "default"; item: PaletteItem }
  | { kind: "bank"; bankId: string; bankName: string; preset: BankPreset }
  | { kind: "plugin"; plugin: EnginePlugin };

export interface SoundItem {
  /** Stable across sessions: favourites, recents and moved categories are keyed by it. */
  key: string;
  name: string;
  /** "de serie", the bank's name, or the plugin's vendor. */
  source: string;
  origin: SoundOrigin;
  category: SoundCategory;
  target: SoundTarget;
}

/** The user's own marks on the catalog (kept in ajustes.json). */
export interface SoundPrefs {
  favorites: string[];
  /** Most recent first, at most RECENT_MAX. */
  recents: string[];
  /** Plugin keys the user hid (Ajustes › Plugins can bring them back). */
  hidden: string[];
  /** Categories the user moved a sound to. */
  categories: Record<string, SoundCategory>;
}

export const NO_SOUND_PREFS: SoundPrefs = { favorites: [], recents: [], hidden: [], categories: {} };
/** Instruments and effects share the list (each browser shows its own). */
export const RECENT_MAX = 20;

export const builtinKey = (item: PaletteItem) => `fh:${item.program ?? "drums"}`;
export const bankKey = (bankId: string, p: { bankMSB: number; program: number }) => `bank:${bankId}:${p.bankMSB}:${p.program}`;
export const pluginKey = (id: string) => `plugin:${id}`;

const WORDS: [SoundCategory, RegExp][] = [
  ["ideas", /\b(captain|pilot|composer|chord ?gen|melody ?gen|arpeggi)/i],
  ["perc", /drum|perc|timpan|timbal|kit\b|beat|snare|cymbal|mallet|marimba|xylo|glock|vibraph|bell/i],
  ["keys", /piano|keys|organ|órgano|organo|harpsi|clave|celest|rhodes|wurli|clav|electric ?\d|electric grand/i],
  ["strings", /violin|violín|viola|cello|chelo|contrabajo|double bass|string|cuerda|harp|arpa|pizz|guitar|bass/i],
  ["brass", /trumpet|trompeta|trombon|tuba|horn|trompa|brass|metal|cornet/i],
  ["winds", /flute|flauta|oboe|clarinet|bassoon|fagot|sax|choir|coro|voice|vox|voz|vocal|piccolo|recorder/i],
  ["synths", /synth|pad|lead|serum|omnisphere|nexus|analog|wave|trance/i],
];

/** A category from a name (banks and plugins that say nothing more). */
export function categoryFromName(name: string): SoundCategory {
  for (const [cat, re] of WORDS) if (re.test(name)) return cat;
  return "other";
}

/**
 * A plugin's category: its own (VST3 "Instrument|Sampler", "Instrument|Synth", "Instrument|Piano",
 * "Instrument|Drum"), else from its name. Kontakt says "Sampler": it can be anything, so it goes
 * to Muestreadores until the user moves it.
 */
export function pluginCategory(p: Pick<EnginePlugin, "name" | "category">): SoundCategory {
  const byName = categoryFromName(p.name);
  if (byName === "ideas") return "ideas";
  const c = p.category.toLowerCase();
  if (/drum/.test(c)) return "perc";
  if (/piano/.test(c)) return "keys";
  if (/sampler/.test(c) && !/synth/.test(c)) return byName === "other" ? "samplers" : byName;
  if (/synth/.test(c)) return byName === "other" || byName === "synths" ? "synths" : byName;
  return byName;
}

function builtinCategory(groupEn: string, item: PaletteItem): SoundCategory {
  if (groupEn === "Keyboards") return "keys";
  if (groupEn === "Strings") return "strings";
  if (groupEn === "Winds and voices") return item.program === 60 ? "brass" : "winds";
  if (item.program === null || item.program === 47) return "perc";
  return item.program === 89 ? "synths" : "other";
}

export interface CatalogInput {
  lang: Lang;
  banks: { id: string; name: string; presets: BankPreset[] }[];
  /** Instruments only (effects come with the mixing stage). */
  plugins: EnginePlugin[];
  prefs: SoundPrefs;
  builtInLabel: string;
}

export function buildCatalog(input: CatalogInput): SoundItem[] {
  const items: SoundItem[] = [];
  const moved = input.prefs.categories;
  for (const g of PALETTE) {
    for (const item of g.items) {
      const key = builtinKey(item);
      items.push({ key, name: paletteName(item, input.lang), source: input.builtInLabel, origin: "builtin", category: moved[key] ?? builtinCategory(g.en, item), target: { kind: "default", item } });
    }
  }
  for (const bank of input.banks) {
    for (const preset of bank.presets) {
      const key = bankKey(bank.id, preset);
      const name = preset.name || `${preset.bankMSB}:${preset.program}`;
      items.push({ key, name, source: bank.name, origin: "bank", category: moved[key] ?? categoryFromName(name), target: { kind: "bank", bankId: bank.id, bankName: bank.name, preset } });
    }
  }
  const hidden = new Set(input.prefs.hidden);
  for (const p of input.plugins) {
    if (!p.instrument) continue;
    const key = pluginKey(p.id);
    if (hidden.has(key)) continue;
    items.push({ key, name: p.name, source: p.vendor, origin: "plugin", category: moved[key] ?? pluginCategory(p), target: { kind: "plugin", plugin: p } });
  }
  return items;
}

export type SoundFilter = "all" | "fourHands" | "plugins" | "favorites" | "recents";

/** Accents and case do not matter: "organo" finds "Órgano". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function filterCatalog(items: SoundItem[], filter: SoundFilter, query: string, prefs: SoundPrefs): SoundItem[] {
  const q = fold(query.trim());
  const fav = new Set(prefs.favorites);
  let out = items.filter((i) => {
    if (filter === "fourHands" && i.origin === "plugin") return false;
    if (filter === "plugins" && i.origin !== "plugin") return false;
    if (filter === "favorites" && !fav.has(i.key)) return false;
    if (filter === "recents" && !prefs.recents.includes(i.key)) return false;
    return !q || fold(i.name).includes(q) || fold(i.source).includes(q);
  });
  if (filter === "recents") out = prefs.recents.map((k) => out.find((i) => i.key === k)).filter((i): i is SoundItem => !!i);
  return out;
}

export interface SoundGroup {
  id: string;
  label: string;
  category: SoundCategory | null;
  items: SoundItem[];
}

/** By category (in CATEGORIES order) or by vendor and bank (alphabetical, Four Hands first). */
export function groupCatalog(items: SoundItem[], by: "category" | "vendor", lang: Lang, unknownVendor: string): SoundGroup[] {
  if (by === "category") {
    return CATEGORIES.map((c) => ({ id: c, label: CATEGORY_NAMES[c][lang === "es" ? 0 : 1], category: c, items: items.filter((i) => i.category === c) })).filter((g) => g.items.length);
  }
  const groups = new Map<string, SoundItem[]>();
  for (const i of items) {
    const label = i.source || unknownVendor;
    groups.set(label, [...(groups.get(label) ?? []), i]);
  }
  const builtIn = items.find((i) => i.origin === "builtin")?.source;
  return [...groups.entries()]
    .sort(([a], [b]) => (a === builtIn ? -1 : b === builtIn ? 1 : a.localeCompare(b)))
    .map(([label, list]) => ({ id: `v:${label}`, label, category: null, items: list }));
}

/** Puts a key first in the recents. */
export function withRecent(prefs: SoundPrefs, key: string): SoundPrefs {
  return { ...prefs, recents: [key, ...prefs.recents.filter((k) => k !== key)].slice(0, RECENT_MAX) };
}

// ---------------------------------------------------------------------------
// Effects (F2.2 parte C, Fran 04/11/2026): the same browser, for insert effects. With many plugins,
// a flat menu is chaos: grouped by type or by vendor, folded, with search, favourites and recents.

export const EFFECT_CATEGORIES = ["eq", "dynamics", "reverb", "delay", "modulation", "saturation", "mastering", "utility", "other"] as const;
export type EffectCategory = (typeof EFFECT_CATEGORIES)[number];

export const EFFECT_CATEGORY_NAMES: Record<EffectCategory, [es: string, en: string]> = {
  eq: ["Ecualizadores", "EQs"],
  dynamics: ["Dinámica", "Dynamics"],
  reverb: ["Reverbs", "Reverbs"],
  delay: ["Delays", "Delays"],
  modulation: ["Modulación", "Modulation"],
  saturation: ["Saturación y distorsión", "Saturation and distortion"],
  mastering: ["Mastering", "Mastering"],
  utility: ["Utilidades y medidores", "Utilities and meters"],
  other: ["Otros", "Others"],
};

/** Keys of Four Hands' own effects in the catalog (favourites and recents are kept by key). */
export const ownEffectKey = (kind: string) => `fx:${kind}`;

/** Four Hands' own effects. */
export type OwnKind = "eq" | "compressor" | "limiter" | "reverb" | "delay";

export interface EffectItem {
  key: string;
  name: string;
  /** "Four Hands" or the plugin's vendor. */
  source: string;
  origin: "builtin" | "plugin";
  category: EffectCategory;
  target: { kind: OwnKind } | { kind: "plugin"; plugin: EnginePlugin };
}

const EFFECT_WORDS: [EffectCategory, RegExp][] = [
  ["mastering", /ozone|master|maximi[sz]er|pro-l|l2\b|l3\b|elevate|limitless/i],
  ["eq", /\beq\b|equali[sz]|pro-q|pultec|filter|q\d|channel ?eq|frequency/i],
  ["dynamics", /comp|limit|gate|expander|de-?ess|transient|dynamic|leveler|1176|la-?2a|ssl|vca|opto|clipper/i],
  ["reverb", /reverb|verb|room|hall|plate|spring|space|valhalla|seventh heaven|altiverb/i],
  ["delay", /delay|echo|tape echo|h-?delay|timeless/i],
  ["modulation", /chorus|flang|phas|tremolo|vibrato|rotary|ensemble|modulat|shimmer/i],
  ["saturation", /satur|distort|drive|overdrive|fuzz|tube|tape|decapitat|saturn|crush|bit ?crush|amp\b|amplifier/i],
  ["utility", /meter|analy[sz]|scope|tuner|utility|imager|stereo ?(tool|imag|width)|width|phase ?scope|loudness/i],
];

/** A plugin effect's type: its own VST3 category ("Fx|EQ", "Fx|Dynamics", "Fx|Reverb"…), else its name. */
export function effectCategory(p: Pick<EnginePlugin, "name" | "category">): EffectCategory {
  const c = p.category.toLowerCase();
  if (/mastering/.test(c)) return "mastering";
  if (/\beq\b|filter/.test(c)) return "eq";
  if (/dynamics/.test(c)) return "dynamics";
  if (/reverb/.test(c)) return "reverb";
  if (/delay/.test(c)) return "delay";
  if (/modulation/.test(c)) return "modulation";
  if (/distortion/.test(c)) return "saturation";
  if (/analyzer|tools|spatial|restoration/.test(c)) return "utility";
  for (const [cat, re] of EFFECT_WORDS) if (re.test(p.name)) return cat;
  return "other";
}

export function buildEffectCatalog(input: { lang: Lang; plugins: EnginePlugin[]; prefs: SoundPrefs; ownLabel: string; ownNames: Record<OwnKind, string> }): EffectItem[] {
  const own: Array<[OwnKind, EffectCategory]> = [
    ["eq", "eq"],
    ["compressor", "dynamics"],
    ["limiter", "dynamics"],
    // F2.2 parte D: the song's GS reverb, as an effect (on the «Reverb» bus by default).
    ["reverb", "reverb"],
    // Fran, 04/11/2026: the delay, synced to the song's tempo.
    ["delay", "delay"],
  ];
  const items: EffectItem[] = own.map(([kind, category]) => ({ key: ownEffectKey(kind), name: input.ownNames[kind], source: input.ownLabel, origin: "builtin", category, target: { kind } }));
  const hidden = new Set(input.prefs.hidden);
  for (const p of input.plugins) {
    if (p.instrument) continue;
    const key = pluginKey(p.id);
    if (hidden.has(key)) continue;
    items.push({ key, name: p.name, source: p.vendor, origin: "plugin", category: effectCategory(p), target: { kind: "plugin", plugin: p } });
  }
  return items;
}

export function filterEffects(items: EffectItem[], filter: SoundFilter, query: string, prefs: SoundPrefs): EffectItem[] {
  return filterCatalog(items as unknown as SoundItem[], filter, query, prefs) as unknown as EffectItem[];
}

export interface EffectGroup {
  id: string;
  label: string;
  category: EffectCategory | null;
  items: EffectItem[];
}

/** By type (in EFFECT_CATEGORIES order) or by vendor (alphabetical, Four Hands first). */
export function groupEffects(items: EffectItem[], by: "category" | "vendor", lang: Lang, unknownVendor: string): EffectGroup[] {
  if (by === "category") {
    return EFFECT_CATEGORIES.map((c) => ({ id: `fx:${c}`, label: EFFECT_CATEGORY_NAMES[c][lang === "es" ? 0 : 1], category: c, items: items.filter((i) => i.category === c) })).filter((g) => g.items.length);
  }
  const groups = new Map<string, EffectItem[]>();
  for (const i of items) {
    const label = i.source || unknownVendor;
    groups.set(label, [...(groups.get(label) ?? []), i]);
  }
  const own = items.find((i) => i.origin === "builtin")?.source;
  return [...groups.entries()]
    .sort(([a], [b]) => (a === own ? -1 : b === own ? 1 : a.localeCompare(b)))
    .map(([label, list]) => ({ id: `fxv:${label}`, label, category: null, items: list.sort((a, b) => a.name.localeCompare(b.name)) }));
}
