// Packages Four Hands Studio for installing: a Windows installer (NSIS) by default, or the unpacked
// app with --dir (any system; used to check the packaged layout).
//
//   node scripts/package.mjs --engine <folder with "Four Hands Engine.exe"> --soundfonts <folder with the banks>
//
// Options: --dir (unpacked app, no installer), --no-engine, --no-sounds (for tests only: the installer
// a user gets always has both). Run `npm run build:bridge` first: the bridge (.mcpb) travels inside.
//
// What the installed app finds next to itself (process.resourcesPath; src/main/main.ts):
//   engine/       the native audio engine
//   soundfonts/   MuseScore_General.sf3, Sonatina_Symphonic_Orchestra.sf2, YDP-GrandPiano-20160804.sf2
//   fourhands-mcp-<version>.mcpb   the bridge, for Help > Connect with Claude
//   licenses/     the licences of Four Hands, the engine and the sound banks
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as builder, Platform } from "electron-builder";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const repo = path.resolve(pkgDir, "..", "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

/** The banks the installer ships; the demo song uses all three (src/main/demo.test.ts). */
export const SOUND_BANKS = ["MuseScore_General.sf3", "Sonatina_Symphonic_Orchestra.sf2", "YDP-GrandPiano-20160804.sf2"];
const ENGINE_EXE = process.platform === "win32" ? "Four Hands Engine.exe" : "Four Hands Engine";

function fail(message) {
  console.error(`package: ${message}`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const electronVersion = JSON.parse(fs.readFileSync(path.join(repo, "node_modules", "electron", "package.json"), "utf8")).version;

// What goes in: checked before anything is built.
const engineDir = flag("--no-engine") ? null : option("--engine") ?? process.env.FH_PACKAGE_ENGINE;
if (!flag("--no-engine") && !(engineDir && fs.existsSync(path.join(engineDir, ENGINE_EXE)))) {
  fail(`the engine is not in ${engineDir ?? "(no --engine)"}: build it first (BUILDING.md, 3) or pass --no-engine`);
}
const soundDir = flag("--no-sounds") ? null : option("--soundfonts") ?? process.env.FH_PACKAGE_SOUNDFONTS;
if (!flag("--no-sounds")) {
  const missing = SOUND_BANKS.filter((f) => !(soundDir && fs.existsSync(path.join(soundDir, f))));
  if (missing.length) fail(`missing sound banks in ${soundDir ?? "(no --soundfonts)"}: ${missing.join(", ")} (BUILDING.md, 2)`);
}
const bridgeDir = path.join(repo, "packages", "bridge", "dist");
const mcpb = fs.existsSync(bridgeDir) ? fs.readdirSync(bridgeDir).filter((f) => /^fourhands-mcp-.*\.mcpb$/.test(f)).sort().pop() : undefined;
if (!mcpb) fail("the bridge is not built: run `npm run build:bridge` first");

// The app: a fresh build, staged with a package.json of its own. Everything it runs is bundled in
// dist/, so the staged app has no node_modules.
console.log("Building the app…");
execFileSync(process.execPath, [path.join(pkgDir, "build.mjs")], { cwd: pkgDir, stdio: "inherit" });
const out = path.join(pkgDir, "out");
const stage = path.join(out, "app");
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.cpSync(path.join(pkgDir, "dist"), path.join(stage, "dist"), {
  recursive: true,
  filter: (src) => !src.endsWith(".map") && !src.includes(`${path.sep}harness`),
});
fs.writeFileSync(
  path.join(stage, "package.json"),
  JSON.stringify(
    {
      name: "four-hands-studio",
      productName: "Four Hands Studio",
      version: pkg.version,
      description: "Compose MIDI four-handed with your own AI.",
      author: "Fran Barbero and the Four Hands Studio contributors",
      license: "MIT",
      homepage: "https://github.com/JavierBaal/four-hands-studio",
      type: "module",
      main: "dist/main.mjs",
    },
    null,
    2,
  ),
);

// Licences shown with the installed app.
const licenses = path.join(out, "licenses");
fs.rmSync(licenses, { recursive: true, force: true });
fs.mkdirSync(licenses, { recursive: true });
fs.copyFileSync(path.join(repo, "LICENSE"), path.join(licenses, "LICENSE.txt"));
fs.copyFileSync(path.join(repo, "engine", "LICENSE"), path.join(licenses, "LICENSE-engine-AGPL-3.0.txt"));
fs.copyFileSync(path.join(repo, "THIRD_PARTY_NOTICES.md"), path.join(licenses, "THIRD_PARTY_NOTICES.md"));
fs.cpSync(path.join(pkgDir, "installer", "licenses"), path.join(licenses, "soundfonts"), { recursive: true });

const extraResources = [
  { from: path.join(bridgeDir, mcpb), to: mcpb },
  { from: licenses, to: "licenses" },
];
if (engineDir) extraResources.push({ from: engineDir, to: "engine", filter: [ENGINE_EXE] });
if (soundDir) extraResources.push({ from: soundDir, to: "soundfonts", filter: SOUND_BANKS });

const target = flag("--dir") ? "dir" : "nsis";
const platform = process.platform === "win32" ? Platform.WINDOWS : process.platform === "darwin" ? Platform.MAC : Platform.LINUX;
console.log(`Packaging Four Hands Studio ${pkg.version} (Electron ${electronVersion}, ${target})…`);
await builder({
  targets: platform.createTarget(target),
  // Never publish from here: releases are drafted by the workflow, and published by a person.
  publish: "never",
  config: {
    appId: "com.fourhandsstudio.app",
    productName: "Four Hands Studio",
    copyright: "Copyright © 2026 Fran Barbero and the Four Hands Studio contributors",
    electronVersion,
    directories: { app: stage, output: path.join(out, "installer"), buildResources: path.join(pkgDir, "installer") },
    files: ["**/*"],
    npmRebuild: false,
    asar: true,
    extraResources,
    fileAssociations: [{ ext: "fourhands", name: "Four Hands Studio song", description: "Four Hands Studio song", role: "Editor" }],
    win: { target: target === "dir" ? "dir" : "nsis", icon: path.join(pkgDir, "installer", "icon.png") },
    linux: { target: "dir", icon: path.join(pkgDir, "installer", "icon.png"), category: "AudioVideo" },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: "Four Hands Studio",
      artifactName: "Four-Hands-Studio-Setup-${version}.${ext}",
      license: path.join(licenses, "LICENSE.txt"),
    },
    publish: null,
  },
});
console.log(`Done: ${path.relative(process.cwd(), path.join(out, "installer"))}`);
