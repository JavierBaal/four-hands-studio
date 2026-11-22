/**
 * Sound banks the user installs (14/10/2026): every SF2 / SF3 in the sounds folder
 * (Documentos\Four Hands\Sonidos), plus recursos\soundfonts next to the repo in a development checkout.
 * The default bank (MuseScore_General) is not listed: it is the one every track uses unless it
 * chooses another. Files are read only when a track uses them; their presets come from the header.
 */
import fs from "node:fs";
import path from "node:path";
import { type BankHeader, type BankPreset, bankDisplayName, readBankHeader } from "../shared/soundbank-info.js";
import type { SoundBankInfo } from "../shared/protocol.js";

export class SoundLibrary {
  private cache = new Map<string, { mtimeMs: number; size: number; header: BankHeader | null }>();
  private watchers: fs.FSWatcher[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param userDir where the user puts banks (created if missing)
   * @param extraDirs other folders to look in (with their `candidatos` subfolder)
   * @param defaultFile the default bank, left out of the list
   */
  constructor(
    readonly userDir: string,
    private readonly extraDirs: string[],
    private readonly defaultFile: string | null,
  ) {
    try {
      fs.mkdirSync(userDir, { recursive: true });
    } catch {
      /* read-only documents: the other folders still work */
    }
  }

  private dirs(): string[] {
    const out: string[] = [];
    for (const dir of [this.userDir, ...this.extraDirs]) for (const d of [dir, path.join(dir, "candidatos")]) if (!out.includes(d) && fs.existsSync(d)) out.push(d);
    return out;
  }

  /** Bank files by file name (the first folder wins on a repeated name). */
  files(): Map<string, string> {
    const found = new Map<string, string>();
    const skip = this.defaultFile ? path.resolve(this.defaultFile) : null;
    for (const dir of this.dirs()) {
      let names: string[] = [];
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names.sort()) {
        if (!/\.sf[23]$/i.test(name) || found.has(name)) continue;
        const file = path.join(dir, name);
        if (path.resolve(file) === skip) continue;
        found.set(name, file);
      }
    }
    return found;
  }

  header(file: string): BankHeader | null {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      return null;
    }
    const hit = this.cache.get(file);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.header;
    let header: BankHeader | null = null;
    let fd: number | null = null;
    try {
      fd = fs.openSync(file, "r");
      const handle = fd;
      header = readBankHeader((pos, len) => {
        const buf = Buffer.alloc(len);
        const n = fs.readSync(handle, buf, 0, len, pos);
        return buf.subarray(0, n);
      }, stat.size);
    } catch {
      header = null; // not a SoundFont, or damaged: left out of the list
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
    this.cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, header });
    return header;
  }

  /** The default bank's presets with their profiles (the built-in palette's sounds). */
  defaultPresets(): BankPreset[] {
    return this.defaultFile ? (this.header(this.defaultFile)?.presets ?? []) : [];
  }

  list(): SoundBankInfo[] {
    const out: SoundBankInfo[] = [];
    for (const [id, file] of this.files()) {
      const header = this.header(file);
      if (!header || header.presets.length === 0) continue;
      const presets = header.presets.filter((p) => p.bankMSB < 128); // percussion kits stay with the default bank
      if (presets.length === 0) continue;
      out.push({ id, name: bankDisplayName(header, id), presets, bytes: fs.statSync(file).size, inUserFolder: path.dirname(file) === this.userDir });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async load(id: string): Promise<ArrayBuffer | null> {
    const file = this.files().get(id);
    if (!file) return null;
    const buf = await fs.promises.readFile(file);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }

  /** Copies banks into the user folder. Returns the names copied (others were not SoundFonts). */
  async import(files: string[]): Promise<string[]> {
    const done: string[] = [];
    for (const src of files) {
      if (!/\.sf[23]$/i.test(src)) continue;
      const name = path.basename(src);
      const dest = path.join(this.userDir, name);
      if (path.resolve(src) === path.resolve(dest)) continue;
      try {
        await fs.promises.copyFile(src, dest);
        done.push(name);
      } catch {
        /* unreadable source: skipped */
      }
    }
    return done;
  }

  /** Calls back (debounced) when a bank is added, removed or replaced in any folder. */
  watch(onChange: () => void): void {
    for (const dir of this.dirs()) {
      try {
        this.watchers.push(
          fs.watch(dir, () => {
            if (this.timer) clearTimeout(this.timer);
            this.timer = setTimeout(onChange, 800);
          }),
        );
      } catch {
        /* no watching on this folder: the list refreshes when the app opens */
      }
    }
  }
}
