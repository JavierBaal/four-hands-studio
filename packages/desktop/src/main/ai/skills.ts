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
 *
 * The user turns skills on and off in the window (Skills de la IA); a skill that is off is not listed
 * to the AI and cannot be loaded. They also import a skill as a ZIP, the same file Claude takes.
 */
import fs from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";

export type SkillOrigin = "built-in" | "user";

export interface SkillInfo {
  name: string;
  description: string;
  origin: SkillOrigin;
  dir: string;
  /** Reference files relative to the skill folder, with '/' (e.g. 'references/dark-synth.md'). */
  files: string[];
}

/** What the window shows: every skill, on or off. */
export interface SkillCard {
  name: string;
  description: string;
  origin: SkillOrigin;
  enabled: boolean;
  /** A user skill with the name of a built-in one, which it replaces. */
  replacesBuiltIn: boolean;
  files: number;
}

export type SkillImportProblem = "badZip" | "noSkill" | "noName" | "tooBig";

export class SkillImportError extends Error {
  constructor(readonly problem: SkillImportProblem) {
    super(problem);
  }
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
  constructor(
    private readonly folders: { builtIn?: string; user?: string },
    /** Names of the skills the user turned off. */
    private readonly disabled: () => string[] = () => [],
  ) {}

  /** Every skill, the user's replacing built-in ones with their name; the basics first, then by name. */
  private all(): { skills: SkillInfo[]; replaced: Set<string> } {
    const byName = new Map<string, SkillInfo>();
    const replaced = new Set<string>();
    for (const s of readSkills(this.folders.builtIn, "built-in")) byName.set(fold(s.name), s);
    for (const s of readSkills(this.folders.user, "user")) {
      if (byName.get(fold(s.name))?.origin === "built-in") replaced.add(fold(s.name));
      byName.set(fold(s.name), s);
    }
    const rank = (s: SkillInfo) => (s.name === "four-hands-basics" ? 0 : 1);
    return { skills: [...byName.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)), replaced };
  }

  private isOff(name: string): boolean {
    return this.disabled().some((n) => fold(n) === fold(name));
  }

  /** What the AI sees: the skills that are on. */
  list(): SkillInfo[] {
    return this.all().skills.filter((s) => !this.isOff(s.name));
  }

  /** What the window shows. */
  catalog(): SkillCard[] {
    const { skills, replaced } = this.all();
    return skills.map((s) => ({
      name: s.name,
      description: s.description,
      origin: s.origin,
      enabled: !this.isOff(s.name),
      replacesBuiltIn: replaced.has(fold(s.name)),
      files: s.files.length,
    }));
  }

  load(name: string, file?: string): { skill: SkillInfo; text: string } {
    const skills = this.list();
    const skill = skills.find((s) => fold(s.name) === fold(name));
    if (!skill) {
      if (this.isOff(name) && this.all().skills.some((s) => fold(s.name) === fold(name))) {
        throw new SkillError(`The user turned off the skill '${name}' in Four Hands. Don't use it unless they turn it on again.`);
      }
      throw new SkillError(`There is no skill '${name}'. Skills: ${skills.map((s) => s.name).join(", ") || "none"}`);
    }
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

// ---------------------------------------------------------------------------
// Importing a ZIP (the same file Claude takes in Customize > Skills)

const MAX_ZIP_BYTES = 5 * 1024 * 1024;
const MAX_ZIP_FILES = 200;

/**
 * Unpacks a skill into the user's folder, under its name. The ZIP holds one skill: a SKILL.md with a
 * name and a description, at the top or inside one folder. An existing user skill with that name is
 * replaced. Nothing outside the skill's folder is ever written.
 */
export function importSkillZip(zip: Uint8Array, userDir: string): { name: string; replaced: boolean } {
  if (zip.byteLength > MAX_ZIP_BYTES) throw new SkillImportError("tooBig");
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    throw new SkillImportError("badZip");
  }
  const names = Object.keys(entries).filter((n) => !n.endsWith("/") && !n.split("/").some((part) => part === "__MACOSX" || part.startsWith(".")));
  if (names.length > MAX_ZIP_FILES || names.reduce((sum, n) => sum + entries[n]!.byteLength, 0) > MAX_ZIP_BYTES * 4) throw new SkillImportError("tooBig");
  // The shallowest SKILL.md is the skill; its folder is the root.
  const skillFile = names.filter((n) => /(^|\/)SKILL\.md$/.test(n)).sort((a, b) => a.split("/").length - b.split("/").length)[0];
  if (!skillFile) throw new SkillImportError("noSkill");
  const root = skillFile.slice(0, -"SKILL.md".length);
  const { meta } = parseSkillFile(new TextDecoder().decode(entries[skillFile]));
  const name = (meta.name ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  if (!name || !meta.description?.trim()) throw new SkillImportError("noName");

  const target = path.join(userDir, name);
  const temp = path.join(userDir, `.importando-${name}-${process.pid}`);
  fs.rmSync(temp, { recursive: true, force: true });
  try {
    for (const entry of names) {
      if (!entry.startsWith(root)) continue;
      const rel = path.posix.normalize(entry.slice(root.length));
      if (!rel || rel.startsWith("..") || path.posix.isAbsolute(rel)) continue;
      const out = path.join(temp, ...rel.split("/"));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, entries[entry]!);
    }
    const replaced = fs.existsSync(target);
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(temp, target);
    return { name, replaced };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
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
