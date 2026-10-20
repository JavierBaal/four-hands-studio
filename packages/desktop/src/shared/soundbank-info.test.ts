import { describe, expect, it } from "vitest";
import { bankDisplayName, looksGeneralMidi, readBankHeader } from "./soundbank-info.js";

/** A minimal SoundFont: RIFF sfbk with INFO/INAM and pdta/phdr (other chunks are not needed). */
function soundFont(name: string, presets: { name: string; program: number; bank: number }[], extra: Uint8Array[] = []): Uint8Array {
  const chunk = (cid: string, body: Uint8Array) => {
    const out = new Uint8Array(8 + body.length + (body.length & 1));
    out.set([...cid].map((c) => c.charCodeAt(0)), 0);
    new DataView(out.buffer).setUint32(4, body.length, true);
    out.set(body, 8);
    return out;
  };
  const list = (kind: string, parts: Uint8Array[]) => {
    const body = new Uint8Array(4 + parts.reduce((n, p) => n + p.length, 0));
    body.set([...kind].map((c) => c.charCodeAt(0)), 0);
    let o = 4;
    for (const p of parts) (body.set(p, o), (o += p.length));
    return chunk("LIST", body);
  };
  const str = (s: string, len: number) => {
    const b = new Uint8Array(len);
    b.set([...s.slice(0, len - 1)].map((c) => c.charCodeAt(0)));
    return b;
  };
  const phdr = new Uint8Array(38 * (presets.length + 1));
  const view = new DataView(phdr.buffer);
  [...presets, { name: "EOP", program: 0, bank: 0 }].forEach((p, i) => {
    phdr.set(str(p.name, 20), i * 38);
    view.setUint16(i * 38 + 20, p.program, true);
    view.setUint16(i * 38 + 22, p.bank, true);
    view.setUint16(i * 38 + 24, i, true); // preset i starts at bag i; EOP closes the last one
  });
  const info = list("INFO", [chunk("ifil", new Uint8Array(4)), chunk("INAM", str(name, name.length + 2))]);
  const sdta = list("sdta", [chunk("smpl", new Uint8Array(10))]);
  const pdta = list("pdta", [chunk("phdr", phdr), ...extra]);
  const body = new Uint8Array(4 + info.length + sdta.length + pdta.length);
  body.set([..."sfbk"].map((c) => c.charCodeAt(0)), 0);
  body.set(info, 4);
  body.set(sdta, 4 + info.length);
  body.set(pdta, 4 + info.length + sdta.length);
  return chunk("RIFF", body);
}

const sfChunk = (cid: string, body: Uint8Array) => {
  const out = new Uint8Array(8 + body.length + (body.length & 1));
  out.set([...cid].map((c) => c.charCodeAt(0)), 0);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
};

/** 4-byte records of two u16 (bags: generator index, modulator index; generators: operator, amount). */
const pairs = (rows: [number, number][]) => {
  const b = new Uint8Array(rows.length * 4);
  const v = new DataView(b.buffer);
  rows.forEach(([a, c], i) => (v.setUint16(i * 4, a, true), v.setUint16(i * 4 + 2, c & 0xffff, true)));
  return b;
};
const range = (lo: number, hi: number) => lo | (hi << 8);
const tc = (seconds: number) => Math.round(1200 * Math.log2(seconds));

const reader = (bytes: Uint8Array) => (pos: number, len: number) => bytes.subarray(pos, pos + len);

