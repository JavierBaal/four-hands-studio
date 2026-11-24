/**
 * Export (F2.4): where the files go and what they are called. Documents/Four Hands/Exportaciones,
 * named after the song, never over an earlier export (docs/audio-engine.md, 10).
 */
import path from "node:path";

export { exportBaseName } from "../../shared/export.js";

/** The folder's name is the same in both languages: the user finds it by it. */
export const EXPORTS_FOLDER = "Exportaciones";

export function defaultExportFolder(songsDir: string): string {
  return path.join(songsDir, EXPORTS_FOLDER);
}

/**
 * The first base name free for every format of this export: "Invasion", then "Invasion (2)"…
 * The WAV and the MP3 of one export always share it.
 */
export function freeBaseName(folder: string, base: string, extensions: readonly string[], exists: (file: string) => boolean): string {
  const taken = (name: string) => extensions.some((ext) => exists(path.join(folder, `${name}.${ext}`)) || exists(path.join(folder, `${name}.${ext}.part`)));
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const name = `${base} (${n})`;
    if (!taken(name)) return name;
  }
}
