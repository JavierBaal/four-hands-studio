import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Mp3Encoder } from "@breezystack/lamejs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExportProgress, ExportRequest } from "../../shared/export.js";
import { exportBaseName, freeBaseName } from "./files.js";
import { type ExportDeps, type ExportEngine, ExportJob } from "./job.js";
import { encodeMp3, id3Tag, readWav } from "./mp3.js";

/** A stereo PCM WAV, as the engine writes it (with an INFO list before the data). */
function wav(frames: number, bits: 16 | 24, rate = 48000, value = (i: number, c: number) => Math.sin(i / 20) * 0.5 * (c ? -1 : 1)): Uint8Array {
  const bytes = bits / 8;
  const info = new TextEncoder().encode("LIST\u000c\u0000\u0000\u0000INFOISFT\u0000\u0000\u0000\u0000");
  const data = frames * 2 * bytes;
  const out = new Uint8Array(12 + 24 + info.length + 8 + data);
  const v = new DataView(out.buffer);
  const put = (at: number, s: string) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  put(0, "RIFF");
  v.setUint32(4, out.length - 8, true);
  put(8, "WAVE");
  put(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2 * bytes, true);
  v.setUint16(32, 2 * bytes, true);
  v.setUint16(34, bits, true);
  out.set(info, 36);
  let at = 36 + info.length;
  put(at, "data");
  v.setUint32(at + 4, data, true);
  at += 8;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < 2; c++) {
      const x = value(i, c);
      if (bits === 16) v.setInt16(at, Math.round(x * 32767), true);
      else {
        const s = Math.round(x * 8388607);
        out[at] = s & 0xff;
        out[at + 1] = (s >> 8) & 0xff;
        out[at + 2] = (s >> 16) & 0xff;
      }
      at += bytes;
    }
  return out;
}

describe("export: file names", () => {
  it("makes a file name of the song's title on every system", () => {
    expect(exportBaseName("Invasion")).toBe("Invasion");
    expect(exportBaseName('Tema: "uno"/dos?')).toBe("Tema uno dos");
    expect(exportBaseName("  final.  ")).toBe("final");
    expect(exportBaseName("CON")).toBe("CON (audio)");
    expect(exportBaseName("***")).toBe("Four Hands");
  });

  it("never writes over an earlier export, and the WAV and MP3 share their name", () => {
    const taken = new Set([path.join("/x", "Invasion.wav"), path.join("/x", "Invasion (2).mp3")]);
    const exists = (f: string) => taken.has(f);
    expect(freeBaseName("/x", "Invasion", ["wav"], exists)).toBe("Invasion (2)");
    expect(freeBaseName("/x", "Invasion", ["mp3"], exists)).toBe("Invasion");
    expect(freeBaseName("/x", "Invasion", ["wav", "mp3"], exists)).toBe("Invasion (3)");
  });
});

