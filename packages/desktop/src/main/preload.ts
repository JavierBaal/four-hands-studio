import { contextBridge, ipcRenderer } from "electron";

export interface FhBridge {
  info(): Promise<{
    soundFont: string | null;
    logFile: string;
    versions: { electron: string; chrome: string; node: string };
    platform: string;
    arch: string;
  }>;
  soundFont(): Promise<ArrayBuffer | null>;
  log(entry: Record<string, unknown>): void;
}

const api: FhBridge = {
  info: () => ipcRenderer.invoke("fh:info"),
  soundFont: () => ipcRenderer.invoke("fh:soundfont"),
  log: (entry) => ipcRenderer.send("fh:log", entry),
};

contextBridge.exposeInMainWorld("fh", api);
