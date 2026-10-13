import { USER, nominalGridPosition, type Note } from "@fourhands/core";
import { describe, expect, it } from "vitest";
import type { RollView } from "./geometry.js";
import {
  applyMove,
  changeCommands,
  clampMove,
  duplicateOffset,
  hitTest,
  inRect,
  moveDelta,
  neighbour,
  newNoteAt,
  pasteAt,
  pencilLength,
  quantize,
  resizeLeft,
  resizeRight,
  toClipboard,
  velocityAt,
} from "./edit.js";

const PPQ = 960;
const v: RollView = { startTick: 0, pxPerTick: 0.1, scrollY: (127 - 72) * 15, width: 1000, height: 400 };
const grid8 = { on: true, step: 480 };
const off = { on: false, step: 480 };

function note(id: string, pitch: number, start: number, duration: number, velocity = 80): Note {
  return { id, trackId: "t1", pitch, start, duration, velocity, createdBy: USER, shapedBy: USER };
}

describe("hit testing", () => {
  const n = note("n1", 70, 960, 960); // x 96–192, row of 70 at y 30–45
  it("tells body from edges (6 px each side)", () => {
    expect(hitTest([n], v, 140, 35)).toMatchObject({ zone: "body" });
    expect(hitTest([n], v, 99, 35)).toMatchObject({ zone: "left" });
    expect(hitTest([n], v, 188, 35)).toMatchObject({ zone: "right" });
    expect(hitTest([n], v, 140, 50)).toBeNull();
    expect(hitTest([n], v, 250, 35)).toBeNull();
  });
  it("gives small notes only a right edge", () => {
    const small = note("n2", 70, 960, 120); // 12 px
    expect(hitTest([small], v, 97, 35)).toMatchObject({ zone: "body" });
    expect(hitTest([small], v, 106, 35)).toMatchObject({ zone: "right" });
  });
  it("picks the topmost note when two overlap", () => {
    const a = note("a", 70, 960, 960);
    const b = note("b", 70, 1200, 960);
    expect(hitTest([a, b], v, 140, 35)!.note.id).toBe("b");
  });
});

describe("moving", () => {
  it("snaps the displacement, not the notes: each keeps its deviation", () => {
    const played = [note("a", 60, 960 + 17, 400), note("b", 62, 1440 - 11, 400)];
    const d = moveDelta(1000, 0.4, grid8, null); // ~2 steps
    expect(d).toEqual({ ticks: 960, semitones: 0 });
    const moved = applyMove(played, d);
    expect(moved.map((n) => nominalGridPosition(n.start).deviationTicks)).toEqual(played.map((n) => nominalGridPosition(n.start).deviationTicks));
  });
  it("limits the move to one direction with Shift", () => {
    expect(moveDelta(1000, 3, grid8, "time")).toEqual({ ticks: 960, semitones: 0 });
    expect(moveDelta(1000, 3, grid8, "pitch")).toEqual({ ticks: 0, semitones: 3 });
  });
  it("moves freely with the grid off", () => {
    expect(moveDelta(123.4, 0, off, null).ticks).toBe(123);
  });
  it("never moves notes before the start or out of range", () => {
    const ns = [note("a", 125, 200, 100), note("b", 3, 500, 100)];
    expect(clampMove(ns, { ticks: -900, semitones: 5 })).toEqual({ ticks: -200, semitones: 2 });
    expect(clampMove(ns, { ticks: 0, semitones: -9 })).toEqual({ ticks: 0, semitones: -3 });
  });
});

describe("resizing and creating (absolute grid)", () => {
  it("lands the dragged edge on a grid line", () => {
    const n = note("a", 60, 960 + 17, 400);
    expect(resizeRight(n, 2000, grid8)).toMatchObject({ start: 977, duration: 1920 - 977 });
    expect(resizeLeft(n, 500, grid8)).toMatchObject({ start: 480, duration: 977 + 400 - 480 });
  });
  it("never makes a note vanish", () => {
    const n = note("a", 60, 960, 480);
    expect(resizeRight(n, 900, grid8).duration).toBe(480);
    expect(resizeLeft(n, 5000, grid8)).toMatchObject({ start: 960, duration: 480 });
    expect(resizeLeft(n, 5000, off).duration).toBe(10);
  });
  it("creates on the grid line before the mouse, one step long", () => {
    expect(newNoteAt(1000, 64, grid8, 72)).toEqual({ pitch: 64, start: 960, duration: 480, velocity: 72 });
    expect(newNoteAt(1000, 64, off, 80)).toMatchObject({ start: 1000 });
  });
  it("lets the pencil drag the length in steps", () => {
    expect(pencilLength(960, 1700, grid8)).toBe(960);
    expect(pencilLength(960, 961, grid8)).toBe(480);
  });
});

describe("selection, quantize and clipboard", () => {
  const ns = [note("a", 72, 0, 480), note("b", 70, 960, 480), note("c", 60, 1920, 480)];
  it("selects what the rubber band touches", () => {
    expect(inRect(ns, v, { x0: 40, y0: 0, x1: 100, y1: 40 }).map((n) => n.id)).toEqual(["a", "b"]);
  });
  it("quantizes with strength and optionally the ends", () => {
    const loose = [note("a", 60, 960 + 40, 400)];
    expect(quantize(loose, 480, 1, false)[0]).toMatchObject({ start: 960, duration: 400 });
    expect(quantize(loose, 480, 0.5, false)[0]).toMatchObject({ start: 980 });
    expect(quantize(loose, 480, 1, true)[0]).toMatchObject({ start: 960, duration: 480 });
  });
  it("copies relative to the first note and pastes at the cursor", () => {
    expect(pasteAt(toClipboard([ns[2]!, ns[1]!]), 3840)).toEqual([
      { pitch: 70, start: 3840, duration: 480, velocity: 80 },
      { pitch: 60, start: 3840 + 960, duration: 480, velocity: 80 },
    ]);
  });
  it("duplicates right after the selection", () => {
    expect(duplicateOffset(ns, grid8)).toBe(2400);
    expect(duplicateOffset([note("x", 60, 100, 300)], grid8)).toBe(480);
  });
  it("walks notes in time", () => {
    expect(neighbour(ns, ns[0]!, 1)!.id).toBe("b");
    expect(neighbour(ns, ns[0]!, -1)!.id).toBe("a");
    expect(neighbour(ns, null, -1)!.id).toBe("c");
  });
  it("reads velocity from the lane", () => {
    expect(velocityAt(64 - 56, 64)).toBe(127);
    expect(velocityAt(64, 64)).toBe(1);
    expect(velocityAt(64 - 28, 64)).toBe(64);
  });
  it("sends only what changed", () => {
    const after = [{ ...ns[0]!, pitch: 74 }, ns[1]!];
    expect(changeCommands(ns.slice(0, 2), after)).toEqual([{ type: "updateNotes", changes: [{ id: "a", pitch: 74 }] }]);
    expect(changeCommands(ns, ns)).toEqual([]);
  });
});
