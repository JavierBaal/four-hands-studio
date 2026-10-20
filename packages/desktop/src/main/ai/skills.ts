/**
 * The skills Four Hands serves to the AI (ESTUDIO_SKILLS.md, 3 and 6).
 *
 * A skill is a folder with a SKILL.md (Agent Skills format: YAML front matter with name and description,
 * then the instructions) and optional reference files. Two places:
 * - built in: shipped with the app (the repo's skills/ folder, copied to dist/skills by build.mjs);
 * - the user's: Documents/Four Hands/Skills. A user skill with the same name replaces the built-in one.
 *
 * The folders are read on every call, so a skill the user drops in shows up without restarting.
 * Only text files are served: a skill's scripts cannot run here.
 */
import fs from "node:fs";
import path from "node:path";

export type SkillOrigin = "built-in" | "user";

export interface SkillInfo {
  name: string;
  description: string;
  origin: SkillOrigin;
  dir: string;
  /** Reference files relative to the skill folder, with '/' (e.g. 'references/dark-synth.md'). */
  files: string[];
}

export interface SkillSource {
  list(): SkillInfo[];
  /** The instructions (no file) or one reference file. Throws SkillError with a message for the AI. */
  load(name: string, file?: string): { skill: SkillInfo; text: string };
}

export class SkillError extends Error {}

const TEXT_FILE = /\.(md|txt)$/i;
/** A skill bigger than this is not a skill, it is a book. */
const MAX_CHARS = 60_000;
const MAX_DEPTH = 3;

/** Front matter of a SKILL.md: plain 'key: value' lines, quoted values and indented continuation lines. */
export function parseSkillFile(text: string): { meta: Record<string, string>; body: string } {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { meta: {}, body: text.trim() };
  const meta: Record<string, string> = {};
  let key: string | null = null;
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1]!;
      meta[key] = unquote(kv[2]!.trim()).replace(/^[>|][-+]?$/, "");
    } else if (key && /^\s+\S/.test(line)) {
      meta[key] = `${meta[key]} ${line.trim()}`.trim();
    }
  }
  return { meta, body: text.slice(m[0].length).trim() };
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) return value.slice(1, -1);
  return value;
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function textFiles(dir: string, rel = "", depth = 0): string[] {
  if (depth > MAX_DEPTH) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith(".")) continue;
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...textFiles(dir, child, depth + 1));
    else if (e.isFile() && TEXT_FILE.test(e.name) && child !== "SKILL.md") out.push(child);
  }
  return out;
}

function readSkills(root: string | undefined, origin: SkillOrigin): SkillInfo[] {
  if (!root) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: SkillInfo[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const dir = path.join(root, e.name);
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    const { meta } = parseSkillFile(text);
    skills.push({ name: (meta.name || e.name).trim(), description: (meta.description ?? "").trim(), origin, dir, files: textFiles(dir) });
  }
  return skills;
}

export class SkillLibrary implements SkillSource {
  constructor(private readonly folders: { builtIn?: string; user?: string }) {}

  list(): SkillInfo[] {
    const byName = new Map<string, SkillInfo>();
    for (const s of readSkills(this.folders.builtIn, "built-in")) byName.set(fold(s.name), s);
    for (const s of readSkills(this.folders.user, "user")) byName.set(fold(s.name), s);
    // The basics first, then by name.
    const rank = (s: SkillInfo) => (s.name === "four-hands-basics" ? 0 : 1);
    return [...byName.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }

  load(name: string, file?: string): { skill: SkillInfo; text: string } {
    const skills = this.list();
    const skill = skills.find((s) => fold(s.name) === fold(name));
    if (!skill) throw new SkillError(`There is no skill '${name}'. Skills: ${skills.map((s) => s.name).join(", ") || "none"}`);
    const wanted = file?.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!wanted || wanted === "SKILL.md") {
      const { body } = parseSkillFile(fs.readFileSync(path.join(skill.dir, "SKILL.md"), "utf8"));
      return { skill, text: cap(body) };
    }
    // Only the files the skill lists: no way out of its folder.
    const match = skill.files.find((f) => f === wanted) ?? skill.files.find((f) => fold(f) === fold(wanted) || fold(path.posix.basename(f)) === fold(wanted));
    if (!match) {
      throw new SkillError(`The skill '${skill.name}' has no file '${file}'. Files: ${skill.files.join(", ") || "none"}`);
    }
    return { skill, text: cap(fs.readFileSync(path.join(skill.dir, ...match.split("/")), "utf8").trim()) };
  }
}

function cap(text: string): string {
  return text.length <= MAX_CHARS ? text : `${text.slice(0, MAX_CHARS)}\n\n[Cut at ${MAX_CHARS} characters: the file is too long to serve whole.]`;
}

// ---------------------------------------------------------------------------
// Texts for the AI (compact, no structured content: ARQUITECTURA.md, 6.2)

const ORIGIN: Record<SkillOrigin, string> = { "built-in": "built in", user: "the user's" };

export function skillsListText(skills: SkillInfo[]): string {
  if (!skills.length) return "No skills installed.";
  const lines = [`Skills (${skills.length}). Load with load_skill(name); four-hands-basics at the start of every conversation. The user's skills win over the built-in ones.`];
  for (const s of skills) lines.push(`- ${s.name} (${ORIGIN[s.origin]}${s.files.length ? `, ${s.files.length} reference ${s.files.length === 1 ? "file" : "files"}` : ""}): ${s.description || "no description"}`);
  return lines.join("\n");
}

export function skillText(skill: SkillInfo, text: string, file?: string): string {
  if (file) return `Skill ${skill.name}, file ${file}:\n\n${text}`;
  const head = [`Skill ${skill.name} (${ORIGIN[skill.origin]}). Follow it.`];
  if (skill.files.length) head.push(`Reference files (load_skill with file when the instructions point to them): ${skill.files.join(", ")}`);
  return `${head.join("\n")}\n\n${text}`;
}

/** One line at the end of the overview, so a new conversation finds the skills even if it skipped the instructions. */
export function skillsFooter(skills: SkillInfo[]): string {
  if (!skills.length) return "";
  const basics = skills.some((s) => s.name === "four-hands-basics");
  return `Skills (list_skills): ${skills.map((s) => s.name).join(", ")}.${basics ? " Load four-hands-basics before you write anything in this conversation." : ""}`;
}
