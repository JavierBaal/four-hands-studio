import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillError, SkillLibrary, parseSkillFile, skillsFooter } from "./skills.js";

const REPO_SKILLS = path.resolve(__dirname, "../../../../../skills");
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fh-skills-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function write(rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

describe("SKILL.md front matter", () => {
  it("reads name and description, quoted or folded over several lines", () => {
    expect(parseSkillFile("---\nname: a\ndescription: \"Uno: dos\"\n---\n\n# A\n").meta).toEqual({ name: "a", description: "Uno: dos" });
    const folded = parseSkillFile("---\r\nname: b\r\ndescription: >\r\n  Primera línea\r\n  y segunda.\r\n---\r\nCuerpo");
    expect(folded.meta.description).toBe("Primera línea y segunda.");
    expect(folded.body).toBe("Cuerpo");
    expect(parseSkillFile("Sin cabecera").body).toBe("Sin cabecera");
  });

  // The app serves exactly what the repo ships: every built-in skill must have a name and a description.
  it("every built-in skill has a name matching its folder and a description", () => {
    const skills = new SkillLibrary({ builtIn: REPO_SKILLS }).list();
    expect(skills.map((s) => s.name)).toEqual(["four-hands-basics", "feelings-to-music", "listening-review", "orchestration-register", "styles"]);
    for (const s of skills) {
      expect(path.basename(s.dir)).toBe(s.name);
      expect(s.description.length, s.name).toBeGreaterThan(80);
      expect(s.description, s.name).not.toMatch(/^[>|]/);
    }
  });
});

describe("the library", () => {
  it("serves only text files inside the skill, and skips folders without SKILL.md", () => {
    write("b/a/SKILL.md", "---\nname: a\ndescription: A.\n---\nHola");
    write("b/a/references/uno.md", "Uno");
    write("b/a/scripts/run.py", "print(1)");
    write("b/a/.oculto.md", "x");
    write("b/vacia/notas.md", "x");
    write("b/secreto.md", "no");
    const lib = new SkillLibrary({ builtIn: path.join(root, "b") });
    const [a] = lib.list();
    expect(lib.list()).toHaveLength(1);
    expect(a!.files).toEqual(["references/uno.md"]);
    expect(lib.load("a").text).toBe("Hola");
    expect(lib.load("A", "references\\uno.md").text).toBe("Uno");
    expect(() => lib.load("a", "../secreto.md")).toThrow(SkillError);
    expect(() => lib.load("a", "scripts/run.py")).toThrow(/has no file/);
  });

  it("works with missing folders", () => {
    const lib = new SkillLibrary({ builtIn: path.join(root, "nada"), user: path.join(root, "tampoco") });
    expect(lib.list()).toEqual([]);
    expect(skillsFooter([])).toBe("");
    expect(() => lib.load("x")).toThrow(/Skills: none/);
  });
});
