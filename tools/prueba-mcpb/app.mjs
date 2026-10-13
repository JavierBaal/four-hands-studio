// Four Hands Studio · app de prueba para la instalación del puente .mcpb
// Hace de "app abierta": guarda la canción de prueba, escucha en 127.0.0.1 con token,
// atiende al puente y enseña en el navegador lo que hace la IA.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { SONG, overviewText, overviewStructured, parseRange, resolveTracks } from "./song.mjs";
import PAGE from "./page.html";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCPB = path.resolve(HERE, "..", "fourhands-prueba.mcpb");
const LOG_FILE = path.join(HERE, "registro-prueba.jsonl");
const PREFERRED_PORT = 47474;

function configDir() {
  if (process.platform === "win32")
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "FourHandsStudio");
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", "FourHandsStudio");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "FourHandsStudio");
}
const CONFIG_FILE = path.join(configDir(), "bridge.json");
const TOKEN = crypto.randomBytes(24).toString("hex");

// ---------- Registro ----------
const events = [];
function record(type, data = {}) {
  const ev = { t: new Date().toISOString(), type, ...data };
  events.push(ev);
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(ev) + "\n"); } catch {}
  broadcast({ type: "event", event: ev });
  return ev;
}

// ---------- Estado ----------
const state = { bridge: null, marks: [], startedAt: new Date().toISOString(), platform: process.platform, node: process.version };
let markSeq = 0;

// ---------- Herramientas ----------
function handle(tool, args = {}) {
  if (tool === "get_song_overview") {
    return { ok: true, text: overviewText(), structured: overviewStructured() };
  }
  if (tool === "point_to") {
    if (!args.reason || !String(args.reason).trim()) return { ok: false, error: "point_to needs a short reason for the user." };
    const r = parseRange(args.range || "");
    if (!r.ok) return r;
    const tr = resolveTracks(args.tracks);
    if (!tr.ok) return tr;
    const mark = { id: `a${++markSeq}`, from: r.from, to: r.to, label: r.label, tracks: tr.tracks.map((t) => ({ id: t.id, name: t.name })), reason: String(args.reason).trim(), at: new Date().toISOString() };
    state.marks.unshift(mark);
    broadcast({ type: "mark", mark });
    const where = `bars ${r.from}-${r.to}` + (mark.tracks.length ? ` · ${mark.tracks.map((t) => t.name).join(", ")}` : "");
    return { ok: true, text: `Pointed (${mark.id}) to ${where}. The user sees the mark; their view did not move.`, structured: { mark } };
  }
  return { ok: false, error: `Unknown tool ${tool}.` };
}

// ---------- HTTP ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(PAGE);
  }
  if (req.method === "POST" && url.pathname === "/connect-claude") {
    if (!sameOrigin(req)) { res.writeHead(403); return res.end(); }
    const forced = url.searchParams.get("method"); // "explorer" cuando el usuario dice que no se abrió nada
    const reply = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (!fs.existsSync(MCPB)) { record("connect_button", { mcpb: MCPB, exists: false }); return reply(404, { ok: false, error: `No encuentro ${MCPB}` }); }
    connectClaude(forced).then((r) => { record("connect_button", { mcpb: MCPB, ...r }); reply(200, r); });
    return;
  }
  res.writeHead(404); res.end();
});

function sameOrigin(req) {
  const o = req.headers.origin;
  const addr = server.address();
  return !o || o === `http://127.0.0.1:${addr.port}` || o === `http://localhost:${addr.port}`;
}


// ---------- Conectar con Claude ----------
// Windows: la versión MSIX de Claude Desktop no registra la extensión .mcpb (comprobado el 13/10/2026,
// Claude 2.31226.1.0). Nunca llamamos a "start" sin asociación, porque saca el selector de Windows.
// Orden: 1) asociación .mcpb si existe; 2) alias de ejecución claude-desktop.exe con el archivo como
// argumento; 3) Explorador con el archivo seleccionado para arrastrarlo a la ventana de Claude.
const run = (cmd) => new Promise((resolve) => exec(cmd, { windowsHide: true }, (err, stdout) => resolve({ ok: !err, out: String(stdout || "").trim(), err: err ? String(err.message).trim() : null })));

