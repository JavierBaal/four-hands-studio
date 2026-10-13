import { describe, expect, it } from "vitest";
import { PROMPTS, TOOLS } from "./index.js";

describe("tool definitions", () => {
  it("have unique snake_case names", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("all declare annotations (required by the Claude extensions directory)", () => {
    for (const t of TOOLS) {
      expect(typeof t.annotations.readOnlyHint).toBe("boolean");
      expect(typeof t.annotations.destructiveHint).toBe("boolean");
    }
  });

  it("point_to promises not to move the user's view", () => {
    const pointTo = TOOLS.find((t) => t.name === "point_to");
    expect(pointTo?.description).toMatch(/does NOT move the user's view/);
  });

  it("prompts render with their arguments", () => {
    expect(PROMPTS[0]?.render({ feeling: "coming home" })).toContain("coming home");
  });
});
