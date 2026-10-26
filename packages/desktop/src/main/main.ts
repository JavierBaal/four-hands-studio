/**
 * Four Hands Studio: Electron main process (ARQUITECTURA.md, 3).
 *
 * Hosts the song (SongSession), answers the window over IPC, saves to disk, shows the menus and
 * file dialogs. From H3 it will also talk to the AI bridges over a local WebSocket.
 */
import { BrowserWindow, Menu, app, dialog, ipcMain, session, shell, type MenuItemConstructorOptions } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRIDGE_CONFIG_FILE, TOOLS_VERSION, bridgeConfigDir } from "@fourhands/mcp-tools";
import { type Lang, langFrom, translator } from "../shared/i18n.js";
import { type AiApply, type AiTone, CH, DEFAULT_AI_APPLY, DEFAULT_AI_TONE, NO_AI, type MenuAction, type Request, type SkillImportResult, type ViewInfo } from "../shared/protocol.js";
import { AiDesk } from "./ai/desk.js";
import { SkillImportError, SkillLibrary, importSkillZip } from "./ai/skills.js";
import { AiServer } from "./ai/server.js";
import { connectClaude, findMcpb } from "./ai/connect.js";
import { type SessionOptions, SongSession } from "./session.js";
import { SoundLibrary } from "./sound-library.js";

const here = path.dirname(fileURLToPath(import.meta.url)); // packages/desktop/dist
const packageDir = path.resolve(here, "..");
const repoRoot = path.resolve(packageDir, "..", "..");
// On Fran's computer the repo lives in <project>/codigo, next to <project>/recursos.
const projectRoot = fs.existsSync(path.join(repoRoot, "..", "recursos")) ? path.resolve(repoRoot, "..") : null;

const SF_NAME = "MuseScore_General.sf3";
const lang: Lang = langFrom(process.env.FH_LANG ?? app.getLocale());
const t = translator(lang);

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.setName("Four Hands Studio");

let win: BrowserWindow | null = null;
let songs: SongSession | null = null;
let soundFontPath: string | null = null;
let library: SoundLibrary | null = null;
let desk: AiDesk | null = null;
let aiServer: AiServer | null = null;
let skills: SkillLibrary | null = null;

// ---------------------------------------------------------------------------
// Places on disk

const songsDir = () => path.join(app.getPath("documents"), "Four Hands");
const dataDir = () => app.getPath("userData");
const settingsFile = () => path.join(dataDir(), "ajustes.json");

interface Settings {
  lastFile?: string;
  firstRunDone?: boolean;
  /** Skills the user turned off in Skills de la IA. */
  disabledSkills?: string[];
  /** Tu IA > Opiniones (H4): how the AI gives its opinions. */
  aiTone?: AiTone;
  /** Tu IA > Lo que escribe (H4): straight in, or as a proposal the user accepts. */
  aiApply?: AiApply;
  /** MIDI out (H4): the port for the tracks that sound in another program. */
  midiOutPort?: string | null;
}

const aiTone = (): AiTone => (readSettings().aiTone === "gentle" ? "gentle" : DEFAULT_AI_TONE);
const aiApply = (): AiApply => (readSettings().aiApply === "proposal" ? "proposal" : DEFAULT_AI_APPLY);

function readSettings(): Settings {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf8")) as Settings;
  } catch {
    return {};
  }
}

function writeSettings(changes: Settings): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...changes }, null, 2));
  } catch (error) {
    console.error("settings", error);
  }
}

