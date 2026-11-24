/**
 * Export (F2.4, docs/audio-engine.md, 10): one export from start to end. The engine renders the
 * song to WAV offline (exportBegin, the song's MIDI and transport, export), then the MP3 is made
 * from that WAV on a thread of its own. Engine and MP3 encoder are passed in, for the tests.
 */
import fs from "node:fs";
import path from "node:path";
import { EXPORT_TAIL_SECONDS, MP3_KBPS, type ExportProgress, type ExportRequest, type ExportResult, type ExportedFile } from "../../shared/export.js";
import { chunks } from "../../audio/export-plan.js";
import { exportBaseName } from "../../shared/export.js";
import { freeBaseName } from "./files.js";

type Reply = Record<string, unknown> & { type: string };

export interface ExportEngine {
  request(message: Record<string, unknown>): Promise<Reply>;
  send(message: Record<string, unknown>): boolean;
  /** Engine events ("exportProgress", "exportDone", and "engineLost" if it stops); returns how to stop listening. */
  listen(listener: (event: Reply) => void): () => void;
}

export interface Mp3Encoding {
  done: Promise<{ bytes: number } | null>;
  cancel(): void;
}

export interface ExportDeps {
  engine: ExportEngine;
  /** Encodes `wav` to `mp3`; resolves null when cancelled. */
  mp3: (job: { wav: string; mp3: string; kbps: number; title: string; artist: string }, progress: (fraction: number) => void) => Mp3Encoding;
  /** Where an MP3-only export renders its WAV first. */
  tempDir: string;
  progress?: (p: ExportProgress) => void;
}

export class ExportJob {
  private cancelled = false;
  private encoding: Mp3Encoding | null = null;
  private rendering = false;

  constructor(
    private readonly request: ExportRequest & { folder: string },
    private readonly deps: ExportDeps,
  ) {}

  /** Stops the export; it ends with `cancelled` and no files left. */
  cancel(): void {
    this.cancelled = true;
    if (this.rendering) this.deps.engine.send({ type: "exportCancel" });
    this.encoding?.cancel();
  }

  async run(): Promise<ExportResult> {
    const r = this.request;
    const empty = (extra: Partial<ExportResult>): ExportResult => ({ ok: false, files: [], seconds: 0, lufs: -100, truePeak: -120, ...extra });
    if (!r.wav && !r.mp3) return empty({ error: "Nothing to export: choose WAV, MP3 or both" });
    if (!(r.plan.seconds > 0)) return empty({ error: "Nothing to export: the range is empty" });
    fs.mkdirSync(r.folder, { recursive: true });
    const extensions = [...(r.wav ? ["wav"] : []), ...(r.mp3 ? ["mp3"] : [])];
    const base = freeBaseName(r.folder, exportBaseName(r.title), extensions, (f) => fs.existsSync(f));
    const wavPath = r.wav ? path.join(r.folder, `${base}.wav`) : path.join(this.deps.tempDir, `fourhands-export-${process.pid}-${Date.now()}.wav`);
    const mp3Path = path.join(r.folder, `${base}.mp3`);
    const quality = r.wav ?? { rate: 48000, bits: 24 };

    const rendered = await this.render(wavPath, quality.rate, quality.bits);
    if (!rendered.ok) {
      if (!r.wav) fs.rmSync(wavPath, { force: true });
      return empty({ cancelled: rendered.cancelled, error: rendered.error });
    }
    const files: ExportedFile[] = [];
    if (r.wav) files.push({ path: wavPath, format: "wav", bytes: fs.statSync(wavPath).size });
    if (r.mp3) {
      const total = r.plan.seconds;
      this.deps.progress?.({ phase: "mp3", seconds: total, total, fraction: 0 });
      let encoded: { bytes: number } | null = null;
      let error: string | undefined;
      if (!this.cancelled) {
        this.encoding = this.deps.mp3({ wav: wavPath, mp3: mp3Path, kbps: MP3_KBPS, title: r.title, artist: r.artist }, (fraction) =>
          this.deps.progress?.({ phase: "mp3", seconds: total, total, fraction }),
        );
        try {
          encoded = await this.encoding.done;
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
        this.encoding = null;
      }
      if (!r.wav) fs.rmSync(wavPath, { force: true });
      if (!encoded) {
        // Cancelled or failed while encoding: the WAV of this export goes too, so nothing is half done.
        for (const f of files) fs.rmSync(f.path, { force: true });
        fs.rmSync(`${mp3Path}.part`, { force: true });
        return empty({ cancelled: !error, error });
      }
      files.push({ path: mp3Path, format: "mp3", bytes: encoded.bytes });
    }
    return { ok: true, files, seconds: rendered.seconds, lufs: rendered.lufs, truePeak: rendered.truePeak };
  }

  private async render(file: string, rate: number, bits: number): Promise<{ ok: boolean; cancelled?: boolean | undefined; error?: string | undefined; seconds: number; lufs: number; truePeak: number }> {
    const r = this.request;
    const { engine } = this.deps;
    const fail = (error: string, cancelled = false) => ({ ok: false, cancelled, error: cancelled ? undefined : error, seconds: 0, lufs: -100, truePeak: -120 });
    if (this.cancelled) return fail("", true);
    let ready: Reply;
    try {
      ready = await engine.request({ type: "exportBegin", rate });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    if (ready.type !== "exportReady") return fail(`Unexpected reply to exportBegin: ${ready.type}`);
    // The whole song, timed from its start (the engine waits for "export" to play it).
    for (const events of chunks(r.plan.midi)) engine.send({ type: "midi", events });
    for (const points of chunks(r.plan.transport)) engine.send({ type: "transport", points });

    const total = r.plan.seconds;
    let stop = () => {};
    const done = new Promise<Reply>((resolve) => {
      stop = engine.listen((event) => {
        if (event.event === "exportProgress") {
          const seconds = Number(event.seconds ?? 0);
          this.deps.progress?.({ phase: "render", seconds: Math.min(seconds, total), total, fraction: Math.min(0.99, seconds / total) });
        } else if (event.event === "exportDone") resolve(event);
        else if (event.event === "engineLost") resolve({ type: "event", error: "The engine stopped while exporting" });
      });
    });
    try {
      this.rendering = true;
      const started = await engine.request({
        type: "export",
        path: file,
        seconds: total,
        tail: EXPORT_TAIL_SECONDS,
        bits,
        title: r.title,
        artist: r.artist,
      });
      if (started.type !== "exportStarted") throw new Error(`Unexpected reply to export: ${started.type}`);
      // Cancelled while the request was on its way.
      if (this.cancelled) engine.send({ type: "exportCancel" });
      const end = await done;
      if (end.cancelled) return fail("", true);
      if (end.error) return fail(String(end.error));
      this.deps.progress?.({ phase: "render", seconds: total, total, fraction: 1 });
      return { ok: true, seconds: Number(end.seconds ?? 0), lufs: Number(end.lufs ?? -100), truePeak: Number(end.truePeak ?? -120) };
    } catch (e) {
      // The engine said no before rendering (it ends the export itself).
      return fail(e instanceof Error ? e.message : String(e));
    } finally {
      this.rendering = false;
      stop();
    }
  }
}
