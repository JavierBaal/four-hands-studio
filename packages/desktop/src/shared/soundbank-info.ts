/**
 * Reads what a SoundFont (SF2 / SF3) contains without loading it: its name (INFO/INAM), its
 * presets (pdta/phdr) and, from the rest of pdta, a profile of each preset's sound: the keys it
 * has samples for, how fast it starts, whether it holds or dies out, how long it rings after the
 * note ends. Walks the RIFF chunks with small reads and never
 * touches the samples, so a 500 MB bank answers in milliseconds. Pure: the caller supplies the
 * reads (a file on disk, a buffer in a test).
 */

export interface BankPreset {
  /** MIDI program inside the bank, 0–127. */
  program: number;
  /** Bank number as the SoundFont stores it (128 = percussion kits). */
  bankMSB: number;
  name: string;
  /** How it behaves, measured from the bank; absent if the bank does not say. */
  profile?: SoundProfile;
}

/** A preset's sound, as the SoundFont describes it (its generators), not as anyone heard it. */
export interface SoundProfile {
  /** Lowest and highest MIDI key with samples: outside them the sound is silent. */
  low: number;
  high: number;
  /** Seconds from the note to full level (volume envelope delay + attack), typical over its keys. */
  attack: number;
  /** Seconds it keeps ringing after the note ends (volume envelope release). */
  release: number;
  /** holds: sustains while the note lasts · fades: dies away even when held · decays: no loop, stops when the sample ends. */
  sustain: "holds" | "fades" | "decays";
  /** fades: seconds to die away; decays: length of the sample when the bank says (SF2), else null. */
  fade: number | null;
}

export interface BankHeader {
  /** INAM of the file, or "" if it has none. */
  name: string;
  presets: BankPreset[];
}

/** Reads `length` bytes at `position`; may return fewer at the end of the file. */
export type ReadAt = (position: number, length: number) => Uint8Array;

const text = (bytes: Uint8Array) => {
  let end = bytes.indexOf(0);
  if (end < 0) end = bytes.length;
  let s = "";
  for (let i = 0; i < end; i++) s += String.fromCharCode(bytes[i]!);
  return s.trim();
};
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const id = (b: Uint8Array, o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);

/** The bank's name and presets, sorted by bank and program. Throws if it is not a SoundFont. */
export function readBankHeader(read: ReadAt, size: number): BankHeader {
  const head = read(0, 12);
  if (head.length < 12 || id(head, 0) !== "RIFF" || id(head, 8) !== "sfbk") throw new Error("Not a SoundFont (RIFF sfbk)");
  const end = Math.min(size, 8 + u32(head, 4));
  let name = "";
  const pdta: Record<string, Uint8Array> = {};
  let pos = 12;
  while (pos + 12 <= end) {
    const h = read(pos, 12);
    const cid = id(h, 0);
    const csize = u32(h, 4);
    if (cid === "LIST") {
      const kind = id(h, 8);
      if (kind === "INFO" || kind === "pdta") {
        let p = pos + 12;
        const e = pos + 8 + csize;
        while (p + 8 <= e) {
          const sh = read(p, 8);
          const sid = id(sh, 0);
          const ssize = u32(sh, 4);
          if (kind === "INFO" && sid === "INAM") name = text(read(p + 8, Math.min(ssize, 256)));
          if (kind === "pdta" && PDTA.includes(sid)) pdta[sid] = read(p + 8, ssize);
          p += 8 + ssize + (ssize & 1);
        }
      }
    }
    pos += 8 + csize + (csize & 1);
  }
  const presets = pdta.phdr ? parsePhdr(pdta.phdr) : [];
  try {
    const profiles = readProfiles(pdta);
    for (const p of presets) {
      const profile = profiles.get(`${p.bankMSB}:${p.program}:${p.name}`);
      if (profile) p.profile = profile;
    }
  } catch {
    /* a bank with odd zones still lists its presets, without profiles */
  }
  return { name, presets: presets.sort((a, b) => a.bankMSB - b.bankMSB || a.program - b.program) };
}

const PDTA = ["phdr", "pbag", "pgen", "inst", "ibag", "igen", "shdr"];

// Generators (SoundFont 2.04, 8.1.2)
const G_DELAY = 33;
const G_ATTACK = 34;
const G_DECAY = 36;
const G_SUSTAIN = 37;
const G_RELEASE = 38;
const G_INSTRUMENT = 41;
const G_KEYRANGE = 43;
const G_SAMPLE = 53;
const G_SAMPLEMODES = 54;

type Zone = Map<number, number>;

/** Zones of each record: 4-byte bags pointing into 4-byte generators. The last record is a terminator. */
function zonesOf(records: Uint8Array, size: number, bagAt: number, bags: Uint8Array, gens: Uint8Array): Zone[][] {
  const out: Zone[][] = [];
  const count = Math.floor(records.length / size) - 1;
  for (let r = 0; r < count; r++) {
    const from = u16(records, r * size + bagAt);
    const to = u16(records, (r + 1) * size + bagAt);
    const zones: Zone[] = [];
    for (let b = from; b < to && (b + 1) * 4 + 2 <= bags.length; b++) {
      const g0 = u16(bags, b * 4);
      const g1 = u16(bags, (b + 1) * 4);
      const zone: Zone = new Map();
      for (let g = g0; g < g1 && g * 4 + 4 <= gens.length; g++) zone.set(u16(gens, g * 4), u16(gens, g * 4 + 2));
      zones.push(zone);
    }
    out.push(zones);
  }
  return out;
}

