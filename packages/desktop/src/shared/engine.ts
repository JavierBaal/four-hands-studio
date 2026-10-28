/**
 * The native engine as the window sees it (fase 2, prueba S2; ESTUDIO_FASE2_MOTOR.md, 3). The
 * main process starts the engine and talks to it; the window asks for plugins, loads them into
 * slots (one per track, the track's MIDI channel) and sends MIDI ahead of time.
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

/** A plugin the engine found on this computer. */
export interface EnginePlugin {
  id: string;
  name: string;
  vendor: string;
  category: string;
  format: string;
  instrument: boolean;
}

/** One MIDI event for a slot, `delay` seconds after the engine receives it. */
export interface EngineMidiEvent {
  slot: number;
  delay: number;
  data: number[];
}

/** What a load gives back: the plugin's name, or why it could not load. */
export type EngineLoadResult = { ok: true; name: string } | { ok: false; error: string };
