/**
 * S0 · sound and latency spike (ARQUITECTURA.md, 12): Electron main process.
 *
 * Finds the SoundFont, hands it to the window, grants Web MIDI and writes the results
 * log next to the project documents so Claude can read it.
 */
import { app, BrowserWindow, dialog, ipcMain, session } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)); // packages/desktop/dist
const packageDir = path.resolve(here, "..");
const repoRoot = path.resolve(packageDir, "..", "..");
// On Fran's computer the repo lives in <project>/codigo, next to <project>/recursos.
const projectRoot = fs.existsSync(path.join(repoRoot, "..", "recursos")) ? path.resolve(repoRoot, "..") : null;

const SF_NAME = "MuseScore_General.sf3";

function findSoundFont(): string | null {
  const candidates = [
    process.env.FH_SOUNDFONT,
    projectRoot && path.join(projectRoot, "recursos", "soundfonts", SF_NAME),
    path.join(repoRoot, "recursos", "soundfonts", SF_NAME),
  ].filter((p): p is string => !!p);
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function logFile(): string {
  const dir = projectRoot ?? app.getPath("userData");
  return path.join(dir, "registro-s0.jsonl");
}

function appendLog(entry: unknown): void {
  try {
    fs.appendFileSync(logFile(), JSON.stringify({ t: new Date().toISOString(), ...(entry as object) }) + "\n");
  } catch (err) {
    console.error("log failed", err);
  }
}

// Web Audio without waiting for a click; the user already opened the app on purpose.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let soundFontPath: string | null = null;

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 860,
    backgroundColor: "#1b1916",
    title: "Four Hands Studio · prueba de sonido (S0)",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await win.loadFile(path.join(here, "renderer", "index.html"));
  if (process.env.FH_DEVTOOLS) win.webContents.openDevTools({ mode: "detach" });
}

app.whenReady().then(async () => {
  // Web MIDI needs permission; this app only asks for MIDI.
  const allowed = new Set(["midi", "midiSysex"]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  soundFontPath = findSoundFont();
  if (!soundFontPath) {
    const pick = await dialog.showOpenDialog({
      title: `No encuentro ${SF_NAME}. Elige el SoundFont`,
      filters: [{ name: "SoundFont", extensions: ["sf2", "sf3"] }],
      properties: ["openFile"],
    });
    soundFontPath = pick.canceled ? null : (pick.filePaths[0] ?? null);
  }

  ipcMain.handle("fh:info", () => ({
    soundFont: soundFontPath,
    logFile: logFile(),
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    platform: process.platform,
    arch: process.arch,
  }));
  ipcMain.handle("fh:soundfont", async () => {
    if (!soundFontPath) return null;
    const buf = await fs.promises.readFile(soundFontPath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });
  ipcMain.on("fh:log", (_e, entry) => appendLog(entry));

  appendLog({ type: "app_started", soundFont: soundFontPath, versions: process.versions.electron, platform: process.platform });
  await createWindow();
});

app.on("window-all-closed", () => {
  appendLog({ type: "app_closed" });
  app.quit();
});
