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

  it("read tools are read-only and only delete_notes is destructive", () => {
    const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t.annotations]));
    for (const n of ["get_song_overview", "get_user_context", "read_notes", "point_to"]) expect(byName[n]?.readOnlyHint).toBe(true);
    for (const n of ["begin_intervention", "add_notes", "delete_notes", "end_intervention"]) expect(byName[n]?.readOnlyHint).toBe(false);
    expect(TOOLS.filter((t) => t.annotations.destructiveHint).map((t) => t.name)).toEqual(["delete_notes"]);
  });

  it("write tools need an intervention", () => {
    for (const n of ["add_notes", "delete_notes", "end_intervention"]) {
      expect(Object.keys(TOOLS.find((t) => t.name === n)?.inputSchema ?? {})).toContain("intervention_id");
    }
  });

  it("begin_intervention announces the 5-minute auto close", () => {
    expect(TOOLS.find((t) => t.name === "begin_intervention")?.description).toMatch(/5 minutes/);
  });

  it("point_to promises not to move the user's view", () => {
    const pointTo = TOOLS.find((t) => t.name === "point_to");
    expect(pointTo?.description).toMatch(/does NOT move the user's view/);
  });

  it("prompts render with their arguments", () => {
    expect(PROMPTS[0]?.render({ feeling: "coming home" })).toContain("coming home");
  });
});
