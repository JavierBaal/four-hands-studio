// Starts the real Electron app with a clean home, the way someone opens it the first time:
// imports Dilatación, edits, autosaves, plays, closes (saving what was pending) and reopens.
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
const launch = () => electron.launch({ executablePath: electronPath, args: [".", "--no-sandbox"], cwd: appDir, env });

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(ok ? "ok  " : "FAIL", name, ok ? "" : detail);
  if (!ok) failures.push(name);
};
const title = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());

let app = await launch();
let win = await app.firstWindow();
const errors = [];
win.on("pageerror", (e) => errors.push(String(e)));
await win.waitForSelector(".topbar", { timeout: 30000 });
await win.waitForTimeout(1500);
check("window title is the song's", (await title(app)) === "Dilatacion · Four Hands Studio", await title(app));
const songsDir = [path.join(home, "Documents", "Four Hands"), path.join(home, "Four Hands")].find((d) => fs.existsSync(d));
const file = songsDir && path.join(songsDir, "Dilatacion.fourhands");
check("first run imports Dilatación", !!file && fs.existsSync(file));
const grid = await win.locator(".pgrid canvas:not(.playhead-layer)").boundingBox();
await win.mouse.dblclick(grid.x + 300, grid.y + 150);
await win.waitForTimeout(1600);
let saved = JSON.parse(fs.readFileSync(file, "utf8"));
check("autosaves within a second", Object.keys(saved.song.notes).length === 1025);
await win.keyboard.press("Space");
await win.waitForTimeout(2000);
await win.keyboard.press("Space");
await win.keyboard.press("Control+z");
await win.waitForTimeout(100);
await app.close();
saved = JSON.parse(fs.readFileSync(file, "utf8"));
check("saves on quit", Object.keys(saved.song.notes).length === 1024 && saved.history.length === 2);
app = await launch();
win = await app.firstWindow();
await win.waitForSelector(".topbar", { timeout: 30000 });
await win.waitForTimeout(800);
check("reopens the last song with its history", (await win.locator(".hist .hi").count()) === 2);
await app.close();
const log = fs.readFileSync(path.join(home, ".config", "Four Hands Studio", "registro-app.jsonl"), "utf8");
if (process.argv[2]) check("sound loads", /"type":"sound_ready"/.test(log));
check("no page errors", errors.length === 0, errors.join("\n"));
fs.rmSync(home, { recursive: true, force: true });
process.exit(failures.length ? 1 : 0);
