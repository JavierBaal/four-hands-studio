/**
 * The window's only door to the main process (contextIsolation + sandbox).
 * Shape: `Bridge` in src/renderer/bridge.ts. The S0 sound test uses `info`, `soundFont` and `log`.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

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
});
