import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { SkillError, SkillImportError, SkillLibrary, importSkillZip, parseSkillFile, skillsFooter } from "./skills.js";

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
    expect(skills.map((s) => s.name)).toEqual(["four-hands-basics", "feelings-to-music", "jury", "listening-review", "orchestration-register", "styles"]);
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

describe("turning skills off (Skills de la IA)", () => {
  it("a skill that is off is not listed to the AI and cannot be loaded, but the window still shows it", () => {
    write("b/a/SKILL.md", "---\nname: a\ndescription: A.\n---\nHola");
    write("b/b/SKILL.md", "---\nname: b\ndescription: B.\n---\nAdiós");
    write("u/b/SKILL.md", "---\nname: b\ndescription: Mi B.\n---\nLa mía");
    const off = ["a"];
    const lib = new SkillLibrary({ builtIn: path.join(root, "b"), user: path.join(root, "u") }, () => off);
    expect(lib.list().map((s) => s.name)).toEqual(["b"]);
    expect(() => lib.load("a")).toThrow(/The user turned off the skill 'a'/);
    expect(lib.catalog()).toEqual([
      { name: "a", description: "A.", origin: "built-in", enabled: false, replacesBuiltIn: false, files: 0 },
      { name: "b", description: "Mi B.", origin: "user", enabled: true, replacesBuiltIn: true, files: 0 },
    ]);
    off.length = 0;
    expect(lib.load("a").text).toBe("Hola");
  });
});

describe("importing a skill ZIP", () => {
  const skill = (name: string, extra: Record<string, Uint8Array> = {}) => ({ [`${name}/SKILL.md`]: strToU8(`---\nname: ${name}\ndescription: Una skill.\n---\n# ${name}\n`), ...extra });

  it("unpacks the skill folder under its name, references included, and replaces an older copy", () => {
    const user = path.join(root, "Skills");
    const zip = zipSync(skill("mi-armonia", { "mi-armonia/references/pedales.md": strToU8("Pedales"), "__MACOSX/mi-armonia/._SKILL.md": strToU8("x") }));
    expect(importSkillZip(zip, user)).toEqual({ name: "mi-armonia", replaced: false });
    expect(fs.readFileSync(path.join(user, "mi-armonia", "references", "pedales.md"), "utf8")).toBe("Pedales");
    expect(fs.existsSync(path.join(user, "__MACOSX"))).toBe(false);
    expect(importSkillZip(zipSync(skill("mi-armonia")), user)).toEqual({ name: "mi-armonia", replaced: true });
    expect(fs.existsSync(path.join(user, "mi-armonia", "references"))).toBe(false);
    expect(new SkillLibrary({ user }).load("mi-armonia").text).toBe("# mi-armonia");
    expect(fs.readdirSync(user)).toEqual(["mi-armonia"]);
  });

  it("takes a SKILL.md at the top of the ZIP and names the folder after the skill", () => {
    const user = path.join(root, "Skills");
    const zip = zipSync({ "SKILL.md": strToU8("---\nname: Mi Cuarteto\ndescription: Plantilla.\n---\nCuerpo"), "notas.md": strToU8("n") });
    expect(importSkillZip(zip, user).name).toBe("mi-cuarteto");
    expect(fs.readdirSync(path.join(user, "mi-cuarteto")).sort()).toEqual(["SKILL.md", "notas.md"]);
  });

  it("refuses what is not a skill, and never writes outside the skill folder", () => {
    const user = path.join(root, "Skills");
    const problem = (zip: Uint8Array) => {
      try {
        importSkillZip(zip, user);
        return "ok";
      } catch (e) {
        return e instanceof SkillImportError ? e.problem : String(e);
      }
    };
    expect(problem(strToU8("no es un zip"))).toBe("badZip");
    expect(problem(zipSync({ "leeme.md": strToU8("hola") }))).toBe("noSkill");
    expect(problem(zipSync({ "x/SKILL.md": strToU8("---\nname: x\n---\nsin descripción") }))).toBe("noName");
    expect(problem(zipSync(skill("evil", { "evil/../../fuera.md": strToU8("no") })))).toBe("ok");
    expect(fs.existsSync(path.join(root, "fuera.md"))).toBe(false);
    expect(fs.readdirSync(user)).toEqual(["evil"]);
  });
});
