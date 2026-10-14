/**
 * Reads what a SoundFont (SF2 / SF3) contains without loading it: its name (INFO/INAM) and its
 * presets (pdta/phdr). Walks the RIFF chunks with small reads, so a 500 MB bank answers in
 * milliseconds. Pure: the caller supplies the reads (a file on disk, a buffer in a test).
 */

export interface BankPreset {
  /** MIDI program inside the bank, 0–127. */
  program: number;
  /** Bank number as the SoundFont stores it (128 = percussion kits). */
  bankMSB: number;
  name: string;
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
  let presets: BankPreset[] = [];
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
          if (kind === "pdta" && sid === "phdr") presets = parsePhdr(read(p + 8, ssize));
          p += 8 + ssize + (ssize & 1);
        }
      }
    }
    pos += 8 + csize + (csize & 1);
  }
  return { name, presets };
}

/** 38-byte records: name[20], preset, bank, bag index, library, genre, morphology. The last is EOP. */
function parsePhdr(data: Uint8Array): BankPreset[] {
  const out: BankPreset[] = [];
  for (let o = 0; o + 38 * 2 <= data.length; o += 38) {
    out.push({ name: text(data.subarray(o, o + 20)), program: u16(data, o + 20), bankMSB: u16(data, o + 22) });
  }
  return out.sort((a, b) => a.bankMSB - b.bankMSB || a.program - b.program);
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
