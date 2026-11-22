/**
 * The demo song (Invasion): what the app opens the first time, and what Help > Open the demo song
 * opens again. The copy that travels with the app is never opened in place: the user gets a copy in
 * their songs folder, so it saves like any other song and the original stays as it was.
 */
import fs from "node:fs";
import path from "node:path";
import { uniquePath } from "./files.js";

export const DEMO_FILE = "Invasion.fourhands";
export const DEMO_NAME = "Invasion (demo)";

/**
 * Copies the bundled demo into `songsDir` under a name that is free ("Invasion (demo)",
 * "Invasion (demo) 2"…) and returns the copy's path, or null when the app has no demo.
 */
export function copyDemo(bundled: string, songsDir: string): string | null {
  if (!fs.existsSync(bundled)) return null;
  fs.mkdirSync(songsDir, { recursive: true });
  const target = uniquePath(songsDir, DEMO_NAME, path.extname(bundled));
  fs.copyFileSync(bundled, target);
  return target;
}