async function connectClaude(forced) {
  const q = `"${MCPB}"`;
  if (process.platform === "win32") {
    if (forced !== "explorer") {
      const assoc = await run("cmd /c assoc .mcpb");
      if (assoc.ok && /\.mcpb=/i.test(assoc.out)) {
        const r = await run(`cmd /c start "" ${q}`);
        if (r.ok) return { ok: true, method: "assoc", detail: assoc.out };
      }
      const alias = await run("where claude-desktop.exe");
      if (alias.ok && alias.out) {
        const exe = alias.out.split(/\r?\n/)[0].trim();
        try {
          const { spawn } = await import("node:child_process");
          const child = spawn(exe, [MCPB], { detached: true, stdio: "ignore", windowsHide: false });
          child.on("error", (e) => record("connect_alias_error", { error: String(e.message) }));
          child.unref();
          return { ok: true, method: "alias", detail: exe };
        } catch (e) { record("connect_alias_error", { error: String(e.message) }); }
      }
    }
    // Plan B: arrastrar al chat lo adjunta a la conversación (comprobado el 13/10/2026), así que la vía
    // es Ajustes > Extensiones > Configuración avanzada > Instalar extensión…, con la ruta ya copiada.
    const psPath = MCPB.replace(/'/g, "''");
    const clip = await run(`powershell -NoProfile -Command "Set-Clipboard -Value '${psPath}'"`);
    const r = await run(`explorer.exe /select,${q}`); // explorer devuelve código 1 aunque funcione
    return { ok: true, method: "explorer", copied: clip.ok, detail: r.err || "" };
  }
  if (process.platform === "darwin") {
    if (forced !== "explorer") {
      const r = await run(`open -a Claude ${q}`);
      if (r.ok) return { ok: true, method: "open-a-claude" };
    }
    const clip = await run(`printf %s ${q} | pbcopy`);
    await run(`open -R ${q}`);
    return { ok: true, method: "explorer", copied: clip.ok };
  }
  await run(`xdg-open ${q}`);
  return { ok: true, method: "xdg-open" };
}

// ---------- WebSocket ----------
const wssBridge = new WebSocketServer({ noServer: true });
const wssUi = new WebSocketServer({ noServer: true });
const uiClients = new Set();
function broadcast(msg) { const s = JSON.stringify(msg); for (const c of uiClients) if (c.readyState === 1) c.send(s); }

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/bridge") {
    if (req.headers["x-fourhands-token"] !== TOKEN) {
      record("bridge_rejected", { reason: "bad token" });
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); return socket.destroy();
    }
    return wssBridge.handleUpgrade(req, socket, head, (ws) => onBridge(ws));
  }
  if (url.pathname === "/ui" && sameOrigin(req)) return wssUi.handleUpgrade(req, socket, head, (ws) => onUi(ws));
  socket.destroy();
});

function onBridge(ws) {
  ws.on("message", (data) => {
    let msg; try { msg = JSON.parse(String(data)); } catch { return; }
    if (msg.type === "hello") {
      state.bridge = { client: msg.client, bridge: msg.bridge, node: msg.node, platform: msg.platform, since: new Date().toISOString() };
      record("bridge_connected", state.bridge);
      broadcast({ type: "bridge", bridge: state.bridge });
    } else if (msg.type === "call") {
      const t0 = Date.now();
      const r = handle(msg.tool, msg.args);
      ws.send(JSON.stringify({ type: "result", id: msg.id, ...r }));
      record("tool_call", { tool: msg.tool, args: msg.args, ok: r.ok, error: r.ok ? undefined : r.error, ms: Date.now() - t0, transitMs: msg.at ? t0 - msg.at : undefined, chars: r.text ? r.text.length : 0 });
    }
  });
  ws.on("close", () => { state.bridge = null; record("bridge_disconnected"); broadcast({ type: "bridge", bridge: null }); });
}

function onUi(ws) {
  uiClients.add(ws);
  ws.send(JSON.stringify({ type: "init", song: SONG, state, events: events.slice(-200) }));
  ws.on("close", () => uiClients.delete(ws));
}

// ---------- Arranque ----------
function writeConfig(port) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ port, token: TOKEN, pid: process.pid, app: "Four Hands Studio (prueba)" }, null, 2), { mode: 0o600 });
}
function removeConfig() {
  try { const c = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); if (c.token === TOKEN) fs.unlinkSync(CONFIG_FILE); } catch {}
}

function listen(port) {
  server.once("error", (e) => {
    if (e.code === "EADDRINUSE" && port !== 0) { console.log(`El puerto ${port} está ocupado; uso otro.`); listen(0); }
    else { console.error(e); process.exit(1); }
  });
  server.listen(port, "127.0.0.1", () => {
    const p = server.address().port;
    writeConfig(p);
    const url = `http://127.0.0.1:${p}/`;
    record("app_started", { port: p, config: CONFIG_FILE, platform: process.platform, node: process.version });
    console.log(`\nFour Hands Studio · app de prueba abierta en ${url}`);
    console.log(`Configuración para el puente: ${CONFIG_FILE}`);
    console.log(`Registro de la prueba: ${LOG_FILE}`);
    console.log(`\nDeja esta ventana abierta mientras pruebas. Para cerrar la app: Ctrl+C.\n`);
    if (!process.env.FH_NO_BROWSER) {
      const open = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
      exec(open, () => {});
    }
  });
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  try { process.on(sig, () => { record("app_closed", { signal: sig }); removeConfig(); process.exit(0); }); } catch {}
}
process.on("exit", removeConfig);

listen(PREFERRED_PORT);