const s16 = (v: number) => (v & 0x8000 ? v - 0x10000 : v);
const keyRange = (z: Zone | undefined): [number, number] | undefined => {
  const v = z?.get(G_KEYRANGE);
  return v === undefined ? undefined : [v & 0xff, v >> 8];
};
/** Timecents to seconds; -12000 and below is "instant". */
const seconds = (tc: number) => (tc <= -12000 ? 0 : 2 ** (tc / 1200));

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2)]! : 0;
}

/** Profiles by "bank:program:name" (names, because a few banks repeat a program number). */
function readProfiles(pdta: Record<string, Uint8Array>): Map<string, SoundProfile> {
  const out = new Map<string, SoundProfile>();
  const { phdr, pbag, pgen, inst, ibag, igen, shdr } = pdta;
  if (!phdr || !pbag || !pgen || !inst || !ibag || !igen || !shdr) return out;
  const presetZones = zonesOf(phdr, 38, 24, pbag, pgen);
  const instZones = zonesOf(inst, 22, 20, ibag, igen);
  const samples = Math.floor(shdr.length / 46);
  for (let r = 0; r < presetZones.length; r++) {
    const pz = presetZones[r]!;
    const pGlobal = pz[0] && !pz[0].has(G_INSTRUMENT) ? pz[0] : undefined;
    let low = 128;
    let high = -1;
    const attacks: number[] = [];
    const releases: number[] = [];
    const kinds = { holds: 0, fades: 0, decays: 0 };
    const fades: number[] = [];
    const lengths: number[] = [];
    for (const z of pz) {
      const instrument = z.get(G_INSTRUMENT);
      if (instrument === undefined || !instZones[instrument]) continue;
      const pRange = keyRange(z) ?? keyRange(pGlobal) ?? [0, 127];
      const iz = instZones[instrument]!;
      const iGlobal = iz[0] && !iz[0].has(G_SAMPLE) ? iz[0] : undefined;
      // Instrument value (zone, else global, else default) plus the preset's offset (zone, else global).
      const value = (zone: Zone, g: number, dflt: number) =>
        s16(zone.get(g) ?? iGlobal?.get(g) ?? (dflt & 0xffff)) + s16(z.get(g) ?? pGlobal?.get(g) ?? 0);
      for (const zone of iz) {
        const sample = zone.get(G_SAMPLE);
        if (sample === undefined || sample >= samples) continue;
        const iRange = keyRange(zone) ?? keyRange(iGlobal) ?? [0, 127];
        const lo = Math.max(pRange[0], iRange[0]);
        const hi = Math.min(pRange[1], iRange[1]);
        if (lo > hi) continue;
        low = Math.min(low, lo);
        high = Math.max(high, hi);
        // Each zone counts as many times as keys it covers, so a one-key zone does not outvote the rest.
        const weight = hi - lo + 1;
        const attack = seconds(value(zone, G_DELAY, -12000)) + seconds(value(zone, G_ATTACK, -12000));
        const release = seconds(value(zone, G_RELEASE, -12000));
        const sustainCb = Math.min(1440, Math.max(0, value(zone, G_SUSTAIN, 0)));
        const looped = ((zone.get(G_SAMPLEMODES) ?? iGlobal?.get(G_SAMPLEMODES) ?? 0) & 1) === 1;
        const o = sample * 46;
        const compressed = (u16(shdr, o + 44) & 0x10) !== 0;
        const rate = u32(shdr, o + 36);
        const length = !compressed && rate > 0 ? (u32(shdr, o + 24) - u32(shdr, o + 20)) / rate : null;
        const kind = !looped ? "decays" : sustainCb >= 600 ? "fades" : "holds";
        for (let k = 0; k < weight; k++) {
          attacks.push(attack);
          releases.push(release);
          kinds[kind]++;
          if (kind === "fades") fades.push(seconds(value(zone, G_DECAY, -12000)));
          if (kind === "decays" && length !== null) lengths.push(length);
        }
      }
    }
    if (high < 0) continue;
    const sustain = (Object.entries(kinds) as [SoundProfile["sustain"], number][]).sort((a, b) => b[1] - a[1])[0]![0];
    const fade = sustain === "fades" ? median(fades) : sustain === "decays" && lengths.length ? median(lengths) : null;
    const round = (x: number) => Math.round(x * 100) / 100;
    const o = r * 38;
    out.set(`${u16(phdr, o + 22)}:${u16(phdr, o + 20)}:${text(phdr.subarray(o, o + 20))}`, {
      low,
      high,
      attack: round(median(attacks)),
      release: round(median(releases)),
      sustain,
      fade: fade === null ? null : round(fade),
    });
  }
  return out;
}

/** 38-byte records: name[20], preset, bank, bag index, library, genre, morphology. The last is EOP. */
function parsePhdr(data: Uint8Array): BankPreset[] {
  const out: BankPreset[] = [];
  for (let o = 0; o + 38 * 2 <= data.length; o += 38) {
    out.push({ name: text(data.subarray(o, o + 20)), program: u16(data, o + 20), bankMSB: u16(data, o + 22) });
  }
  return out;
}

/** A readable name: the file's own name if it is not generic, else the file name tidied up. */
export function bankDisplayName(header: BankHeader, fileName: string): string {
  const stem = fileName.replace(/\.(sf2|sf3)$/i, "");
  const tidy = stem
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b(19|20)\d{6}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const own = header.name.replace(/\s+/g, " ").trim();
  if (!own || /^(untitled|unnamed|soundfont|sf2)$/i.test(own) || own.length < 3) return tidy;
  // A single-instrument bank often calls itself after its preset ("Grand Piano"): the file says more.
  if (header.presets.length === 1 && own === header.presets[0]!.name) return tidy;
  return own;
}

/** Banks that number their instruments like General MIDI (piano 0, strings 48…). */
export function looksGeneralMidi(presets: readonly BankPreset[]): boolean {
  return presets.filter((p) => p.bankMSB === 0).length >= 100;
}
