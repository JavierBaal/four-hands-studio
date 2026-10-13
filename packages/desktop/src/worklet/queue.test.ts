import { describe, expect, it } from "vitest";
import { EventQueue, renderBlock } from "./queue.js";

describe("EventQueue", () => {
  it("keeps events sorted by frame and stable for equal frames", () => {
    const q = new EventQueue<string>();
    q.push(300, "c");
    q.push(100, "a");
    q.push(100, "b");
    q.push(200, "x");
    const out: string[] = [];
    while (q.size) out.push(q.shift()!.value);
    expect(out).toEqual(["a", "b", "x", "c"]);
  });
});

describe("renderBlock", () => {
  it("renders up to each event and applies it at its exact offset", () => {
    const q = new EventQueue<string>();
    q.push(1000 + 40, "on");
    q.push(1000 + 100, "off");
    q.push(1000 + 200, "next-block");
    const log: string[] = [];
    renderBlock(
      q,
      1000,
      128,
      (s, c) => log.push(`render ${s}+${c}`),
      (v) => log.push(v),
    );
    expect(log).toEqual(["render 0+40", "on", "render 40+60", "off", "render 100+28"]);
    expect(q.size).toBe(1);
  });

  it("applies late events at the start of the block and reports them", () => {
    const q = new EventQueue<string>();
    q.push(900, "late");
    const late: number[] = [];
    const log: string[] = [];
    renderBlock(q, 1000, 128, (s, c) => log.push(`render ${s}+${c}`), (v) => log.push(v), (_v, f) => late.push(f));
    expect(log).toEqual(["late", "render 0+128"]);
    expect(late).toEqual([100]);
  });
});
