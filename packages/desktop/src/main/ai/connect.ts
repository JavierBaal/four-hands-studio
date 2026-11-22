/**
 * "Conectar con Claude" (docs/mcp.md, 2): hands the bridge extension (.mcpb) to Claude Desktop,
 * in the order proven on Windows on 13/10/2026:
 *   1. the .mcpb file association, if Windows has one;
 *   2. the `claude-desktop.exe` execution alias, with the file as argument (Microsoft Store version);
 *   3. as a last resort, the file shown in the Explorer with its path copied, for
 *      Settings > Extensions > Advanced settings > Install extension…
 * Never `start` without an association: that brings up Windows' app picker.
 * On a Mac, `open -a Claude` with the file (still to be tried on a real Mac).
 */
import { exec, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** The newest fourhands-mcp-*.mcpb in these folders. */
export function findMcpb(dirs: readonly string[]): string | null {
  const found: { file: string; mtime: number }[] = [];
  for (const dir of dirs) {
    if (!dir) continue;
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/^fourhands-mcp-.*\.mcpb$/i.test(name)) continue;
      const file = path.join(dir, name);
      try {
        found.push({ file, mtime: fs.statSync(file).mtimeMs });
      } catch {
        /* vanished */
      }
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0]?.file ?? null;
}

const run = (cmd: string) =>
  new Promise<{ ok: boolean; out: string }>((resolve) => exec(cmd, { windowsHide: true }, (err, stdout) => resolve({ ok: !err, out: String(stdout ?? "").trim() })));

export interface ConnectResult {
  ok: boolean;
  method: "assoc" | "alias" | "explorer" | "open-a-claude" | "unsupported";
  detail?: string;
}

export async function connectClaude(mcpb: string): Promise<ConnectResult> {
  const q = `"${mcpb}"`;
  if (process.platform === "win32") {
    const assoc = await run("cmd /c assoc .mcpb");
    if (assoc.ok && /\.mcpb=/i.test(assoc.out)) {
      const r = await run(`cmd /c start "" ${q}`);
      if (r.ok) return { ok: true, method: "assoc", detail: assoc.out };
    }
    const alias = await run("where claude-desktop.exe");
    if (alias.ok && alias.out) {
      const exe = alias.out.split(/\r?\n/)[0]!.trim();
      try {
        const child = spawn(exe, [mcpb], { detached: true, stdio: "ignore", windowsHide: false });
        child.on("error", () => {});
        child.unref();
        return { ok: true, method: "alias", detail: exe };
      } catch {
        /* fall through to the Explorer */
      }
    }
    const psPath = mcpb.replace(/'/g, "''");
    const clip = await run(`powershell -NoProfile -Command "Set-Clipboard -Value '${psPath}'"`);
    await run(`explorer.exe /select,${q}`); // explorer answers 1 even when it works
    return { ok: true, method: "explorer", detail: clip.ok ? "path copied" : "" };
  }
  if (process.platform === "darwin") {
    const r = await run(`open -a Claude ${q}`);
    if (r.ok) return { ok: true, method: "open-a-claude" };
    await run(`open -R ${q}`);
    return { ok: true, method: "explorer" };
  }
  return { ok: false, method: "unsupported" };
}
