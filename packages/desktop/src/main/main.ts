/**
 * Four Hands Studio: Electron main process (docs/architecture.md, 3).
 *
 * Hosts the song (SongSession), answers the window over IPC, saves to disk, shows the menus and
 * file dialogs. From H3 it will also talk to the AI bridges over a local WebSocket.
 */
import { parseAnalysis } from "../shared/analysis.js";
import type { AnalysisContext } from "./ai/listen.js";
import { BrowserWindow, Menu, app, dialog, ipcMain, session, shell, type MenuItemConstructorOptions } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRIDGE_CONFIG_FILE, TOOLS_VERSION, bridgeConfigDir } from "@fourhands/mcp-tools";
import { type Lang, langFrom, translator } from "../shared/i18n.js";
import { type AiApply, type AiTone, CH, DEFAULT_AI_APPLY, DEFAULT_AI_TONE, type FolderKind, NO_AI, type MenuAction, type ToolKind, type Request, type SkillImportResult, type ViewInfo } from "../shared/protocol.js";
import { AiDesk, type EffectParam } from "./ai/desk.js";
import { SkillImportError, SkillLibrary, importSkillZip } from "./ai/skills.js";
import { AiServer } from "./ai/server.js";
import { connectClaude, findMcpb } from "./ai/connect.js";
import { type SessionOptions, SongSession } from "./session.js";
import { DEMO_FILE, copyDemo } from "./demo.js";
import { PluginWatch } from "./plugin-watch.js";
import type { PluginStates, Song } from "@fourhands/core";
import { SoundLibrary } from "./sound-library.js";
import { LibraryCatalogFile } from "./library-catalog.js";
import { EngineHost } from "./engine/host.js";
import { type EngineLevels, type EngineLoad, engineLoad } from "../shared/mix.js";
import type { EngineLoadResult, EngineMidiEvent, EnginePlugin, EngineSoundsResult } from "../shared/engine.js";
import { CATEGORIES, RECENT_MAX, type SoundCategory, type SoundPrefs } from "../shared/sound-catalog.js";
import { Worker } from "node:worker_threads";
import { type ExportDefaults, type ExportProgress, type ExportRequest, type ExportResult, type WavQuality, WAV_QUALITIES } from "../shared/export.js";
import { type ExportDeps, ExportJob } from "./export/job.js";
import { defaultExportFolder } from "./export/files.js";
import type { Mp3Message } from "./export/mp3-worker.js";

const here = path.dirname(fileURLToPath(import.meta.url)); // packages/desktop/dist
const packageDir = path.resolve(here, "..");
const repoRoot = path.resolve(packageDir, "..", "..");
// In a development checkout the repo may live in <project>/codigo, next to <project>/recursos.
const projectRoot = fs.existsSync(path.join(repoRoot, "..", "recursos")) ? path.resolve(repoRoot, "..") : null;
/** In the installed app: what the installer puts next to the app (engine, sound banks, bridge). */
const resources = app.isPackaged ? process.resourcesPath : null;

const SF_NAME = "MuseScore_General.sf3";
const lang: Lang = langFrom(process.env.FH_LANG ?? app.getLocale());
const t = translator(lang);

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
// F2.2 (03/11/2026): with the sound in the engine the window is not "playing audio" for
// Chromium, so behind another window (Alt+Tab) its timers slowed to one a second and the player sent
// the notes late: stutters. A music app keeps its timing in the background.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.setName("Four Hands Studio");

let win: BrowserWindow | null = null;
let songs: SongSession | null = null;
let soundFontPath: string | null = null;
let library: SoundLibrary | null = null;
let desk: AiDesk | null = null;
let aiServer: AiServer | null = null;
let skills: SkillLibrary | null = null;
let engine: EngineHost | null = null;
/** The plugins the engine knows (phase 2), for the AI's list_instruments. */
let knownPlugins: EnginePlugin[] = [];
/** The user's library cards (05/11/2026), shared by every song. */
let libraries: LibraryCatalogFile | null = null;
const catalog = () => (libraries ??= new LibraryCatalogFile(path.join(dataDir(), "libraries.json")));

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
  /** Ajustes › Plugins: folders the user added for the engine to search. */
  pluginFolders?: string[];
  /** Last full plugin scan, ms since the epoch. */
  pluginsScannedAt?: number;
  /** The Sonidos browser: favourites, recents, hidden plugins, moved categories. */
  soundPrefs?: SoundPrefs;
  /**
   * F2.1 (01/11/2026): where the built-in sounds play. "engine" (the default): in the native
   * engine, with everything else; "app": in the window, as before (SpessaSynth), to go back if
   * something sounds wrong. With no engine built they play in the window either way.
   */
  builtinSounds?: "engine" | "app";
  /** Ajustes > Tu nombre (F2.4): the artist written in exported files. */
  userName?: string;
  /** The export window as it was left (F2.4). No folder: the default one. */
  exportPrefs?: { folder?: string | undefined; wav: WavQuality | null; mp3: boolean };
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
    resources && path.join(resources, "soundfonts", SF_NAME),
    projectRoot && path.join(projectRoot, "recursos", "soundfonts", SF_NAME),
    path.join(repoRoot, "recursos", "soundfonts", SF_NAME),
  ].filter((p): p is string => !!p);
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/** Where the user puts more sound banks. */
const soundsDir = () => path.join(songsDir(), "Sonidos");
/** The user's skills; the built-in ones travel with the app. */
const userSkillsDir = () => path.join(songsDir(), "Skills");

