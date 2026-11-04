/**
 * The native engine as the window sees it (fase 2, prueba S2; ESTUDIO_FASE2_MOTOR.md, 3). The
 * main process starts the engine and talks to it; the window asks for plugins, loads them into
 * slots (one per track, its strip: shared/strips.ts) and sends MIDI ahead of time.
 */

export interface EngineStatus {
  /**
   * "off": not started (it starts when a track needs it). "missing": the engine is not on this
   * computer (not compiled yet). "failed": it did not start or stopped by itself.
   */
  state: "off" | "starting" | "ready" | "missing" | "failed";
  /** "Windows Audio · Altavoces · 48000 Hz · 480 samples", once ready. */
  device?: string | undefined;
  /** Seconds from the engine receiving a note to the speakers (its buffer and the device's). */
  latency?: number | undefined;
  /** Why it is "failed", or a device problem while "ready", in English for the log. */
  error?: string | undefined;
  /** Goes up every time the engine (re)starts: plugins must be loaded again. */
  generation: number;
}

export const ENGINE_OFF: EngineStatus = { state: "off", generation: 0 };

/**
 * F2.1 (Fran, 01/11/2026): the engine's slot for the built-in sounds, after the plugin slots (one
 * per strip, A2: 512). Its synth has a channel per strip, given with each event (`ch`).
 */
export const SOUNDS_SLOT = 512;

/** What the engine says when a sound bank is ready in it (or could not load). */
export interface EngineSoundsResult {
  ok: boolean;
  error?: string | undefined;
  presets?: number | undefined;
  ms?: number | undefined;
}

/** A plugin the engine found on this computer. */
export interface EnginePlugin {
  id: string;
  name: string;
  vendor: string;
  category: string;
  format: string;
  instrument: boolean;
}

/**
 * One MIDI event for a slot, `delay` seconds after the engine receives it. A plugin's slot is its
 * track's strip; for the built-in sounds, `ch` is the strip (A2) and the bytes keep the MIDI channel
 * (10: drums).
 */
export interface EngineMidiEvent {
  slot: number;
  delay: number;
  data: number[];
  ch?: number;
}

/**
 * F2.2 (Fran, 04/11/2026): where the song is, for the plugins (their transport: Ozone's assistant
 * listens only while playing; synced delays and arpeggiators follow the tempo). Sent with the notes,
 * `delay` seconds ahead, so each point lands on its sample; between points the engine moves on at
 * `bpm`.
 */
export interface EngineTransportPoint {
  delay: number;
  playing: boolean;
  /** Quarter notes from the start of the song. */
  ppq: number;
  bpm: number;
  num: number;
  den: number;
  /** Where the bar that holds `ppq` starts, in quarter notes. */
  bar: number;
}

/** What a load gives back: the plugin's name, or why it could not load. */
export type EngineLoadResult = { ok: true; name: string } | { ok: false; error: string };

/** While the engine looks for plugins: the file it is on and how far it is (0 to 1). */
export interface EngineScanProgress {
  file: string;
  progress: number;
}

/** The answer to "which plugins are there": the list, when it was last looked for, or why not. */
export interface EnginePluginList {
  plugins: EnginePlugin[];
  /** Last full scan, ms since the epoch, or null if never. */
  scannedAt?: number | null;
  error?: string;
}

/** Where the engine looks for plugins (Ajustes › Plugins). */
export interface PluginFolders {
  /** The system's VST3 folders: always searched. */
  system: string[];
  /** Added by the user; they can be removed. */
  user: string[];
}
