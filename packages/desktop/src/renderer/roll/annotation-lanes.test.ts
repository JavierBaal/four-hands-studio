import { describe, expect, it } from "vitest";
import { MAX_LANES, labelWidth, layoutAnnotations } from "./annotation-lanes.js";

describe("annotation lanes (20/10/2026: no overlaps)", () => {
  it("puts annotations that would touch in different lanes, and the rest back in the first", () => {
    const l = layoutAnnotations(
      [
        { id: "a1", x0: 0, x1: 800, text: "Concepto: orquesta infectada" },
        { id: "a2", x0: 100, x1: 160, text: "Hueco antes del bajo" },
        { id: "a3", x0: 120, x1: 140, text: "otra" },
        { id: "a4", x0: 900, x1: 950, text: "Corte" },
      ],
      1000,
    );
    const lane = Object.fromEntries(l.boxes.map((b) => [b.id, b.lane]));
    expect(lane).toEqual({ a1: 0, a2: 1, a3: 2, a4: 0 });
    expect(l.lanes).toBe(3);
    // No two boxes in the same lane overlap.
    for (const a of l.boxes) for (const b of l.boxes) if (a !== b && a.lane === b.lane) expect(a.left + a.width <= b.left || b.left + b.width <= a.left).toBe(true);
  });

  it("gives a short annotation the width of its words, and a long one its span", () => {
    const l = layoutAnnotations(
      [
        { id: "short", x0: 10, x1: 30, text: "que respire" },
        { id: "long", x0: 300, x1: 900, text: "Disolución" },
      ],
      1000,
    );
    const short = l.boxes.find((b) => b.id === "short")!;
    expect(short.width).toBe(labelWidth("que respire"));
    expect(short.spanWidth).toBe(20);
    expect(l.boxes.find((b) => b.id === "long")!.width).toBe(600);
  });

  it("counts what does not fit instead of drawing it on top", () => {
    const items = Array.from({ length: MAX_LANES + 2 }, (_, i) => ({ id: `a${i}`, x0: 0, x1: 100, text: "x" }));
    const l = layoutAnnotations(items, 1000);
    expect(l.lanes).toBe(MAX_LANES);
    expect(l.hidden.map((h) => h.id)).toHaveLength(2);
  });

  it("keeps an annotation that began before the visible bars, cut at the edge", () => {
    const l = layoutAnnotations([{ id: "a", x0: -200, x1: 300, text: "Lumon" }], 1000);
    expect(l.boxes[0]).toMatchObject({ left: 0, width: 300, cutLeft: true });
    expect(layoutAnnotations([{ id: "b", x0: -200, x1: -10, text: "fuera" }], 1000).boxes).toHaveLength(0);
  });
});
