/**
 * Export (F2.4): the MP3 on a thread of its own, so the main process (the song, the AI's tools)
 * never waits for it. LAME is imported from its own file, given by the main process.
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";
import { encodeMp3, id3Tag, readWav } from "./mp3.js";

export interface Mp3Job {
  wav: string;
  mp3: string;
  kbps: number;
  title: string;
  artist: string;
  /** Absolute path of lamejs.mjs. */
  lame: string;
}

export type Mp3Message = { type: "progress"; fraction: number } | { type: "done"; bytes: number } | { type: "error"; message: string } | { type: "cancelled" };

let cancelled = false;
parentPort?.on("message", (m: unknown) => {
  if (m === "cancel") cancelled = true;
});
// Listening for "cancel" does not keep the thread alive once the MP3 is done.
parentPort?.unref();

async function run(job: Mp3Job): Promise<Mp3Message> {
  const { Mp3Encoder } = (await import(pathToFileURL(job.lame).href)) as { Mp3Encoder: new (channels: number, rate: number, kbps: number) => { encodeBuffer(l: Int16Array, r?: Int16Array): Uint8Array; flush(): Uint8Array } };
  const pcm = readWav(fs.readFileSync(job.wav));
  const encoder = new Mp3Encoder(pcm.channels, pcm.rate, job.kbps);
  let reported = 0;
  const parts = encodeMp3(
    pcm,
    encoder,
    id3Tag({ title: job.title, artist: job.artist, software: "Four Hands Studio" }),
    (fraction) => {
      if (fraction - reported >= 0.02 || fraction >= 1) {
        reported = fraction;
        parentPort?.postMessage({ type: "progress", fraction } satisfies Mp3Message);
      }
    },
    () => cancelled,
  );
  if (!parts) return { type: "cancelled" };
  // Beside the file and renamed at the end: a cancelled or failed export leaves nothing.
  const part = `${job.mp3}.part`;
  const out = fs.openSync(part, "w");
  let bytes = 0;
  try {
    for (const p of parts) {
      fs.writeSync(out, p);
      bytes += p.length;
    }
  } finally {
    fs.closeSync(out);
  }
  fs.renameSync(part, job.mp3);
  return { type: "done", bytes };
}

run(workerData as Mp3Job).then(
  (m) => parentPort?.postMessage(m),
  (e: unknown) => {
    try {
      fs.rmSync(`${(workerData as Mp3Job).mp3}.part`, { force: true });
    } catch {
      // Nothing to clean.
    }
    parentPort?.postMessage({ type: "error", message: e instanceof Error ? e.message : String(e) } satisfies Mp3Message);
  },
);