function findSoundFont(): string | null {
  const candidates = [
    process.env.FH_SOUNDFONT,
    projectRoot && path.join(projectRoot, "recursos", "soundfonts", SF_NAME),
    path.join(repoRoot, "recursos", "soundfonts", SF_NAME),
  ].filter((p): p is string => !!p);
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/** Where the user puts more sound banks. */
const soundsDir = () => path.join(songsDir(), "Sonidos");
/** The user's skills (ESTUDIO_SKILLS.md, 6); the built-in ones travel with the app. */
const userSkillsDir = () => path.join(songsDir(), "Skills");

function makeLibrary(): SoundLibrary {
  const extra = [projectRoot && path.join(projectRoot, "recursos", "soundfonts"), path.join(repoRoot, "recursos", "soundfonts"), soundFontPath && path.dirname(soundFontPath)].filter(
    (d): d is string => !!d,
  );
  return new SoundLibrary(soundsDir(), [...new Set(extra)], soundFontPath);
}

/** Candidates for the blind listening: the default bank and every installed one. */
function soundFontCandidates(): string[] {
  const files = [...library!.files().values()];
  return soundFontPath ? [soundFontPath, ...files] : files;
}

function logFile(): string {
  return path.join(projectRoot ?? dataDir(), "registro-app.jsonl");
}

function appendLog(entry: Record<string, unknown>): void {
  try {
    fs.appendFileSync(logFile(), JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n");
  } catch (err) {
    console.error("log failed", err);
  }
}

// ---------------------------------------------------------------------------
// The song

function sessionOptions(): SessionOptions {
  return {
    songsDir: songsDir(),
    backupsDir: path.join(dataDir(), "copias"),
    untitledName: t("untitled"),
    onPatch: (m) => win?.webContents.send(CH.patch, m),
    onFile: (f) => {
      win?.webContents.send(CH.file, f);
      updateTitle();
      if (f.error) appendLog({ type: "save_failed", error: f.error, path: f.path });
    },
    onReload: () => {
      win?.webContents.send(CH.reload);
      updateTitle();
      if (songs) writeSettings({ lastFile: songs.path });
      desk?.songChanged();
    },
  };
}

/** A file passed on the command line (double-clicking a song), the last song, or Dilatación the first time. */
async function openInitialSong(): Promise<SongSession> {
  const settings = readSettings();
  const fromArgs = process.argv.slice(1).find((a) => /\.(fourhands|mid|midi)$/i.test(a) && fs.existsSync(a));
  const candidates = [fromArgs, settings.lastFile].filter((p): p is string => !!p && fs.existsSync(p));
  for (const file of candidates) {
    try {
      return await SongSession.open(sessionOptions(), file);
    } catch (error) {
      appendLog({ type: "open_failed", file, error: (error as Error).message });
    }
  }
  if (!settings.firstRunDone) {
    writeSettings({ firstRunDone: true });
    const dilatacion = path.join(here, "Dilatacion.mid");
    if (fs.existsSync(dilatacion)) return SongSession.open(sessionOptions(), dilatacion);
  }
  return SongSession.createNew(sessionOptions());
}

function updateTitle(): void {
  if (!win || !songs) return;
  win.setTitle(`${songs.fileState().name} · Four Hands Studio`);
}

async function openWith(kind: "song" | "midi"): Promise<void> {
  if (!win || !songs) return;
  const filters =
    kind === "song"
      ? [
          { name: t("fileSong"), extensions: ["fourhands"] },
          { name: t("fileMidi"), extensions: ["mid", "midi"] },
        ]
      : [{ name: t("fileMidi"), extensions: ["mid", "midi"] }];
  const pick = await dialog.showOpenDialog(win, { defaultPath: songsDir(), filters, properties: ["openFile"] });
  const file = pick.filePaths[0];
  if (pick.canceled || !file) return;
  try {
    await songs.load(file);
    writeSettings({ lastFile: songs.path });
  } catch (error) {
    dialog.showErrorBox(t("openFailed"), (error as Error).message);
    appendLog({ type: "open_failed", file, error: (error as Error).message });
  }
}

/** Ctrl+S: saves now; a song still under its provisional name asks where first. */
async function save(): Promise<void> {
  if (!songs) return;
  if (songs.fileState().provisional) return saveAs();
  await songs.saveNow();
}

async function saveAs(): Promise<void> {
  if (!win || !songs) return;
  const pick = await dialog.showSaveDialog(win, { defaultPath: songs.path, filters: [{ name: t("fileSong"), extensions: ["fourhands"] }] });
  if (pick.canceled || !pick.filePath) return;
  await songs.saveAs(pick.filePath);
  writeSettings({ lastFile: songs.path });
  updateTitle();
}

async function exportMidi(): Promise<void> {
  if (!win || !songs) return;
  const base = path.join(path.dirname(songs.path), `${songs.fileState().name}.mid`);
  const pick = await dialog.showSaveDialog(win, { defaultPath: base, filters: [{ name: t("fileMidi"), extensions: ["mid"] }] });
  if (pick.canceled || !pick.filePath) return;
  await songs.exportMidi(pick.filePath);
}

// ---------------------------------------------------------------------------
// Menus. Edit and view actions are handled by the window (its shortcut table), so their
// accelerators are shown but not registered: the window receives the keys itself.

function sendMenu(action: MenuAction): void {
  win?.webContents.send(CH.menu, action);
}

function buildMenu(): void {
  const mod = process.platform === "darwin" ? "Cmd" : "Ctrl";
  const shown = (label: string, accelerator: string, action: MenuAction): MenuItemConstructorOptions => ({
    label,
    accelerator,
    registerAccelerator: false,
    click: () => sendMenu(action),
  });
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    {
      label: t("menuFile"),
      submenu: [
        { label: t("menuNew"), accelerator: "CmdOrCtrl+N", click: () => void songs?.newSong() },
        { label: t("menuOpen"), accelerator: "CmdOrCtrl+O", click: () => void openWith("song") },
        { label: t("menuImport"), accelerator: "CmdOrCtrl+I", click: () => void openWith("midi") },
        { type: "separator" },
        // The window takes Ctrl+S itself (shortcut table) and asks for it; the menu shows the key.
        { label: t("menuSave"), accelerator: "CmdOrCtrl+S", registerAccelerator: false, click: () => void save() },
        { label: t("menuSaveAs"), accelerator: "CmdOrCtrl+Shift+S", click: () => void saveAs() },
        { label: t("menuExport"), accelerator: "CmdOrCtrl+E", click: () => void exportMidi() },
        { label: t("menuShowFolder"), click: () => songs && shell.showItemInFolder(songs.path) },
        { type: "separator" },
        { label: t("menuQuit"), role: "quit" },
      ],
    },
    {
      label: t("menuEdit"),
      submenu: [
        shown(t("menuUndo"), `${mod}+Z`, "undo"),
        shown(t("menuRedo"), process.platform === "darwin" ? "Cmd+Shift+Z" : "Ctrl+Y", "redo"),
        { type: "separator" },
        shown(t("menuCut"), `${mod}+X`, "cut"),
        shown(t("menuCopy"), `${mod}+C`, "copy"),
        shown(t("menuPaste"), `${mod}+V`, "paste"),
        shown(t("menuDuplicate"), `${mod}+D`, "duplicate"),
        shown(t("menuDelete"), "Delete", "delete"),
        { type: "separator" },
        shown(t("menuSelectAll"), `${mod}+A`, "selectAll"),
      ],
    },
    {
      label: t("menuView"),
      submenu: [
        { label: t("menuAuthorship"), click: () => sendMenu("toggleAuthorship") },
        { label: t("menuPanel"), click: () => sendMenu("togglePanel") },
        { type: "separator" },
        shown(t("menuZoomIn"), "H", "zoomIn"),
        shown(t("menuZoomOut"), "G", "zoomOut"),
        shown(t("menuRowsIn"), "Shift+H", "zoomRowsIn"),
        shown(t("menuRowsOut"), "Shift+G", "zoomRowsOut"),
        { label: t("menuResetLayout"), click: () => sendMenu("resetLayout") },
      ],
    },
    {
      label: t("menuHelp"),
      submenu: [
        { label: t("menuSongsFolder"), click: () => void shell.openPath(songsDir()) },
        { label: t("menuBackups"), click: () => void shell.openPath(path.join(dataDir(), "copias")) },
        { type: "separator" },
        { label: t("menuConnectClaude"), click: () => void connectWithClaude() },
        { label: t("menuSkills"), click: () => sendMenu("skills") },
        { label: t("menuMidiOut"), click: () => sendMenu("midiOut") },
        { type: "separator" },
        { label: t("menuSoundTest"), click: () => void openSoundTest() },
        { label: t("menuBlind"), click: () => void openBlindListening() },
        { label: t("menuDevTools"), accelerator: "F12", click: () => win?.webContents.toggleDevTools() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// The AI (H3): the desk answers the tools, the server carries them from the bridges.

async function startAi(): Promise<void> {
  skills = new SkillLibrary({ builtIn: path.join(here, "skills"), user: userSkillsDir() }, () => readSettings().disabledSkills ?? []);
  try {
    fs.mkdirSync(userSkillsDir(), { recursive: true });
  } catch (error) {
    appendLog({ type: "skills_folder_failed", error: (error as Error).message });
  }
  desk = new AiDesk({
    session: () => songs!,
    banks: () => library?.list() ?? [],
    builtInSounds: () => library?.defaultPresets() ?? [],
    skills: skills!,
    onState: (state) => win?.webContents.send(CH.aiState, state),
    tone: aiTone,
    apply: aiApply,
    log: appendLog,
  });
  aiServer = new AiServer({
    desk,
    configFile: path.join(bridgeConfigDir(process.platform, process.env, os.homedir()), BRIDGE_CONFIG_FILE),
    toolsVersion: TOOLS_VERSION,
    log: appendLog,
  });
  try {
    await aiServer.start();
  } catch (error) {
    appendLog({ type: "ai_server_failed", error: (error as Error).message });
  }
}

/** Unpacks skill ZIPs into the user's folder and turns each one on. */
function importSkills(files: string[]): SkillImportResult {
  const result: SkillImportResult = { added: [], failed: [] };
  for (const file of files) {
    try {
      const done = importSkillZip(fs.readFileSync(file), userSkillsDir());
      result.added.push(done);
    } catch (error) {
      result.failed.push({ file: path.basename(file), problem: error instanceof SkillImportError ? error.problem : "unreadable" });
    }
  }
  if (result.added.length) {
    const added = new Set(result.added.map((a) => a.name));
    writeSettings({ disabledSkills: (readSettings().disabledSkills ?? []).filter((n) => !added.has(n)) });
  }
  appendLog({ type: "skills_imported", ...result });
  return result;
}

/** Help > Connect with Claude: opens the extension in Claude Desktop (PRUEBA_MCPB.md). */
async function connectWithClaude(): Promise<void> {
  const mcpb = findMcpb([path.join(repoRoot, "packages", "bridge", "dist"), projectRoot ?? "", path.join(here, "..")]);
  if (!mcpb) {
    dialog.showErrorBox(t("connectFailed"), t("connectNoFile"));
    appendLog({ type: "connect_button", ok: false, reason: "no mcpb" });
    return;
  }
  const result = await connectClaude(mcpb);
  appendLog({ type: "connect_button", mcpb, ...result });
  if (result.method === "explorer" && win) {
    void dialog.showMessageBox(win, { type: "info", message: t("connectManualTitle"), detail: t("connectManual", { path: mcpb }) });
  }
}

async function openBlindListening(): Promise<void> {
  const w = new BrowserWindow({
    width: 760,
    height: 720,
    backgroundColor: "#1b1916",
    title: `${t("blindTitle")} · Four Hands Studio`,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(here, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  w.on("page-title-updated", (e) => e.preventDefault());
  await w.loadFile(path.join(here, "escucha", "index.html"));
}

async function openSoundTest(): Promise<void> {
  const test = new BrowserWindow({
    width: 1180,
    height: 820,
    backgroundColor: "#1b1916",
    title: `${t("menuSoundTest")} · Four Hands Studio`,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(here, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await test.loadFile(path.join(here, "s0", "index.html"));
}

// ---------------------------------------------------------------------------
// Window and IPC

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 860,
    minHeight: 600,
    backgroundColor: "#1b1916",
    title: "Four Hands Studio",
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // The window handles every key itself (ESPEC_PIANO_ROLL.md, 6): no page zoom on Ctrl + / -.
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.on("before-input-event", (event, input) => {
    if ((input.control || input.meta) && ["+", "-", "=", "0"].includes(input.key)) event.preventDefault();
  });
  win.on("closed", () => (win = null));
  // The window title is the song's, not the page's.
  win.on("page-title-updated", (e) => e.preventDefault());
  updateTitle();
  await win.loadFile(path.join(here, "renderer", "index.html"));
  if (process.env.FH_DEVTOOLS) win.webContents.openDevTools({ mode: "detach" });
}

function registerIpc(): void {
  ipcMain.handle(CH.info, () => ({
    soundFont: soundFontPath,
    locale: lang === "es" ? "es-ES" : "en",
    platform: process.platform,
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    // S0 still reads these two.
    logFile: logFile(),
    arch: process.arch,
  }));
  ipcMain.handle(CH.snapshot, () => songs!.snapshot());
  ipcMain.handle(CH.request, (_e, request: Request) => songs!.handle(request));
  ipcMain.handle(CH.soundFont, async () => {
    if (!soundFontPath) return null;
    const buf = await fs.promises.readFile(soundFontPath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });
  ipcMain.on(CH.log, (_e, entry: Record<string, unknown>) => appendLog(entry));
  ipcMain.handle(CH.sfList, () =>
    soundFontCandidates().map((file, index) => ({ index, name: path.basename(file), presets: library!.header(file)?.presets ?? [] })),
  );
  ipcMain.handle(CH.sounds, () => library!.list());
  ipcMain.handle(CH.soundBank, (_e, id: string) => library!.load(id));
  ipcMain.on(CH.soundsFolder, () => void shell.openPath(library!.userDir));
  ipcMain.handle(CH.soundsImport, async (_e, files: string[]) => {
    const done = await library!.import(files);
    if (done.length) appendLog({ type: "sounds_imported", files: done });
    return done;
  });
  // Only the help links of the app: web pages, never files or other schemes.
  ipcMain.on(CH.openLink, (_e, url: string) => {
    if (/^https:\/\/[^\s]+$/.test(url)) void shell.openExternal(url);
  });
  ipcMain.handle(CH.ai, () => desk?.state() ?? NO_AI);
  // Skills de la IA: on and off, import a ZIP, the folder.
  ipcMain.handle(CH.skills, () => skills?.catalog() ?? []);
  ipcMain.handle(CH.skillsEnable, (_e, name: string, on: boolean) => {
    const off = new Set(readSettings().disabledSkills ?? []);
    if (on) off.delete(String(name));
    else off.add(String(name));
    writeSettings({ disabledSkills: [...off] });
    appendLog({ type: "skill_toggled", skill: name, on: !!on });
    return skills?.catalog() ?? [];
  });
  ipcMain.handle(CH.skillsImport, (_e, files: string[]) => importSkills(files));
  ipcMain.on(CH.exportMidi, () => void exportMidi());
  // MIDI out: the chosen port (the window opens it; the name is all the main process keeps).
  ipcMain.handle(CH.midiOut, () => readSettings().midiOutPort ?? null);
  ipcMain.handle(CH.midiOutSet, (_e, name: unknown) => {
    const next = typeof name === "string" && name.trim() ? name.slice(0, 200) : null;
    writeSettings({ midiOutPort: next });
    return next;
  });
  // Tu IA > Opiniones.
  ipcMain.handle(CH.aiTone, () => aiTone());
  ipcMain.handle(CH.aiToneSet, (_e, tone: string) => {
    const next: AiTone = tone === "gentle" ? "gentle" : "direct";
    writeSettings({ aiTone: next });
    appendLog({ type: "ai_tone", tone: next });
    return next;
  });
  // Tu IA > Lo que escribe.
  ipcMain.handle(CH.aiApply, () => aiApply());
  ipcMain.handle(CH.aiApplySet, (_e, mode: string) => {
    const next: AiApply = mode === "proposal" ? "proposal" : "direct";
    writeSettings({ aiApply: next });
    appendLog({ type: "ai_apply", mode: next });
    return next;
  });
  // Con / Sin: the song without the last AI intervention, only to listen to it.
  ipcMain.handle(CH.songBefore, () => songs?.songBefore() ?? null);
  ipcMain.handle(CH.skillsPick, async () => {
    if (!win) return { added: [], failed: [] };
    const pick = await dialog.showOpenDialog(win, { filters: [{ name: "ZIP", extensions: ["zip"] }], properties: ["openFile", "multiSelections"] });
    return pick.canceled ? { added: [], failed: [] } : importSkills(pick.filePaths);
  });
  ipcMain.on(CH.skillsFolder, () => {
    fs.mkdirSync(userSkillsDir(), { recursive: true });
    void shell.openPath(userSkillsDir());
  });
  ipcMain.on(CH.connectClaude, () => void connectWithClaude());
  ipcMain.on(CH.save, () => void save());
  ipcMain.on(CH.aiClose, (_e, id: string) => desk?.closeByUser(String(id)));
  ipcMain.on(CH.aiMarkSeen, (_e, id: string) => desk?.markSeen(String(id)));
  ipcMain.on(CH.viewInfo, (_e, info: ViewInfo) => {
    if (info && (info.noteNames === "solfege" || info.noteNames === "letters")) desk?.setWindow(info);
  });
  ipcMain.handle(CH.sfLoad, async (_e, index: number) => {
    const file = soundFontCandidates()[index];
    if (!file) return null;
    const buf = await fs.promises.readFile(file);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });
}

app.whenReady().then(async () => {
  const allowed = new Set(["midi", "midiSysex"]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  soundFontPath = findSoundFont();
  library = makeLibrary();
  library.watch(() => win?.webContents.send(CH.soundsChanged));
  registerIpc();
  // `--s0`: only the sound and latency test (Abrir prueba de sonido.bat).
  if (process.argv.includes("--s0")) {
    await openSoundTest();
    return;
  }
  // `--escucha`: only the blind listening window.
  if (process.argv.includes("--escucha")) {
    await openBlindListening();
    return;
  }
  buildMenu();
  try {
    songs = await openInitialSong();
  } catch (error) {
    appendLog({ type: "start_failed", error: (error as Error).message });
    songs = await SongSession.createNew(sessionOptions());
  }
  writeSettings({ lastFile: songs.path });
  await startAi();
  appendLog({ type: "app_started", song: songs.path, soundFont: soundFontPath, electron: process.versions.electron, platform: process.platform });
  await createWindow();
});

// Save before quitting: the autosave may still be waiting for its second.
// (In S0-only mode there is no song.)
let quitting = false;
app.on("before-quit", (event) => {
  if (quitting || !songs) return;
  event.preventDefault();
  quitting = true;
  desk?.dispose();
  void Promise.all([songs.flush(), aiServer?.stop()]).finally(() => {
    appendLog({ type: "app_closed" });
    app.quit();
  });
});

app.on("window-all-closed", () => app.quit());