describe("export: MP3", () => {
  it("reads the engine's WAV at 24 and 16 bit", () => {
    const w24 = readWav(wav(1000, 24));
    expect([w24.rate, w24.bits, w24.channels, w24.frames]).toEqual([48000, 24, 2, 1000]);
    expect(w24.left[100]).toBeCloseTo(Math.sin(5) * 0.5 * 32767, -1);
    expect(w24.right[100]).toBeCloseTo(-Math.sin(5) * 0.5 * 32767, -1);
    const w16 = readWav(wav(1000, 16, 44100));
    expect([w16.rate, w16.bits, w16.frames]).toEqual([44100, 16, 1000]);
    expect(() => readWav(new Uint8Array(40))).toThrow();
  });

  it("writes the title and the artist in an ID3 tag", () => {
    const tag = id3Tag({ title: "Invasión", artist: "Fran Barbero" });
    expect(String.fromCharCode(...tag.subarray(0, 3))).toBe("ID3");
    const has = (text: string) => Buffer.from(tag).includes(Buffer.from(text, "utf16le"));
    expect(has("Invasión")).toBe(true);
    expect(has("Fran Barbero")).toBe(true);
    // The size in the header is the tag's, without its 10 bytes.
    const size = (tag[6]! << 21) | (tag[7]! << 14) | (tag[8]! << 7) | tag[9]!;
    expect(size).toBe(tag.length - 10);
  });

  it("encodes a WAV to MP3 at 320 kbps", () => {
    const pcm = readWav(wav(48000, 24));
    const steps: number[] = [];
    const parts = encodeMp3(pcm, new Mp3Encoder(2, 48000, 320), id3Tag({ title: "x" }), (f) => steps.push(f))!;
    const bytes = parts.reduce((n, p) => n + p.length, 0);
    // One second at 320 kbps: some 40 KB.
    expect(bytes).toBeGreaterThan(35_000);
    expect(bytes).toBeLessThan(48_000);
    // After the tag, an MPEG frame (sync bits).
    const first = parts[1]!;
    expect(first[0]).toBe(0xff);
    expect(first[1]! & 0xe0).toBe(0xe0);
    expect(steps.at(-1)).toBe(1);
    expect(encodeMp3(pcm, new Mp3Encoder(2, 48000, 320), new Uint8Array(), undefined, () => true)).toBeNull();
  });
});

