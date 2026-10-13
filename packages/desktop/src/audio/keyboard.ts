/**
 * The computer keyboard as a piano (ESPEC_PIANO_ROLL.md, 8.2).
 *
 * Physical keys (KeyboardEvent.code), so it works the same with Spanish, English or French layouts.
 * A S D F G H J K L = white keys from C to the D of the next octave; W E T Y U O P = black keys.
 * Z / X = octave down / up; C / V = velocity down / up.
 */

/** Semitone offset from the C of the current octave, by physical key. */
export const NOTE_KEYS: Readonly<Record<string, number>> = {
  KeyA: 0, // C
  KeyW: 1, // C#
  KeyS: 2, // D
  KeyE: 3, // D#
  KeyD: 4, // E
  KeyF: 5, // F
  KeyT: 6, // F#
  KeyG: 7, // G
  KeyY: 8, // G#
  KeyH: 9, // A
  KeyU: 10, // A#
  KeyJ: 11, // B
  KeyK: 12, // C
  KeyO: 13, // C#
  KeyL: 14, // D
  KeyP: 15, // D#
};

export const MIN_BASE = 12; // C0
export const MAX_BASE = 96; // C7 (the top keys reach D#8)
export const VELOCITY_STEP = 10;

export interface KeyboardState {
  /** MIDI note of the C under the A key. 60 = C4 (middle C). */
  base: number;
  velocity: number;
}

export const INITIAL_KEYBOARD: KeyboardState = { base: 60, velocity: 90 };

export type KeyAction =
  | { type: "note"; note: number }
  | { type: "octave"; state: KeyboardState }
  | { type: "velocity"; state: KeyboardState }
  | null;

/** Decides what a key does in piano mode. Modifier combinations are never notes (Ctrl+C must still copy). */
export function keyAction(code: string, state: KeyboardState, mods: { ctrl: boolean; meta: boolean; alt: boolean }): KeyAction {
  if (mods.ctrl || mods.meta || mods.alt) return null;
  const offset = NOTE_KEYS[code];
  if (offset !== undefined) return { type: "note", note: state.base + offset };
  switch (code) {
    case "KeyZ":
      return { type: "octave", state: { ...state, base: Math.max(MIN_BASE, state.base - 12) } };
    case "KeyX":
      return { type: "octave", state: { ...state, base: Math.min(MAX_BASE, state.base + 12) } };
    case "KeyC":
      return { type: "velocity", state: { ...state, velocity: Math.max(1, state.velocity - VELOCITY_STEP) } };
    case "KeyV":
      return { type: "velocity", state: { ...state, velocity: Math.min(127, state.velocity + VELOCITY_STEP) } };
    default:
      return null;
  }
}

const NAMES_ES = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];

/** Latin note name with middle C = Do4 (DIRECCION_ARTISTICA.md, 10). */
export function noteNameEs(midi: number): string {
  return `${NAMES_ES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** True for Ctrl/Cmd + K, the toggle for piano mode. */
export function isPianoToggle(e: { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): boolean {
  return e.code === "KeyK" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
}
