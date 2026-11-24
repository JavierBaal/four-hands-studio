/**
 * Export to WAV and MP3 (F2.4, docs/audio-engine.md, 10): what the window asks for and what it
 * gets back. The engine renders the song offline; the main process writes the files.
 */
import type { EngineMidiEvent, EngineTransportPoint } from "./engine.js";

export type ExportRangeKind = "song" | "loop";

export interface WavQuality {
  rate: 48000 | 44100;
  bits: 24 | 16;
}

export const WAV_QUALITIES: readonly WavQuality[] = [
  { rate: 48000, bits: 24 },
  { rate: 44100, bits: 16 },
];

export const MP3_KBPS = 320;

/** The tail after the last note: until the sound dies away, 10 s at most. */
export const EXPORT_TAIL_SECONDS = 10;

/** What the engine plays: built by the window (it knows each track's strip). */
export interface ExportPlan {
  midi: EngineMidiEvent[];
  transport: EngineTransportPoint[];
  /** The range's length; the tail comes after. */
  seconds: number;
}

/** The choices of the export window (and of the AI's export_audio). */
export interface ExportChoices {
  range: ExportRangeKind;
  /** null: no WAV (MP3 only). */
  wav: WavQuality | null;
  mp3: boolean;
  title: string;
  artist: string;
  /** Where the files go; the default folder when absent. */
  folder?: string | undefined;
}

export interface ExportRequest extends ExportChoices {
  plan: ExportPlan;
}

export interface ExportedFile {
  path: string;
  format: "wav" | "mp3";
  bytes: number;
}

export interface ExportResult {
  ok: boolean;
  cancelled?: boolean | undefined;
  /** In English, for the log; the window shows its own words. */
  error?: string | undefined;
  files: ExportedFile[];
  /** With the tail. */
  seconds: number;
  /** Integrated loudness of the whole export, LUFS (BS.1770). */
  lufs: number;
  /** dBTP. */
  truePeak: number;
}

export type ExportPhase = "render" | "mp3";

export interface ExportProgress {
  phase: ExportPhase;
  /** Seconds of the song rendered so far (render). */
  seconds: number;
  /** The range's length (the tail is not known until it ends). */
  total: number;
  /** 0–1 of this phase. */
  fraction: number;
}

/** The window's last choices and the defaults, for opening it as it was left. */
export interface ExportDefaults {
  folder: string;
  /** The default folder, to tell it apart in the window. */
  defaultFolder: string;
  artist: string;
  wav: WavQuality | null;
  mp3: boolean;
}

/** WAV size in bytes for a length (for the window's estimate). */
export function wavBytes(seconds: number, quality: WavQuality): number {
  return Math.round(seconds * quality.rate) * 2 * (quality.bits / 8) + 44;
}

/** A title as a file name that works on Windows, macOS and Linux. */
export function exportBaseName(title: string): string {
  const clean = title
    // Characters Windows refuses, and control characters.
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Windows drops trailing dots and spaces.
    .replace(/[. ]+$/, "")
    .slice(0, 120)
    .trim();
  if (!clean) return "Four Hands";
  // Names Windows keeps for devices.
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean) ? `${clean} (audio)` : clean;
}