function makeLibrary(): SoundLibrary {
  const extra = [resources && path.join(resources, "soundfonts"), projectRoot && path.join(projectRoot, "recursos", "soundfonts"), path.join(repoRoot, "recursos", "soundfonts"), soundFontPath && path.dirname(soundFontPath)].filter(
    (d): d is string => !!d,
  );
  return new SoundLibrary(soundsDir(), [...new Set(extra)], soundFontPath);
}

/** Candidates for the blind listening: the default bank and every installed one. */
function soundFontCandidates(): string[] {
  const files = [...library!.files().values()];
  return soundFontPath ? [soundFontPath, ...files] : files;
}

/**
 * The native engine, if it is there: FH_ENGINE, the one the installer ships, the copy that
 * «Compilar motor.bat» leaves in <project>/motor, or the build folder of the repo.
 */
function findEngine(): string | null {
  const exe = process.platform === "win32" ? "Four Hands Engine.exe" : "Four Hands Engine";
  const candidates = [
    process.env.FH_ENGINE,
    resources && path.join(resources, "engine", exe),
    projectRoot && path.join(projectRoot, "motor", exe),
    path.join(repoRoot, "engine", "build", "FourHandsEngine_artefacts", "Release", exe),
  ].filter((p): p is string => !!p);
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function engineHost(): EngineHost {
  engine ??= new EngineHost({
    command: () => {
      const exe = findEngine();
      return exe ? [exe] : null;
    },
    cacheFile: path.join(dataDir(), "motor", "plugins.xml"),
    log: appendLog,
    onStatus: (status) => {
      // A bank the engine was loading when it stopped will never arrive: say so now, so the
      // window asks the new engine (it waited a minute and gave up on the new one too, 03/11/2026).
      if (status.state !== "ready" && status.state !== "starting")
        for (const [key, resolve] of [...soundsWaiting]) {
          soundsWaiting.delete(key);
          resolve({ ok: false, error: "The engine stopped" });
        }
      win?.webContents.send(CH.engineStatusChanged, status);
    },
    onScanning: (file, progress) => win?.webContents.send(CH.engineScanning, { file, progress }),
    onEvent: (event) => {
      if (event.event === "deviceChanged") {
        engine?.deviceChanged(String(event.device ?? ""), Number(event.latency ?? 0), event.deviceError ? String(event.deviceError) : undefined);
        return;
      }
      if (event.event !== "soundsLoaded") return;
      const key = `${String(event.id)}@${Number(event.offset)}`;
      const waiting = soundsWaiting.get(key);
      soundsWaiting.delete(key);
      waiting?.({ ok: !!event.ok, error: event.error ? String(event.error) : undefined, presets: Number(event.presets ?? 0), ms: Number(event.ms ?? 0) });
    },
  });
  return engine;
}

/** F2.2: the engine's levels in the last playback, for the AI's get_levels. */
let lastLevels: { levels: EngineLevels; at: number; strips: Record<string, number>; buses?: Record<string, number> } | null = null;
/** F2.3: what the engine heard in the last playback, for the AI's analyze_mix. */
let lastAnalysis: AnalysisContext | null = null;
/** F2.2 part B: the engine's last load reading (the window asks every second), for get_levels. */
let lastLoad: EngineLoad | null = null;
/**
 * A2 (03/11/2026): each track's strip in the engine, as the window last sent it with the mix (the
 * window numbers them: shared/strips.ts). Plugins' state and the levels are read by strip.
 */
let trackStrips: Record<string, number> = {};
const stripOfTrack = (track: { id: string; channel: number }): number => trackStrips[track.id] ?? track.channel;
/** F2.2 part D: each bus's place in the engine, as the window last sent it. */
const busIndexes: Record<string, number> = {};

/** F2.1: sound banks the engine is loading, by "id@offset", waiting for its "soundsLoaded". */
const soundsWaiting = new Map<string, (r: EngineSoundsResult) => void>();

/** The file of a bank: "main" is the built-in one (MuseScore_General); the rest, the user's. */
function soundBankPath(id: string): string | null {
  if (id === "main") return soundFontPath;
  return library?.files().get(id) ?? null;
}

/**
 * F2.1: loads a bank into the engine's built-in sounds at its bank select offset (the same the
 * window's synth gave it) and waits until it is ready. It starts the engine if needed.
 */
async function loadEngineSounds(id: string, offset: number): Promise<EngineSoundsResult> {
  const file = soundBankPath(id);
  if (!file) return { ok: false, error: `Sound bank not found: ${id}` };
  const key = `${id}@${offset}`;
  const done = new Promise<EngineSoundsResult>((resolve) => {
    soundsWaiting.get(key)?.({ ok: false, error: "Asked again" });
    soundsWaiting.set(key, resolve);
    // An SF3 of 85 MB takes a few seconds; a minute is plenty.
    setTimeout(() => {
      if (soundsWaiting.get(key) !== resolve) return;
      soundsWaiting.delete(key);
      resolve({ ok: false, error: "The engine did not load the sound bank in time" });
    }, 60000).unref();
  });
  try {
    await engineHost().request({ type: "sounds", id, offset, path: file });
  } catch (error) {
    soundsWaiting.get(key)?.({ ok: false, error: (error as Error).message });
    soundsWaiting.delete(key);
  }
  const result = await done;
  appendLog(result.ok ? { type: "engine_sounds_loaded", bank: id, offset, presets: result.presets, ms: result.ms } : { type: "engine_sounds_failed", bank: id, offset, error: result.error });
  return result;
}

function pluginsOf(reply: Record<string, unknown>): EnginePlugin[] {
  const list = Array.isArray(reply.list) ? (reply.list as EnginePlugin[]) : [];
  return list.map((p) => ({ id: String(p.id), name: String(p.name), vendor: String(p.vendor ?? ""), category: String(p.category ?? ""), format: String(p.format ?? ""), instrument: !!p.instrument }));
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

/**
 * F2.1: what each plugin track's plugin has loaded, from the engine (its slot is the track's strip).
 * Nothing when the engine is not running: the session keeps what the file had.
 */
async function collectPluginStates(song: Song, slots?: Set<number>, insertIds?: Set<string>): Promise<PluginStates> {
  const out: PluginStates = {};
  if (!engine || engine.current.state !== "ready") return out;
  for (const id of song.trackOrder) {
    const track = song.tracks[id];
    if (track?.output !== "plugin" || !track.plugin) continue;
    const slot = stripOfTrack(track);
    if ((slots !== undefined || insertIds !== undefined) && !slots?.has(slot)) continue;
    try {
      const reply = await engine.request({ type: "getState", slot });
      const data = String(reply.data ?? "");
      if (data) out[id] = { id: track.plugin.id, data };
    } catch {
      // That slot did not answer: its saved state stays.
    }
  }
  // F2.2 part C: plugin effects keep what they have inside too, under their own id ("x12").
  // On saving (no filter): every plugin effect loaded in this run. From the watcher: only those asked.
  const watching = slots !== undefined || insertIds !== undefined;
  for (const x of pluginInserts(song)) {
    if (watching ? !insertIds?.has(x.id) : insertsLoaded.get(x.id) !== x.plugin) continue;
    try {
      const reply = await engine.request({ type: "getInsertState", id: x.id });
      const data = String(reply.data ?? "");
      if (data) out[x.id] = { id: x.plugin, data };
    } catch {
      // Not answered: the saved state stays.
    }
  }
  return out;
}

/** Every plugin effect in the song (tracks and Master), with the plugin it is. */
function pluginInserts(song: Song): Array<{ id: string; plugin: string }> {
  const chains = [song.masterInserts ?? [], ...song.trackOrder.map((t) => song.tracks[t]?.inserts ?? [])];
  return chains.flat().filter((x) => x.kind === "plugin" && x.plugin).map((x) => ({ id: x.id, plugin: x.plugin!.id }));
}

/** F2.2 part C: plugin effects the engine has loaded in this run (id → plugin), to restore their state once. */
const insertsLoaded = new Map<string, string>();
let insertsGeneration = -1;
/** Plugin effects whose window was open at the last look (their state is checked once more after closing). */
let insertWindowsOpen = new Set<string>();

const pluginWatch = new PluginWatch();

/**
 * Every few seconds: if a plugin changed inside (its window), the song is saved with it. Only the
 * plugins whose window is open, or just closed, are asked (plugin-watch.ts).
 */
async function watchPluginStates(): Promise<void> {
  if (!songs || !engine || engine.current.state !== "ready") return;
  let open: number[] | null = null;
  try {
    const reply = await engine.request({ type: "windows" });
    if (Array.isArray(reply.slots)) open = reply.slots.map(Number);
  } catch {
    // An engine built before 29/10/2026: it cannot tell.
  }
  // Plugin effects (part C): those with their window open now, or open at the last look.
  let openFx = new Set<string>();
  try {
    const reply = await engine.request({ type: "insertWindows" });
    if (Array.isArray(reply.ids)) openFx = new Set(reply.ids.map(String));
  } catch {
    // An engine before part C.
  }
  const fxToCheck = new Set([...openFx, ...insertWindowsOpen]);
  insertWindowsOpen = openFx;
  const slots = pluginWatch.slotsToCheck(open, Date.now());
  if (slots.size === 0 && fxToCheck.size === 0) return;
  const fresh = await collectPluginStates(songs.snapshot().song, slots, fxToCheck);
  if (Object.entries(fresh).some(([trackId, s]) => songs!.pluginState(trackId, s.id) !== s.data)) {
    appendLog({ type: "plugin_state_changed", tracks: Object.keys(fresh) });
    songs.pluginsChanged();
  }
}

function sessionOptions(): SessionOptions {
  return {
    collectPluginStates,
    onPluginStatesDropped: (error) => appendLog({ type: "plugin_states_dropped", error }),
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

/** A file passed on the command line (double-clicking a song), the last song, or the demo the first time. */
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
    try {
      const demo = copyDemo(path.join(here, DEMO_FILE), songsDir());
      if (demo) {
        const opened = await SongSession.open(sessionOptions(), demo);
        writeSettings({ lastFile: demo });
        return opened;
      }
    } catch (error) {
      appendLog({ type: "open_failed", file: DEMO_FILE, error: (error as Error).message });
    }
  }
  return SongSession.createNew(sessionOptions());
}

function updateTitle(): void {
  if (!win || !songs) return;
  win.setTitle(`${songs.fileState().name} · Four Hands Studio`);
}

/** Help > Open the demo song: a fresh copy, so the user's earlier copy keeps their changes. */
async function openDemo(): Promise<void> {
  if (!win || !songs) return;
  try {
    const demo = copyDemo(path.join(here, DEMO_FILE), songsDir());
    if (!demo) return;
    await songs.load(demo);
    writeSettings({ lastFile: songs.path });
  } catch (error) {
    dialog.showErrorBox(t("openFailed"), (error as Error).message);
    appendLog({ type: "open_failed", file: DEMO_FILE, error: (error as Error).message });
  }
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
        // F2.4: Ctrl+E exports audio (the window takes the key itself, as Ctrl+S); MIDI moved to Ctrl+Shift+E.
        { label: t("menuExportAudio"), accelerator: "CmdOrCtrl+E", registerAccelerator: false, click: () => sendMenu("exportAudio") },
        { label: t("menuExport"), accelerator: "CmdOrCtrl+Shift+E", click: () => void exportMidi() },
        { label: t("menuShowFolder"), click: () => songs && shell.showItemInFolder(songs.path) },
        { type: "separator" },
        // Ajustes: what the Help menu used to hold. The window takes Ctrl+, itself.
        { label: t("menuSettings"), accelerator: "CmdOrCtrl+,", registerAccelerator: false, click: () => sendMenu("settings") },
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
        shown(t("menuEditor"), "F2", "showEditor"),
        shown(t("menuMix"), "F3", "showMix"),
        { type: "separator" },
        shown(t("menuPanelTrack"), "F4", "panelTrack"),
        shown(t("menuPanelSounds"), "F5", "panelSounds"),
        shown(t("menuPanelAi"), "F6", "panelAi"),
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
        // Only help; settings, folders and test tools are in Ajustes.
        { label: t("menuConnectAi"), click: () => sendMenu("skills") },
        { label: t("menuOpenDemo"), click: () => void openDemo() },
        { type: "separator" },
        { label: t("menuAbout"), click: () => void about() },
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
    plugins: () => knownPlugins,
    levels: () => lastLevels,
    analysis: () => lastAnalysis,
    libraries: () => catalog(),
    load: () => (engine && engine.current.state === "ready" ? lastLoad : null),
    // F2.2 part C: a plugin effect's parameters, from the engine.
    effectParams: async (id) => {
      if (!engine || engine.current.state !== "ready") return null;
      try {
        const reply = await engine.request({ type: "params", id });
        return Array.isArray(reply.params) && reply.params.length ? (reply.params as EffectParam[]) : null;
      } catch {
        return null;
      }
    },
    setEffectParam: async (id, index, text) => {
      if (!engine || engine.current.state !== "ready") return null;
      try {
        const reply = await engine.request({ type: "setParam", id, index, text });
        return { ok: !!reply.ok, text: String(reply.text ?? ""), value: Number(reply.value ?? 0) };
      } catch {
        return null;
      }
    },
    skills: skills!,
    onState: (state) => win?.webContents.send(CH.aiState, state),
    tone: aiTone,
    exportAudio: exportForAi,
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

/** Help > Connect with Claude: opens the extension in Claude Desktop. */
async function connectWithClaude(): Promise<void> {
  const mcpb = findMcpb([resources ?? "", path.join(repoRoot, "packages", "bridge", "dist"), projectRoot ?? "", path.join(here, "..")]);
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

/** Help › About Four Hands. */
async function about(): Promise<void> {
  if (!win) return;
  await dialog.showMessageBox(win, {
    type: "info",
    message: "Four Hands Studio",
    detail: t("aboutDetail", { version: app.getVersion(), electron: process.versions.electron ?? "", tools: String(TOOLS_VERSION) }),
  });
}

/** The VST3 folders the engine always searches on this system (JUCE's defaults). */
function systemPluginFolders(): string[] {
  if (process.platform === "win32") return [path.join(process.env.CommonProgramFiles ?? "C:\\Program Files\\Common Files", "VST3")];
  if (process.platform === "darwin") return ["/Library/Audio/Plug-Ins/VST3", path.join(os.homedir(), "Library", "Audio", "Plug-Ins", "VST3")];
  return [path.join(os.homedir(), ".vst3"), "/usr/lib/vst3", "/usr/local/lib/vst3"];
}

/** Four Hands's own test instrument, next to the engine «Compilar motor.bat» leaves. */
const testPluginFolder = () => (projectRoot ? path.join(projectRoot, "motor", "plugins-prueba") : null);

function pluginFolders(): { system: string[]; user: string[] } {
  const test = testPluginFolder();
  return { system: [...systemPluginFolders(), ...(test && fs.existsSync(test) ? [test] : [])], user: readSettings().pluginFolders ?? [] };
}

/** What the window sends, checked: lists of short strings and known categories only. */
function cleanSoundPrefs(raw: unknown): SoundPrefs {
  const r = (raw ?? {}) as Partial<SoundPrefs>;
  const keys = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string" && k.length < 2100).slice(0, max) : []);
  const categories: Record<string, SoundCategory> = {};
  if (r.categories && typeof r.categories === "object") {
    for (const [k, c] of Object.entries(r.categories)) if (k.length < 2100 && (CATEGORIES as readonly string[]).includes(c as string)) categories[k] = c as SoundCategory;
  }
  return { favorites: keys(r.favorites, 500), recents: keys(r.recents, RECENT_MAX), hidden: keys(r.hidden, 2000), categories };
}

function userFolders(): Record<FolderKind, string> {
  return { songs: songsDir(), exports: exportDefaults().folder, backups: path.join(dataDir(), "copias"), sounds: soundsDir(), skills: userSkillsDir() };
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
      // Never slow the player down when the window is behind another one (see the switches above).
      backgroundThrottling: false,
    },
  });
  // The window handles every key itself (docs/piano-roll.md, 6): no page zoom on Ctrl + / -.
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.on("before-input-event", (event, input) => {
    if ((input.control || input.meta) && ["+", "-", "=", "0"].includes(input.key)) event.preventDefault();
    // F12: the developer tools (also in Ajustes › Avanzado; no longer in a menu).
    if (input.type === "keyDown" && input.key === "F12") win?.webContents.toggleDevTools();
  });
  win.on("closed", () => (win = null));
  // The window title is the song's, not the page's.
  win.on("page-title-updated", (e) => e.preventDefault());
  updateTitle();
  await win.loadFile(path.join(here, "renderer", "index.html"));
  if (process.env.FH_DEVTOOLS) win.webContents.openDevTools({ mode: "detach" });
}

// ---------------------------------------------------------------------------
// Export to WAV and MP3 (F2.4, docs/audio-engine.md, 10). The window builds what the engine plays
// (it knows each track's strip); here the engine renders it and the MP3 is made on its own thread.

let exportJob: ExportJob | null = null;

function exportDefaults(): ExportDefaults {
  const settings = readSettings();
  const prefs = settings.exportPrefs;
  const defaultFolder = defaultExportFolder(songsDir());
  const wav = prefs?.wav === null ? null : WAV_QUALITIES.find((q) => q.rate === prefs?.wav?.rate && q.bits === prefs.wav.bits) ?? WAV_QUALITIES[0]!;
  const folder = prefs?.folder && fs.existsSync(prefs.folder) ? prefs.folder : defaultFolder;
  return { folder, defaultFolder, artist: settings.userName ?? "", wav, mp3: prefs?.mp3 ?? true };
}

/** Packaged, the MP3 thread and LAME are outside app.asar (package.mjs, asarUnpack). */
const unpacked = (p: string) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

const mp3Encoding: ExportDeps["mp3"] = (job, progress) => {
  const dist = unpacked(here + path.sep).slice(0, -1);
  const worker = new Worker(path.join(dist, "mp3-worker.mjs"), { workerData: { ...job, lame: path.join(dist, "lame", "lamejs.mjs") } });
  const done = new Promise<{ bytes: number } | null>((resolve, reject) => {
    worker.on("message", (m: Mp3Message) => {
      if (m.type === "progress") progress(m.fraction);
      else if (m.type === "done") resolve({ bytes: m.bytes });
      else if (m.type === "cancelled") resolve(null);
      else reject(new Error(m.message));
    });
    worker.on("error", reject);
    // Stopped (cancel) before saying anything: nothing was written.
    worker.on("exit", () => resolve(null));
  });
  return { done, cancel: () => void worker.terminate() };
};

/** One export at a time, by the window or by the AI. */
async function runExport(request: ExportRequest, by: "window" | "ai"): Promise<ExportResult> {
  const failed = (error: string): ExportResult => ({ ok: false, error, files: [], seconds: 0, lufs: -100, truePeak: -120 });
  if (exportJob) return failed("An export is already under way");
  const host = engine;
  if (!host || host.current.state !== "ready") return failed("The audio engine is not running");
  if (!host.canExport) return failed("This engine was built before export: build it again");
  const defaults = exportDefaults();
  const folder = request.folder || defaults.folder;
  if (by === "window") {
    writeSettings({
      userName: request.artist.trim(),
      exportPrefs: { folder: folder === defaults.defaultFolder ? undefined : folder, wav: request.wav, mp3: request.mp3 },
    });
  }
  const job = new ExportJob(
    { ...request, folder },
    {
      engine: { request: (m) => host.request(m), send: (m) => host.send(m), listen: (l) => host.listen(l) },
      mp3: mp3Encoding,
      tempDir: app.getPath("temp"),
      progress: (p: ExportProgress) => win?.webContents.send(CH.exportProgress, p),
    },
  );
  exportJob = job;
  const started = Date.now();
  try {
    const result = await job.run();
    appendLog({
      type: "export",
      by,
      ok: result.ok,
      cancelled: result.cancelled,
      error: result.error,
      ms: Date.now() - started,
      range: request.range,
      seconds: result.seconds,
      events: request.plan.midi.length,
      files: result.files.map((f) => ({ format: f.format, bytes: f.bytes })),
      lufs: result.lufs,
      truePeak: result.truePeak,
    });
    return result;
  } finally {
    exportJob = null;
  }
}

/** The AI's export_audio: the window builds what the engine plays (it knows each track's strip). */
let planAsked = 0;
const planWaiting = new Map<number, (reply: { plan: ExportRequest["plan"] | null; error?: string }) => void>();

function planFromWindow(range: ExportRequest["range"]): Promise<{ plan: ExportRequest["plan"] | null; error?: string }> {
  if (!win) return Promise.resolve({ plan: null, error: "no window" });
  const id = ++planAsked;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      planWaiting.delete(id);
      resolve({ plan: null, error: "the window did not answer" });
    }, 10_000);
    planWaiting.set(id, (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
    win!.webContents.send(CH.exportPlanRequest, { id, range });
  });
}

