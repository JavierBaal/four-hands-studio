/**
 * Disk writes that never leave a half-written song (ARQUITECTURA.md, 9):
 * write a temporary file next to the target, then rename it over the target.
 * Plus rotating backups, so there is always an earlier copy to go back to.
 */
import fs from "node:fs";
import path from "node:path";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** On Windows a rename can briefly fail while an antivirus or indexer holds the file. */
async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await fs.promises.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (i >= attempts - 1 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      await sleep(50 * (i + 1));
    }
  }
}

export async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const handle = await fs.promises.open(tmp, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await renameWithRetry(tmp, file);
  } catch (error) {
    await fs.promises.rm(tmp, { force: true });
    throw error;
  }
}

function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Copies `file` into `dir` as `<name>-<date>.fourhands` and keeps only the newest `keep` copies of it.
 * Does nothing if the file does not exist yet.
 */
export async function backup(file: string, dir: string, now: number, keep = 10): Promise<string | null> {
  if (!fs.existsSync(file)) return null;
  await fs.promises.mkdir(dir, { recursive: true });
  const base = path.basename(file, path.extname(file));
  const target = path.join(dir, `${base}-${stamp(now)}${path.extname(file)}`);
  await fs.promises.copyFile(file, target);
  const prefix = `${base}-`;
  const copies = (await fs.promises.readdir(dir))
    .filter((f) => f.startsWith(prefix) && /^\d{8}-\d{6}$/.test(f.slice(prefix.length, prefix.length + 15)))
    .sort();
  for (const old of copies.slice(0, Math.max(0, copies.length - keep))) await fs.promises.rm(path.join(dir, old), { force: true });
  return target;
}

/** `dir/name.ext`, or `dir/name 2.ext`, `dir/name 3.ext`… whichever does not exist yet. */
export function uniquePath(dir: string, name: string, ext: string): string {
  const clean = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim() || "Sin título";
  let candidate = path.join(dir, `${clean}${ext}`);
  for (let n = 2; fs.existsSync(candidate); n++) candidate = path.join(dir, `${clean} ${n}${ext}`);
  return candidate;
}
