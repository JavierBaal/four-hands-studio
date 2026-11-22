// Starts the real Electron app with a clean home, the way someone opens it the first time: it opens
// a copy of the demo song. Then it imports Dilatación, edits, autosaves, plays, closes (saving what
// was pending) and reopens.
// Usage (Linux without a screen): node build.mjs && xvfb-run -a node scripts/arranque.mjs [SoundFont path]
import { _electron as electron } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "fh-home-"));
const electronPath = path.join(appDir, "..", "..", "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, ".config"), FH_LANG: "es" };
if (process.argv[2]) env.FH_SOUNDFONT = process.argv[2];
const DILATACION = path.join(appDir, "..", "core", "test-data", "Dilatacion.mid");
const launch = (...files) => electron.launch({ executablePath: electronPath, args: [".", "--no-sandbox", ...files], cwd: appDir, env });

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(ok ? "ok  " : "FAIL", name, ok ? "" : detail);
  if (!ok) failures.push(name);
};
const title = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());

const errors = [];
// First run: a copy of the demo in the songs folder; the one inside the app stays as it was.
let app = await launch();
let win = await app.firstWindow();
win.on("pageerror", (e) => errors.push(String(e)));
await win.waitForSelector(".topbar", { timeout: 30000 });
await win.waitForTimeout(1500);
check("first run opens the demo", (await title(app)) === "Invasion (demo) · Four Hands Studio", await title(app));
const songsDir = [path.join(home, "Documents", "Four Hands"), path.join(home, "Four Hands")].find((d) => fs.existsSync(d));
const demoCopy = songsDir && path.join(songsDir, "Invasion (demo).fourhands");
check("the demo is a copy in the songs folder", !!demoCopy && fs.existsSync(demoCopy));
await app.close();
check("the bundled demo is untouched", fs.readFileSync(path.join(appDir, "dist", "Invasion.fourhands"), "utf8") === fs.readFileSync(path.join(appDir, "demo", "Invasion.fourhands"), "utf8"));

// A MIDI file opened from outside: imported next to the other songs, edited, saved and reopened.
app = await launch(DILATACION);
win = await app.firstWindow();
win.on("pageerror", (e) => errors.push(String(e)));
await win.waitForSelector(".topbar", { timeout: 30000 });
await win.waitForTimeout(1500);
check("window title is the song's", (await title(app)) === "Dilatacion · Four Hands Studio", await title(app));
const file = songsDir && path.join(songsDir, "Dilatacion.fourhands");
check("imports Dilatación", !!file && fs.existsSync(file));
const grid = await win.locator(".pgrid canvas:not(.playhead-layer)").boundingBox();
await win.mouse.dblclick(grid.x + 300, grid.y + 10); // top rows: no notes or ghosts of Dilatación there
await win.waitForTimeout(1600);
let saved = JSON.parse(fs.readFileSync(file, "utf8"));
check("autosaves within a second", Object.keys(saved.song.notes).length === 1025, Object.keys(saved.song.notes).length);
if (process.argv[2]) {
  // With sound, the label tells the state (15/10/2026): "Todo guardado", and Ctrl+S saves at once.
  await win.waitForTimeout(3600);
  check("label says everything is saved", (await win.locator(".saved").textContent()) === "Todo guardado", await win.locator(".saved").textContent());
  const before = fs.statSync(file).mtimeMs;
  await win.waitForTimeout(50);
  await win.keyboard.press("Control+s");
  await win.waitForTimeout(400);
  check("Ctrl+S saves now", fs.statSync(file).mtimeMs > before && (await win.locator(".saved").textContent()) === "Guardado", await win.locator(".saved").textContent());
}
await win.keyboard.press("Space");
await win.waitForTimeout(2000);
await win.keyboard.press("Space");
await win.keyboard.press("Control+z");
await win.waitForTimeout(100);
await app.close();
saved = JSON.parse(fs.readFileSync(file, "utf8"));
check("saves on quit", Object.keys(saved.song.notes).length === 1024 && saved.history.length === 2);
// The note was added and undone: on saving, that step is marked dropped (docs/architecture.md, 5.1).
check("the undone step is saved as dropped", saved.history.some((h) => h.kind === "edit" && h.dropped));
app = await launch();
win = await app.firstWindow();
await win.waitForSelector(".topbar", { timeout: 30000 });
await win.waitForTimeout(800);
check("reopens the last song", (await title(app)) === "Dilatacion · Four Hands Studio", await title(app));
check("a dropped step is not listed in the next session", (await win.locator(".hist .hi").count()) === 0, await win.locator(".hist .hi").count());
await app.close();
// The log goes next to recursos/ in a development checkout that has it, otherwise to the app's data folder.
const logFiles = [path.join(home, ".config", "Four Hands Studio", "registro-app.jsonl"), path.resolve(appDir, "..", "..", "..", "registro-app.jsonl")];
const log = fs.readFileSync(logFiles.find((f) => fs.existsSync(f)), "utf8");
if (process.argv[2]) check("sound loads", /"type":"sound_ready"/.test(log));
check("no page errors", errors.length === 0, errors.join("\n"));
fs.rmSync(home, { recursive: true, force: true });
process.exit(failures.length ? 1 : 0);