/** An engine that "renders" by writing a small WAV when asked to export. */
class FakeEngine implements ExportEngine {
  sent: Array<Record<string, unknown>> = [];
  asked: Array<Record<string, unknown>> = [];
  private listeners = new Set<(e: Record<string, unknown> & { type: string }) => void>();
  constructor(private readonly behaviour: { refuse?: string; die?: boolean; hold?: boolean } = {}) {}
  async request(m: Record<string, unknown>) {
    this.asked.push(m);
    if (m.type === "exportBegin") {
      if (this.behaviour.refuse) throw new Error(this.behaviour.refuse);
      return { type: "exportReady", sampleRate: m.rate };
    }
    if (m.type === "export") {
      setTimeout(() => {
        if (this.behaviour.die) return this.emit({ type: "event", event: "engineLost" });
        if (this.behaviour.hold) return;
        this.emit({ type: "event", event: "exportProgress", seconds: 0.5 });
        fs.writeFileSync(String(m.path), wav(4800, m.bits === 16 ? 16 : 24));
        this.emit({ type: "event", event: "exportDone", path: m.path, seconds: 1.4, cancelled: false, error: "", lufs: -15.8, truePeak: -1.4 });
      }, 5);
      return { type: "exportStarted" };
    }
    return { type: "ok" };
  }
  send(m: Record<string, unknown>) {
    this.sent.push(m);
    if (m.type === "exportCancel") setTimeout(() => this.emit({ type: "event", event: "exportDone", cancelled: true, error: "" }), 1);
    return true;
  }
  listen(l: (e: Record<string, unknown> & { type: string }) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  emit(e: Record<string, unknown> & { type: string }) {
    for (const l of [...this.listeners]) l(e);
  }
}

describe("export: the whole export", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-export-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const request = (over: Partial<ExportRequest> = {}): ExportRequest & { folder: string } => ({
    range: "song",
    wav: { rate: 48000, bits: 24 },
    mp3: true,
    title: "Invasion",
    artist: "Fran Barbero",
    folder: path.join(dir, "Exportaciones"),
    plan: {
      midi: Array.from({ length: 4500 }, (_, i) => ({ slot: 512, delay: i * 0.0002, data: [0x90, 60, 100], ch: 1 })),
      transport: [{ delay: 0, playing: true, ppq: 0, bpm: 120, num: 4, den: 4, bar: 0 }],
      seconds: 1,
    },
    ...over,
  });
  const deps = (engine: FakeEngine, progress: ExportProgress[] = []): ExportDeps => ({
    engine,
    tempDir: dir,
    progress: (p) => progress.push(p),
    mp3: (job, step) => {
      const parts = encodeMp3(readWav(fs.readFileSync(job.wav)), new Mp3Encoder(2, 48000, job.kbps), id3Tag(job), step)!;
      fs.writeFileSync(job.mp3, Buffer.concat(parts));
      return { done: Promise.resolve({ bytes: fs.statSync(job.mp3).size }), cancel: () => {} };
    },
  });

  it("sends the song to the engine and writes the WAV and the MP3 with the same name", async () => {
    const engine = new FakeEngine();
    const progress: ExportProgress[] = [];
    const result = await new ExportJob(request(), deps(engine, progress)).run();
    expect(result.ok).toBe(true);
    expect(result.files.map((f) => path.basename(f.path))).toEqual(["Invasion.wav", "Invasion.mp3"]);
    expect(result.files.every((f) => f.bytes > 0 && fs.existsSync(f.path))).toBe(true);
    expect([result.lufs, result.truePeak, result.seconds]).toEqual([-15.8, -1.4, 1.4]);
    // The song goes in pieces, before "export".
    expect(engine.sent.filter((m) => m.type === "midi").map((m) => (m.events as unknown[]).length)).toEqual([2000, 2000, 500]);
    expect(engine.asked.map((m) => m.type)).toEqual(["exportBegin", "export"]);
    expect(engine.asked[1]).toMatchObject({ seconds: 1, tail: 10, bits: 24, title: "Invasion", artist: "Fran Barbero" });
    expect(progress.some((p) => p.phase === "render" && p.fraction === 0.5)).toBe(true);
    expect(progress.at(-1)).toMatchObject({ phase: "mp3", fraction: 1 });

    // Again: a new name, the first export stays.
    const again = await new ExportJob(request(), deps(new FakeEngine())).run();
    expect(again.files.map((f) => path.basename(f.path))).toEqual(["Invasion (2).wav", "Invasion (2).mp3"]);
  });

  it("makes an MP3 alone from a WAV it does not keep", async () => {
    const result = await new ExportJob(request({ wav: null }), deps(new FakeEngine())).run();
    expect(result.files.map((f) => f.format)).toEqual(["mp3"]);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".wav"))).toEqual([]);
    expect(fs.readdirSync(path.join(dir, "Exportaciones"))).toEqual(["Invasion.mp3"]);
  });

  it("writes 16 bit at 44.1 kHz when asked", async () => {
    const engine = new FakeEngine();
    await new ExportJob(request({ wav: { rate: 44100, bits: 16 }, mp3: false }), deps(engine)).run();
    expect(engine.asked[0]).toMatchObject({ type: "exportBegin", rate: 44100 });
    expect(engine.asked[1]).toMatchObject({ bits: 16 });
  });

  it("leaves no files when cancelled, refused or when the engine stops", async () => {
    const engine = new FakeEngine({ hold: true });
    const job = new ExportJob(request(), deps(engine));
    const running = job.run();
    await new Promise((r) => setTimeout(r, 20));
    job.cancel();
    const cancelled = await running;
    expect(cancelled).toMatchObject({ ok: false, cancelled: true });
    expect(engine.sent.some((m) => m.type === "exportCancel")).toBe(true);

    const refused = await new ExportJob(request(), deps(new FakeEngine({ refuse: "An export is already under way" }))).run();
    expect(refused).toMatchObject({ ok: false, error: "An export is already under way" });

    const lost = await new ExportJob(request(), deps(new FakeEngine({ die: true }))).run();
    expect(lost).toMatchObject({ ok: false, error: "The engine stopped while exporting" });
    expect(fs.readdirSync(path.join(dir, "Exportaciones"))).toEqual([]);

    expect(await new ExportJob(request({ wav: null, mp3: false }), deps(new FakeEngine())).run()).toMatchObject({ ok: false });
  });
});
