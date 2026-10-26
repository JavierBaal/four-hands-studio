import { describe, expect, it } from "vitest";
import { PROMPTS, SERVER_INSTRUCTIONS, TOOLS } from "./index.js";

const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

const READ_ONLY = ["get_song_overview", "get_user_context", "read_notes", "analyze", "get_changes_since", "get_history", "summarize", "list_instruments", "list_skills", "load_skill", "point_to"];
const NEED_INTERVENTION = [
  "end_intervention",
  "write_expression",
  "add_notes",
  "edit_notes",
  "repitch_notes",
  "move_notes",
  "copy_notes",
  "delete_notes",
  "quantize_notes",
  "shape_velocities",
  "write_pedal",
  "set_harmony",
  "set_sections",
  "set_song_properties",
  "set_tempo_changes",
  "set_key_changes",
  "add_track",
  "update_track",
  "set_mix",
  "move_track",
  "remove_track",
  "annotate",
  "remove_annotations",
];

describe("tool definitions", () => {
  it("have unique snake_case names", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("all declare annotations and a short title (users read titles in Claude's settings)", () => {
    for (const t of TOOLS) {
      expect(typeof t.annotations.readOnlyHint).toBe("boolean");
      expect(typeof t.annotations.destructiveHint).toBe("boolean");
      expect(t.title.length).toBeLessThanOrEqual(28);
    }
  });

  // The annotations decide the permission group the user sees (PRUEBA_S1.md, conclusion 2).
  it("reading tools are read-only, the rest are writes, and only deleting notes or tracks is destructive", () => {
    expect(TOOLS.filter((t) => t.annotations.readOnlyHint).map((t) => t.name).sort()).toEqual([...READ_ONLY].sort());
    expect(TOOLS.filter((t) => t.annotations.destructiveHint).map((t) => t.name)).toEqual(["delete_notes", "remove_track", "remove_annotations"]);
  });

  it("every write tool needs an intervention", () => {
    for (const n of NEED_INTERVENTION) expect(Object.keys(byName[n]?.inputSchema ?? {}), n).toContain("intervention_id");
    expect(TOOLS.length).toBe(READ_ONLY.length + NEED_INTERVENTION.length + 1); // + begin_intervention
  });

  it("the instructions ask to load the basics skill before writing", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/load_skill\("four-hands-basics"\)/);
    expect(SERVER_INSTRUCTIONS).toMatch(/list_skills/);
    expect(byName.load_skill?.inputSchema).toHaveProperty("file");
  });

  it("analyze says it describes and does not judge, and the instructions ask to use it", () => {
    expect(byName.analyze?.description).toMatch(/does not judge/);
    expect(SERVER_INSTRUCTIONS).toMatch(/run analyze on what you touched/);
  });

  it("the instructions ask for honest opinions, whatever the tone (H4)", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/Honest opinions/);
    expect(SERVER_INSTRUCTIONS).toMatch(/never praise your own work/);
    expect(SERVER_INSTRUCTIONS).toMatch(/Don't change your opinion because the user insists/);
    expect(SERVER_INSTRUCTIONS).toMatch(/only the delivery\nchanges/);
    expect(SERVER_INSTRUCTIONS).not.toMatch(/never call the\s+user's choices errors/);
  });

  it("begin_intervention announces the 5-minute auto close", () => {
    expect(byName.begin_intervention?.description).toMatch(/5 minutes/);
  });

  it("point_to promises not to move the user's view", () => {
    expect(byName.point_to?.description).toMatch(/does NOT move the user's view/);
  });

  // The mandatory rules live in the tools, not in a skill (ESQUEMA_MCP.md, 9).
  it("the tools that move notes promise to keep the played deviation", () => {
    for (const n of ["move_notes", "repitch_notes", "copy_notes", "edit_notes"]) expect(byName[n]?.description, n).toMatch(/deviation/);
    expect(byName.quantize_notes?.description).toMatch(/only when the user asks/);
  });

  it("the tools that change existing notes protect the user's later edits", () => {
    for (const n of ["edit_notes", "repitch_notes", "move_notes", "delete_notes", "quantize_notes", "shape_velocities", "remove_track"]) {
      expect(byName[n]?.description, n).toMatch(/user changed after/);
      expect(Object.keys(byName[n]?.inputSchema ?? {}), n).toContain("base_revision");
    }
  });

  it("the AI never gets the user's listening tools (solo) and reads the mix before changing it", () => {
    expect(Object.keys(byName.set_mix?.inputSchema ?? {})).not.toContain("solo");
    expect(Object.keys(byName.update_track?.inputSchema ?? {})).not.toContain("solo");
    expect(byName.set_mix?.description).toMatch(/get_song_overview/);
    expect(byName.get_song_overview?.description).toMatch(/volume, pan, reverb and mute/);
  });

  it("no tool composes", () => {
    for (const t of TOOLS) expect(t.name).not.toMatch(/compose|generate|harmonize|variation|orchestrate/);
    expect(SERVER_INSTRUCTIONS).toMatch(/does not compose/);
  });

  it("the jury prompt loads the jury skill and changes nothing", () => {
    const jury = PROMPTS.find((p) => p.name === "call_the_jury")!;
    expect(jury.render({})).toMatch(/on the whole song: load_skill\("jury"\).*Do not change anything/);
    expect(jury.render({ range: "section:Coro" })).toContain("on section:Coro");
  });

  it("prompts render with their arguments", () => {
    expect(PROMPTS.find((p) => p.name === "compose_from_feelings")?.render({ feeling: "coming home" })).toContain("coming home");
  });
});