describe("reading a sound bank without loading it", () => {
  it("finds its name and presets, sorted", () => {
    const sf = soundFont("Sonatina Symphonic Orchestra", [
      { name: "1st Violins Sustain", program: 2, bank: 0 },
      { name: "Steinway Grand", program: 0, bank: 0 },
    ]);
    const h = readBankHeader(reader(sf), sf.length);
    expect(h.name).toBe("Sonatina Symphonic Orchestra");
    expect(h.presets).toEqual([
      { name: "Steinway Grand", program: 0, bankMSB: 0 },
      { name: "1st Violins Sustain", program: 2, bankMSB: 0 },
    ]);
    expect(looksGeneralMidi(h.presets)).toBe(false);
  });
  it("rejects what is not a SoundFont", () => {
    const junk = new Uint8Array(40);
    expect(() => readBankHeader(reader(junk), junk.length)).toThrow();
  });
  it("names a single-instrument bank after its file", () => {
    const sf = soundFont("Grand Piano", [{ name: "Grand Piano", program: 0, bank: 0 }]);
    expect(bankDisplayName(readBankHeader(reader(sf), sf.length), "YDP-GrandPiano-20160804.sf2")).toBe("YDP Grand Piano");
    expect(bankDisplayName({ name: "Sonatina Symphonic Orchestra", presets: [] }, "x.sf2")).toBe("Sonatina Symphonic Orchestra");
  });
});

describe("sound profiles from the bank's own data", () => {
  // Two presets on two instruments: a slow, looped section (G3–C7) and an unlooped pizzicato (G3–C6).
  function orchestra(): Uint8Array {
    const pbag = pairs([[0, 0], [1, 0], [2, 0]]);
    const pgen = pairs([[41, 0], [41, 1], [0, 0]]); // preset 0 -> inst 0, preset 1 -> inst 1
    const inst = new Uint8Array(22 * 3);
    new DataView(inst.buffer).setUint16(22 + 20, 3, true); // inst 1 starts at bag 3
    new DataView(inst.buffer).setUint16(44 + 20, 4, true); // terminator
    const ibag = pairs([[0, 0], [5, 0], [9, 0], [12, 0], [15, 0]]);
    const igen = pairs([
      // inst 0, global zone: attack 0.25 s, release 0.9 s, looped
      [34, tc(0.25)], [38, tc(0.9)], [54, 1], [37, 0], [0, 0],
      // zone 1: G3–B4, sample 0
      [43, range(55, 71)], [54, 1], [53, 0], [0, 0],
      // zone 2: C5–C7, sample 0
      [43, range(72, 96)], [53, 0], [0, 0],
      // inst 1: one zone G3–C6, unlooped, sample 1
      [43, range(55, 84)], [54, 0], [53, 1],
    ]);
    const shdr = new Uint8Array(46 * 3);
    const v = new DataView(shdr.buffer);
    v.setUint32(46 + 20, 0, true);
    v.setUint32(46 + 24, 44100, true); // one second at 44.1 kHz
    v.setUint32(46 + 36, 44100, true);
    v.setUint32(36, 44100, true);
    v.setUint32(24, 88200, true);
    return soundFont("Orquesta", [{ name: "Violins Sustain", program: 0, bank: 0 }, { name: "Violins Pizz", program: 1, bank: 0 }], [
      sfChunk("pbag", pbag),
      sfChunk("pgen", pgen),
      sfChunk("inst", inst),
      sfChunk("ibag", ibag),
      sfChunk("igen", igen),
      sfChunk("shdr", shdr),
    ]);
  }

  it("reads the keys with samples, the attack, the release and whether it holds or dies out", () => {
    const sf = orchestra();
    const [sustain, pizz] = readBankHeader(reader(sf), sf.length).presets;
    expect(sustain).toMatchObject({ name: "Violins Sustain", profile: { low: 55, high: 96, attack: 0.25, release: 0.9, sustain: "holds", fade: null } });
    expect(pizz).toMatchObject({ name: "Violins Pizz", profile: { low: 55, high: 84, attack: 0, release: 0, sustain: "decays", fade: 1 } });
  });

  it("a bank without zones still lists its presets, without profiles", () => {
    const sf = soundFont("Solo nombres", [{ name: "Piano", program: 0, bank: 0 }]);
    expect(readBankHeader(reader(sf), sf.length).presets[0]).toEqual({ name: "Piano", program: 0, bankMSB: 0 });
  });
});
