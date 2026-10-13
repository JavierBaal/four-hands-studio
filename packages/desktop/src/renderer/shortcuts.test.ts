import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTCUTS, actionFor, type KeyLike } from "./shortcuts.js";

const key = (k: Partial<KeyLike>): KeyLike => ({ key: "", code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...k });

describe("shortcuts", () => {
  it("resolve Ctrl on Windows and Cmd on Mac", () => {
    expect(actionFor(key({ key: "z", code: "KeyZ", ctrlKey: true }), DEFAULT_SHORTCUTS, false)).toBe("undo");
    expect(actionFor(key({ key: "z", code: "KeyZ", metaKey: true }), DEFAULT_SHORTCUTS, true)).toBe("undo");
    expect(actionFor(key({ key: "z", code: "KeyZ", ctrlKey: true }), DEFAULT_SHORTCUTS, true)).toBeNull();
  });

  it("tell modifiers apart", () => {
    expect(actionFor(key({ key: "Z", code: "KeyZ", ctrlKey: true, shiftKey: true }), DEFAULT_SHORTCUTS, false)).toBe("redo");
    expect(actionFor(key({ code: "ArrowUp", shiftKey: true }), DEFAULT_SHORTCUTS, false)).toBe("octaveUp");
    expect(actionFor(key({ code: "ArrowUp" }), DEFAULT_SHORTCUTS, false)).toBe("transposeUp");
    expect(actionFor(key({ code: "ArrowLeft", altKey: true }), DEFAULT_SHORTCUTS, false)).toBe("nudgeLeft");
  });

  it("match letters by character and digits by key position", () => {
    expect(actionFor(key({ key: "q", code: "KeyA" }), DEFAULT_SHORTCUTS, false)).toBe("quantize"); // AZERTY
    expect(actionFor(key({ key: "&", code: "Digit1" }), DEFAULT_SHORTCUTS, false)).toBe("toolArrow"); // AZERTY
    expect(actionFor(key({ key: "k", code: "KeyK", ctrlKey: true }), DEFAULT_SHORTCUTS, false)).toBe("pianoMode");
    expect(actionFor(key({ key: "Delete", code: "Delete" }), DEFAULT_SHORTCUTS, false)).toBe("delete");
  });
});
