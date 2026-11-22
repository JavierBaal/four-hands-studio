/**
 * Ajustes: one card with its sections
 * on the left. What used to hang from the Help menu lives here: Tu IA, the sound banks, the
 * plugins, the MIDI out, the folders and the test tools. The gear in the top bar, File › Ajustes…
 * or Ctrl + , open it; Esc, the cross or a click outside close it.
 */
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PluginFolders } from "../../shared/engine.js";
import { pluginKey } from "../../shared/sound-catalog.js";
import type { Strings } from "../../shared/i18n.js";
import type { FolderKind, Folders, ToolKind } from "../../shared/protocol.js";
import type { AudioLayer } from "../audio-layer.js";
import { useActions, useApp } from "../context.js";
import { SETTINGS_SECTIONS, type SettingsSection } from "../song-actions.js";
import { AiIcon, CloseIcon, FolderIcon, KeysIcon, MidiIcon, PlugIcon, ToolsIcon } from "./Icons.js";
import { MidiSettings } from "./MidiOutPanel.js";
import { AiSettings } from "./SkillsPanel.js";
import { SoundSettings } from "./SoundsHelp.js";

const NAV: Record<SettingsSection, { label: keyof Strings; icon: () => ReactNode }> = {
  ai: { label: "setAi", icon: AiIcon },
  sound: { label: "setSound", icon: KeysIcon },
  plugins: { label: "setPlugins", icon: PlugIcon },
  midi: { label: "setMidi", icon: MidiIcon },
  folders: { label: "setFolders", icon: FolderIcon },
  advanced: { label: "setAdvanced", icon: ToolsIcon },
};

