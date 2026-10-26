/**
 * The window's only door to the main process (contextIsolation + sandbox).
 * Shape: `Bridge` in src/renderer/bridge.ts. The S0 sound test uses `info`, `soundFont` and `log`.
 */
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";

// Channel names repeated here on purpose: the sandboxed preload cannot import other modules.
const CH = {
  snapshot: "fh:snapshot",
  request: "fh:request",
  patch: "fh:patch",
  file: "fh:file",
  reload: "fh:reload",
  soundFont: "fh:soundfont",
  info: "fh:info",
  log: "fh:log",
  menu: "fh:menu",
  sfList: "fh:sf-list",
  sfLoad: "fh:sf-load",
  sounds: "fh:sounds",
  soundBank: "fh:sound-bank",
  soundsChanged: "fh:sounds-changed",
  soundsFolder: "fh:sounds-folder",
  soundsImport: "fh:sounds-import",
  openLink: "fh:open-link",
  ai: "fh:ai",
  aiState: "fh:ai-state",
  aiClose: "fh:ai-close",
  aiMarkSeen: "fh:ai-mark-seen",
  viewInfo: "fh:view-info",
  connectClaude: "fh:connect-claude",
  save: "fh:save",
  skills: "fh:skills",
  skillsEnable: "fh:skills-enable",
  skillsImport: "fh:skills-import",
  skillsPick: "fh:skills-pick",
  skillsFolder: "fh:skills-folder",
  songBefore: "fh:song-before",
  aiTone: "fh:ai-tone",
  aiToneSet: "fh:ai-tone-set",
  aiApply: "fh:ai-apply",
  aiApplySet: "fh:ai-apply-set",
  midiOut: "fh:midi-out",
  midiOutSet: "fh:midi-out-set",
  exportMidi: "fh:export-midi",
} as const;

function listen(channel: string, listener: (value: unknown) => void): () => void {
  const fn = (_e: IpcRendererEvent, value: unknown) => listener(value);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
}

contextBridge.exposeInMainWorld("fh", {
  info: () => ipcRenderer.invoke(CH.info),
  snapshot: () => ipcRenderer.invoke(CH.snapshot),
  request: (request: unknown) => ipcRenderer.invoke(CH.request, request),
  onPatch: (l: (v: unknown) => void) => listen(CH.patch, l),
  onFile: (l: (v: unknown) => void) => listen(CH.file, l),
  onReload: (l: () => void) => listen(CH.reload, () => l()),
  onMenu: (l: (v: unknown) => void) => listen(CH.menu, l),
  soundFont: () => ipcRenderer.invoke(CH.soundFont),
  log: (entry: Record<string, unknown>) => ipcRenderer.send(CH.log, entry),
  sfList: () => ipcRenderer.invoke(CH.sfList),
  sfLoad: (index: number) => ipcRenderer.invoke(CH.sfLoad, index),
  sounds: () => ipcRenderer.invoke(CH.sounds),
  soundBank: (id: string) => ipcRenderer.invoke(CH.soundBank, id),
  onSoundsChanged: (l: () => void) => listen(CH.soundsChanged, () => l()),
  openSoundsFolder: () => ipcRenderer.send(CH.soundsFolder),
  importSounds: (files: File[]) => ipcRenderer.invoke(CH.soundsImport, files.map((f) => webUtils.getPathForFile(f))),
  openLink: (url: string) => ipcRenderer.send(CH.openLink, url),
  ai: () => ipcRenderer.invoke(CH.ai),
  onAiState: (l: (v: unknown) => void) => listen(CH.aiState, l),
  closeIntervention: (id: string) => ipcRenderer.send(CH.aiClose, id),
  markSeen: (id: string) => ipcRenderer.send(CH.aiMarkSeen, id),
  viewInfo: (info: unknown) => ipcRenderer.send(CH.viewInfo, info),
  connectClaude: () => ipcRenderer.send(CH.connectClaude),
  save: () => ipcRenderer.send(CH.save),
  skills: () => ipcRenderer.invoke(CH.skills),
  setSkillEnabled: (name: string, on: boolean) => ipcRenderer.invoke(CH.skillsEnable, name, on),
  importSkills: (files: File[]) => ipcRenderer.invoke(CH.skillsImport, files.map((f) => webUtils.getPathForFile(f))),
  pickSkills: () => ipcRenderer.invoke(CH.skillsPick),
  openSkillsFolder: () => ipcRenderer.send(CH.skillsFolder),
  songBefore: () => ipcRenderer.invoke(CH.songBefore),
  aiTone: () => ipcRenderer.invoke(CH.aiTone),
  setAiTone: (tone: string) => ipcRenderer.invoke(CH.aiToneSet, tone),
  aiApply: () => ipcRenderer.invoke(CH.aiApply),
  setAiApply: (mode: string) => ipcRenderer.invoke(CH.aiApplySet, mode),
  midiOutPort: () => ipcRenderer.invoke(CH.midiOut),
  setMidiOutPort: (name: string | null) => ipcRenderer.invoke(CH.midiOutSet, name),
  exportMidi: () => ipcRenderer.send(CH.exportMidi),
});
