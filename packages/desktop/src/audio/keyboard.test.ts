import { describe, expect, it } from "vitest";
import { INITIAL_KEYBOARD, isPianoToggle, keyAction, noteNameEs } from "./keyboard.js";

const none = { ctrl: false, meta: false, alt: false };

describe("computer keyboard as piano (ESPEC_PIANO_ROLL.md, 8.2)", () => {
  it("A is middle C and L is the D above the next C", () => {
    expect(keyAction("KeyA", INITIAL_KEYBOARD, none)).toEqual({ type: "note", note: 60 });
    expect(keyAction("KeyK", INITIAL_KEYBOARD, none)).toEqual({ type: "note", note: 72 });
    expect(keyAction("KeyL", INITIAL_KEYBOARD, none)).toEqual({ type: "note", note: 74 });
  });

  it("W E T Y U O P are the black keys", () => {
    const black = ["KeyW", "KeyE", "KeyT", "KeyY", "KeyU", "KeyO", "KeyP"].map((k) => {
      const a = keyAction(k, INITIAL_KEYBOARD, none);
      return a && a.type === "note" ? a.note % 12 : -1;
    });
    expect(black).toEqual([1, 3, 6, 8, 10, 1, 3]);
  });

  it("Z and X move by octaves within limits", () => {
    let s = INITIAL_KEYBOARD;
    for (let i = 0; i < 10; i++) {
      const a = keyAction("KeyZ", s, none);
      if (a?.type === "octave") s = a.state;
    }
    expect(s.base).toBe(12);
    const up = keyAction("KeyX", INITIAL_KEYBOARD, none);
    expect(up).toEqual({ type: "octave", state: { base: 72, velocity: 90 } });
  });

  it("C and V change the velocity within 1..127", () => {
    let s = { base: 60, velocity: 120 };
    const a = keyAction("KeyV", s, none);
    if (a?.type === "velocity") s = a.state;
    expect(s.velocity).toBe(127);
  });

  it("never turns a shortcut with Ctrl, Cmd or Alt into a note", () => {
    expect(keyAction("KeyC", INITIAL_KEYBOARD, { ...none, ctrl: true })).toBeNull();
    expect(keyAction("KeyA", INITIAL_KEYBOARD, { ...none, meta: true })).toBeNull();
  });

  it("leaves the keys of other shortcuts alone (R, Q, N, numbers, space)", () => {
    for (const k of ["KeyR", "KeyQ", "KeyN", "Digit1", "Space"]) expect(keyAction(k, INITIAL_KEYBOARD, none)).toBeNull();
  });

  it("Ctrl/Cmd + K toggles piano mode", () => {
    expect(isPianoToggle({ code: "KeyK", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(true);
    expect(isPianoToggle({ code: "KeyK", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe(false);
  });

  it("names notes in Latin with middle C = Do4", () => {
    expect(noteNameEs(60)).toBe("Do4");
    expect(noteNameEs(69)).toBe("La4");
    expect(noteNameEs(61)).toBe("Do#4");
  });
});