export function Settings({ audio }: { audio: AudioLayer }) {
  const { t } = useApp();
  const actions = useActions();
  const ref = useRef<HTMLDivElement>(null);
  const section = actions.settings;
  useEffect(() => {
    if (!section) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      actions.openSettings(null);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [section !== null]);
  if (!section) return null;
  return (
    <div className="setveil" onPointerDown={(e) => e.target === e.currentTarget && actions.openSettings(null)}>
      <div className="settings" ref={ref} role="dialog" aria-label={t("setTitle")} data-section={section}>
        <nav className="setnav" aria-label={t("setTitle")}>
          <div className="settitle">{t("setTitle")}</div>
          {SETTINGS_SECTIONS.map((id) => {
            const Icon = NAV[id].icon;
            return (
              <button key={id} className={id === section ? "setnavb on" : "setnavb"} aria-current={id === section ? "page" : undefined} onClick={() => actions.openSettings(id)} data-section={id}>
                <Icon />
                <span>{t(NAV[id].label)}</span>
              </button>
            );
          })}
        </nav>
        <section className="setpane">
          <div className="setphead">
            <h2>{t(NAV[section].label)}</h2>
            <button className="ibtn" aria-label={t("close")} title={`${t("close")} (Esc)`} onClick={() => actions.openSettings(null)}>
              <CloseIcon />
            </button>
          </div>
          {section === "ai" && <AiSettings />}
          {section === "sound" && <SoundSettings audio={audio} />}
          {section === "plugins" && <PluginSettings audio={audio} />}
          {section === "midi" && <MidiSettings audio={audio} />}
          {section === "folders" && <FolderSettings />}
          {section === "advanced" && <AdvancedSettings />}
        </section>
      </div>
    </div>
  );
}

/** Ajustes › Plugins: what the engine found, looking again (in the background), and where it looks. */
function PluginSettings({ audio }: { audio: AudioLayer }) {
  const { t, bridge, lang } = useApp();
  useSyncExternalStore(audio.subscribe, audio.getVersion);
  const [folders, setFolders] = useState<PluginFolders | null>(null);
  useEffect(() => {
    void bridge.pluginFolders().then(setFolders);
    if (!audio.pluginList && !audio.pluginScan) void audio.loadPlugins(false);
  }, []);
  const list = audio.pluginList;
  const scan = audio.pluginScan;
  const engine = audio.engineStatus;
  const missing = engine.state === "missing" || (list?.error && /not built/.test(list.error));
  const instruments = list?.plugins.filter((p) => p.instrument).length ?? 0;
  const when = list?.scannedAt ? new Date(list.scannedAt).toLocaleString(lang === "es" ? "es-ES" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
  const file = scan?.file.split(/[\\/]/).pop() ?? "";
  return (
    <div className="setplugins">
      <div className="setcard">
        {missing ? (
          <p className="setstatus">
            <span className="dot off" />
            {t("engineMissing")}
          </p>
        ) : (
          <div className="setrow">
            <div>
              <div className="setbig">{list ? t("setPluginsCount", { all: list.plugins.length, instruments }) : t("setPluginsAsking")}</div>
              <div className="hint">{when ? t("setPluginsWhen", { when }) : list && !list.error ? t("setPluginsNever") : list?.error ?? ""}</div>
            </div>
            <button className="btn pri" disabled={!!scan} onClick={() => void audio.loadPlugins(true)}>
              {list?.scannedAt ? t("setPluginsRescan") : t("pluginsScan")}
            </button>
          </div>
        )}
        {scan && (
          <div className="setscan" role="status">
            <div className="hint">{t("setPluginsScanning", { pct: Math.round(scan.progress * 100), file })}</div>
            <div className="setprog">
              <i style={{ width: `${Math.max(2, Math.round(scan.progress * 100))}%` }} />
            </div>
            <div className="hint">{t("setPluginsScanHint")}</div>
          </div>
        )}
      </div>
      <div className="mhead">{t("setPluginsWhere")}</div>
      <ul className="setlist">
        {folders?.system.map((d) => (
          <li key={d}>
            <span className="setpath mono">{d}</span>
            <span className="setmeta">{t("setPluginsAlways")}</span>
          </li>
        ))}
        {folders?.user.map((d) => (
          <li key={d}>
            <span className="setpath mono">{d}</span>
            <button className="linkbtn" onClick={() => void bridge.removePluginFolder(d).then(setFolders)}>
              {t("setRemove")}
            </button>
          </li>
        ))}
      </ul>
      <div className="qbtns left">
        <button className="btn" onClick={() => void bridge.addPluginFolder().then(setFolders)}>
          {t("setPluginsAdd")}
        </button>
      </div>
      <div className="mhead">{t("setHidden")}</div>
      {audio.soundPrefs.hidden.length === 0 ? (
        <p className="hint">{t("setHiddenNone")}</p>
      ) : (
        <ul className="setlist sethidden">
          {audio.soundPrefs.hidden.map((key) => (
            <li key={key}>
              <span className="setname">{list?.plugins.find((p) => pluginKey(p.id) === key)?.name ?? key.replace(/^plugin:/, "")}</span>
              <button className="linkbtn" onClick={() => audio.updateSoundPrefs((p) => ({ ...p, hidden: p.hidden.filter((k) => k !== key) }))}>
                {t("setShow")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {engine.state === "ready" && (
        <>
          <div className="mhead">{t("setEngine")}</div>
          <ul className="setlist">
            <li>
              <span>{t("setEngineOut")}</span>
              <span className="setmeta mono">{engine.device}</span>
            </li>
            <li>
              <span>{t("setEngineDelay")}</span>
              <span className="setmeta mono">{Math.round((engine.latency ?? 0) * 1000)} ms</span>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}

const FOLDERS: { kind: FolderKind; label: keyof Strings }[] = [
  { kind: "songs", label: "setFolderSongs" },
  { kind: "backups", label: "setFolderBackups" },
  { kind: "sounds", label: "setFolderSounds" },
  { kind: "skills", label: "setFolderSkills" },
];

/** Ajustes › Carpetas: where the songs, copies, sounds and skills are, each with "Abrir". */
function FolderSettings() {
  const { t, bridge } = useApp();
  const [folders, setFolders] = useState<Folders | null>(null);
  useEffect(() => void bridge.folders().then(setFolders), []);
  return (
    <ul className="setlist setfolders">
      {FOLDERS.map((f) => (
        <li key={f.kind}>
          <div>
            <div>{t(f.label)}</div>
            <div className="setpath mono">{folders?.[f.kind] ?? ""}</div>
          </div>
          <button className="btn" onClick={() => bridge.openFolder(f.kind)}>
            {t("setOpen")}
          </button>
        </li>
      ))}
    </ul>
  );
}

const TOOLS: { kind: ToolKind; label: keyof Strings; hint: keyof Strings }[] = [
  { kind: "soundTest", label: "menuSoundTest", hint: "setToolSoundTest" },
  { kind: "blind", label: "menuBlind", hint: "setToolBlind" },
  { kind: "devTools", label: "menuDevTools", hint: "setToolDevTools" },
];

/** Ajustes › Avanzado: the test windows and the developer tools. */
function AdvancedSettings() {
  const { t, bridge } = useApp();
  return (
    <ul className="setlist setfolders">
      {TOOLS.map((tool) => (
        <li key={tool.kind}>
          <div>
            <div>{t(tool.label)}</div>
            <div className="hint">{t(tool.hint)}</div>
          </div>
          <button className="btn" onClick={() => bridge.openTool(tool.kind)}>
            {t("setOpen")}
          </button>
        </li>
      ))}
    </ul>
  );
}