async function exportForAi(choices: { range: "song" | "loop"; wav: WavQuality | null; mp3: boolean; title?: string | undefined }): Promise<ExportResult> {
  const failed = (error: string): ExportResult => ({ ok: false, error, files: [], seconds: 0, lufs: -100, truePeak: -120 });
  if (exportJob) return failed("An export is already under way");
  if (!engine || engine.current.state !== "ready") return failed("The audio engine is not running");
  // The engine may still be loading the built-in sounds or a track's plugin: wait for it a while.
  let made = await planFromWindow(choices.range);
  for (let waited = 0; !made.plan && /sounds|plugins still loading/.test(made.error ?? "") && waited < 30; waited++) {
    await new Promise((r) => setTimeout(r, 1000));
    made = await planFromWindow(choices.range);
  }
  if (!made.plan) return failed(made.error ?? "no plan");
  const song = songs?.snapshot().song;
  return runExport({ ...choices, title: choices.title?.trim() || song?.title || "Four Hands", artist: readSettings().userName ?? "", plan: made.plan }, "ai");
}

function registerExport(): void {
  ipcMain.on(CH.exportPlanReply, (_e, reply: { id: number; plan: ExportRequest["plan"] | null; error?: string }) => {
    const waiting = planWaiting.get(reply?.id);
    planWaiting.delete(reply?.id);
    waiting?.({ plan: reply.plan, ...(reply.error ? { error: reply.error } : {}) });
  });
  ipcMain.handle(CH.exportDefaults, () => exportDefaults());
  ipcMain.handle(CH.exportPickFolder, async (_e, current: unknown) => {
    if (!win) return null;
    const pick = await dialog.showOpenDialog(win, { defaultPath: String(current || exportDefaults().folder), properties: ["openDirectory", "createDirectory"] });
    return pick.canceled || !pick.filePaths[0] ? null : pick.filePaths[0];
  });
  ipcMain.handle(CH.exportAudio, (_e, request: ExportRequest) => runExport(request, "window"));
  ipcMain.on(CH.exportCancel, () => exportJob?.cancel());
  ipcMain.on(CH.exportShow, (_e, file: unknown) => {
    if (typeof file === "string" && fs.existsSync(file)) shell.showItemInFolder(file);
  });
  ipcMain.handle(CH.userName, () => readSettings().userName ?? "");
  ipcMain.handle(CH.userNameSet, (_e, name: unknown) => {
    const clean = String(name ?? "").trim().slice(0, 200);
    writeSettings({ userName: clean });
    return clean;
  });
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
  // The native engine (test S2): plugins, loading them, their windows, MIDI.
  ipcMain.handle(CH.engineStatus, () => engineHost().current);
  ipcMain.handle(CH.enginePlugins, async (_e, scan: unknown) => {
    try {
      const started = Date.now();
      // Besides the system's VST3 folders: the user's (Ajustes › Plugins) and <project>/motor/plugins-prueba,
      // where «Compilar motor.bat» leaves the test instrument.
      const test = testPluginFolder();
      const extra = [...(readSettings().pluginFolders ?? []), ...(test ? [test] : [])].filter((p) => fs.existsSync(p));
      const plugins = pluginsOf(await engineHost().request(scan ? { type: "scan", paths: extra } : { type: "plugins" }));
      knownPlugins = plugins;
      if (scan) {
        appendLog({ type: "engine_scanned", ms: Date.now() - started, plugins: plugins.length, instruments: plugins.filter((p) => p.instrument).map((p) => p.name) });
        writeSettings({ pluginsScannedAt: Date.now() });
      }
      return { plugins, scannedAt: readSettings().pluginsScannedAt ?? null };
    } catch (error) {
      return { plugins: [], error: (error as Error).message };
    }
  });
  ipcMain.handle(CH.engineLoad, async (_e, slot: unknown, id: unknown, trackId: unknown): Promise<EngineLoadResult> => {
    const started = Date.now();
    try {
      const reply = await engineHost().request({ type: "load", slot: Number(slot), id: String(id) });
      appendLog({ type: "engine_loaded", slot, plugin: reply.name, ms: Date.now() - started });
      // F2.1: what the plugin had loaded in this song comes back (Kontakt's instrument).
      const state = typeof trackId === "string" ? songs?.pluginState(trackId, String(id)) : null;
      if (state) {
        const t0 = Date.now();
        const set = await engineHost().request({ type: "setState", slot: Number(slot), data: state });
        appendLog({ type: "engine_state_restored", slot, plugin: reply.name, bytes: Math.round((state.length * 3) / 4), ok: !!set.ok, ms: Date.now() - t0 });
      }
      return { ok: true, name: String(reply.name ?? "") };
    } catch (error) {
      appendLog({ type: "engine_load_failed", slot, id, error: (error as Error).message });
      return { ok: false, error: (error as Error).message };
    }
  });
  ipcMain.handle(CH.engineShow, async (_e, slot: unknown) => {
    try {
      pluginWatch.shown(Number(slot), Date.now());
      return !!(await engineHost().request({ type: "show", slot: Number(slot) })).ok;
    } catch {
      return false;
    }
  });
  // F2.2 part C: a strip's effect chain (-1: the Master). Plugin effects new to this run get back
  // what they had in this song.
  ipcMain.handle(CH.engineInserts, async (_e, strip: unknown, chain: unknown) => {
    if (!engine || engine.current.state !== "ready" || !Array.isArray(chain)) return { ok: false, errors: [] };
    if (engine.current.generation !== insertsGeneration) {
      insertsLoaded.clear();
      insertsGeneration = engine.current.generation;
    }
    const started = Date.now();
    try {
      const links = chain as Array<{ id: string; kind: string; plugin?: string }>;
      // Parte D: -2 - n is bus n's chain (shared/mix.ts, busChainKey).
      const key = Number(strip);
      const reply = await engine.request(key <= -2 ? { type: "inserts", bus: -2 - key, chain: links } : { type: "inserts", strip: key, chain: links });
      const errors = Array.isArray(reply.errors) ? (reply.errors as Array<{ id: string; error: string }>) : [];
      for (const x of links) {
        if (x.kind !== "plugin" || !x.plugin || errors.some((e) => e.id === x.id)) continue;
        if (insertsLoaded.get(x.id) === x.plugin) continue;
        insertsLoaded.set(x.id, x.plugin);
        appendLog({ type: "engine_insert_loaded", id: x.id, plugin: x.plugin, ms: Date.now() - started });
        const state = songs?.pluginState(x.id, x.plugin);
        if (state) {
          const set = await engine.request({ type: "setInsertState", id: x.id, data: state });
          appendLog({ type: "engine_insert_state_restored", id: x.id, ok: !!set.ok });
        }
      }
      for (const e of errors) appendLog({ type: "engine_insert_failed", ...e });
      return { ok: true, errors, latency: Number(reply.latency ?? 0), compensation: Number(reply.compensation ?? 0) };
    } catch (error) {
      return { ok: false, errors: [{ id: "", error: (error as Error).message }] };
    }
  });
  // The AI's plugin parameters (and undoing them): the window says which value each must have.
  ipcMain.on(CH.engineSetParam, (_e, id: unknown, index: unknown, value: unknown) => {
    if (!engine || engine.current.state !== "ready") return;
    void engine.request({ type: "setParam", id: String(id), index: Number(index), value: Number(value) }).catch(() => {});
  });
  // F2.2 part C2: how much each compressor or limiter is reducing now (its window's meter).
  ipcMain.handle(CH.engineReductions, async (_e, ids: unknown) => {
    if (!engine || engine.current.state !== "ready" || !Array.isArray(ids)) return null;
    try {
      const reply = await engine.request({ type: "reductions", ids: ids.map(String) });
      return (reply.values ?? {}) as Record<string, number>;
    } catch {
      return null;
    }
  });
  ipcMain.handle(CH.engineShowInsert, async (_e, id: unknown) => {
    try {
      return !!(await engineHost().request({ type: "showInsert", id: String(id) })).ok;
    } catch {
      return false;
    }
  });
  // F2.2 (04/11/2026): where the song is, for the plugins' transport.
  // While exporting, the engine plays the song from the export only (F2.4): the window's notes wait.
  ipcMain.on(CH.engineTransport, (_e, points: unknown) => {
    if (!exportJob && Array.isArray(points) && points.length) engine?.send({ type: "transport", points });
  });
  ipcMain.on(CH.engineMidi, (_e, events: EngineMidiEvent[]) => {
    if (!exportJob && Array.isArray(events) && events.length) engine?.send({ type: "midi", events });
  });
  ipcMain.on(CH.enginePanic, () => !exportJob && engine?.send({ type: "panic" }));
  registerExport();
  // F2.1: the built-in sounds in the engine.
  ipcMain.handle(CH.engineSounds, (_e, id: unknown, offset: unknown) => loadEngineSounds(String(id), Number(offset)));
  // F2.2: levels of every strip since playback started (reset at its start), for the log and the AI.
  ipcMain.handle(CH.engineLevels, async (_e, reset: unknown) => {
    if (!engine || engine.current.state !== "ready") return null;
    try {
      const reply = await engine.request({ type: reset ? "resetLevels" : "levels" });
      // What the AI reads with get_levels: the last playback's levels, as the window asked them.
      if (!reset) {
        lastLevels = { levels: reply as unknown as EngineLevels, at: Date.now(), strips: { ...trackStrips }, buses: { ...busIndexes } };
        // F2.3: and what it sounded like (loudness, bands, stereo), for analyze_mix.
        void engine
          .request({ type: "analysis" })
          .then((a) => {
            const analysis = parseAnalysis(a);
            if (!analysis?.master?.frames.length) return;
            lastAnalysis = { analysis, at: Date.now(), strips: { ...trackStrips }, buses: { ...busIndexes } };
            appendLog({ type: "engine_analysis", seconds: analysis.master.seconds, lufs: analysis.master.integrated, truePeak: analysis.master.truePeak, strips: analysis.strips.length, buses: analysis.buses.length, gaps: analysis.gaps });
          })
          .catch(() => {});
      }
      return reply;
    } catch {
      return null;
    }
  });
  ipcMain.on(CH.engineMix, (_e, channels: unknown, master: unknown, buses: unknown) => {
    if (!Array.isArray(channels)) return;
    for (const c of channels as Array<{ ch?: unknown; track?: unknown }>) if (typeof c?.track === "string") trackStrips[c.track] = Number(c.ch);
    const message: Record<string, unknown> = { type: "mix", channels };
    if (typeof master === "number" && Number.isFinite(master)) message.master = master;
    // Parte D: the buses' faders; the main process keeps where each bus is, for the AI's levels.
    if (Array.isArray(buses)) {
      message.buses = buses;
      for (const b of buses as Array<{ bus?: unknown; id?: unknown }>) if (typeof b?.id === "string") busIndexes[b.id] = Number(b.bus);
    }
    engine?.send(message);
  });
  ipcMain.on(CH.engineRouting, (_e, routing: unknown) => {
    if (!routing || typeof routing !== "object") return;
    engine?.send({ type: "routing", ...(routing as Record<string, unknown>) });
  });
  // F2.2 part B: the console's meters (~30 times a second, only with the console open) and the
  // engine's load for «Carga». Never start the engine for them.
  ipcMain.handle(CH.engineMeters, async () => {
    if (!engine || engine.current.state !== "ready") return null;
    try {
      return await engine.request({ type: "meters" });
    } catch {
      return null;
    }
  });
  ipcMain.handle(CH.engineStats, async () => {
    if (!engine || engine.current.state !== "ready") return null;
    try {
      const reply = (await engine.request({ type: "stats" })) as Record<string, number>;
      const load = engineLoad(reply);
      lastLoad = load;
      if (load.dropouts > 0 || (load.cost && (load.cost.late > 0 || load.cost.gaps > 0)))
        appendLog({
          type: "engine_dropouts",
          count: load.dropouts,
          maxLoad: Math.round(load.maxLoad * 100) / 100,
          // 09/11/2026: notes that came late, blocks the device asked for late, and how busy the message thread was.
          ...(load.cost ? { late: load.cost.late, gaps: load.cost.gaps, gapMaxMs: Math.round(load.cost.gapMax), messageStallMs: Math.round(load.cost.messageStall) } : {}),
        });
      return load;
    } catch {
      return null;
    }
  });
  ipcMain.handle(CH.builtinSounds, () => (readSettings().builtinSounds === "app" ? "app" : "engine"));
  // Ajustes: folders, test tools and where the engine looks for plugins.
  ipcMain.handle(CH.folders, () => userFolders());
  ipcMain.on(CH.openFolder, (_e, kind: unknown) => {
    const dir = userFolders()[kind as FolderKind];
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    void shell.openPath(dir);
  });
  ipcMain.on(CH.openTool, (_e, kind: unknown) => {
    const tool = kind as ToolKind;
    appendLog({ type: "tool_opened", tool });
    if (tool === "soundTest") void openSoundTest();
    else if (tool === "blind") void openBlindListening();
    else if (tool === "devTools") win?.webContents.toggleDevTools();
  });
  ipcMain.handle(CH.pluginFolders, () => pluginFolders());
  ipcMain.handle(CH.soundPrefs, () => cleanSoundPrefs(readSettings().soundPrefs));
  ipcMain.handle(CH.soundPrefsSet, (_e, prefs: unknown) => {
    const next = cleanSoundPrefs(prefs);
    writeSettings({ soundPrefs: next });
    return next;
  });
  ipcMain.handle(CH.libraries, () => catalog().read());
  ipcMain.handle(CH.librarySave, (_e, card: unknown) => catalog().save(card));
  catalog().onChange((c) => win?.webContents.send(CH.librariesChanged, c));
  ipcMain.handle(CH.pluginFoldersAdd, async () => {
    if (!win) return pluginFolders();
    const pick = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    const dir = pick.canceled ? null : pick.filePaths[0];
    if (dir) {
      const now = readSettings().pluginFolders ?? [];
      if (!now.includes(dir)) writeSettings({ pluginFolders: [...now, dir] });
      appendLog({ type: "plugin_folder_added", dir });
    }
    return pluginFolders();
  });
  ipcMain.handle(CH.pluginFoldersRemove, (_e, dir: unknown) => {
    writeSettings({ pluginFolders: (readSettings().pluginFolders ?? []).filter((d) => d !== dir) });
    return pluginFolders();
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
  setInterval(() => void watchPluginStates(), 20_000).unref();
  // The engine's list of plugins, for the AI (it starts the engine; nothing if it is not built).
  if (findEngine()) {
    void engineHost()
      .request({ type: "plugins" })
      .then((r) => (knownPlugins = pluginsOf(r)))
      .catch(() => {});
  }
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
  // With plugin tracks the song is saved even without changes: what the plugins have loaded goes in
  // (F2.1). Then the engine closes.
  const song = songs.snapshot().song;
  const plugins = song.trackOrder.some((id) => song.tracks[id]?.output === "plugin");
  const saved = plugins && engine?.current.state === "ready" ? songs.saveNow() : songs.flush();
  void Promise.all([saved, aiServer?.stop()]).finally(() => {
    engine?.stop();
    appendLog({ type: "app_closed" });
    app.quit();
  });
});

app.on("window-all-closed", () => app.quit());

