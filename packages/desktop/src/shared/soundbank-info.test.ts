import { describe, expect, it } from "vitest";
import { bankDisplayName, looksGeneralMidi, readBankHeader } from "./soundbank-info.js";

/** A minimal SoundFont: RIFF sfbk with INFO/INAM and pdta/phdr (other chunks are not needed). */
function soundFont(name: string, presets: { name: string; program: number; bank: number }[]): Uint8Array {
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
  });
  const info = list("INFO", [chunk("ifil", new Uint8Array(4)), chunk("INAM", str(name, name.length + 2))]);
  const sdta = list("sdta", [chunk("smpl", new Uint8Array(10))]);
  const pdta = list("pdta", [chunk("phdr", phdr)]);
  const body = new Uint8Array(4 + info.length + sdta.length + pdta.length);
  body.set([..."sfbk"].map((c) => c.charCodeAt(0)), 0);
  body.set(info, 4);
  body.set(sdta, 4 + info.length);
  body.set(pdta, 4 + info.length + sdta.length);
  return chunk("RIFF", body);
}

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
