/**
 * Four Hands bridge: stdio MCP server <-> local WebSocket to the open app.
 *
 * Claude Desktop (or any MCP client) starts this process; it forwards every tool
 * call to the Four Hands app running on the same computer and returns the answer.
 * It keeps no musical state (docs/mcp.md, 2; docs/architecture.md, 6).
 *
 * Proven in the installation test of 13/10/2026.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import WebSocket from "ws";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BRIDGE_CONFIG_FILE, PROMPTS, SERVER_INSTRUCTIONS, TOOLS, TOOLS_VERSION, bridgeConfigDir } from "@fourhands/mcp-tools";

declare const __BRIDGE_VERSION__: string;
const BRIDGE_VERSION = typeof __BRIDGE_VERSION__ === "string" ? __BRIDGE_VERSION__ : "dev";

// stderr goes to Claude Desktop's MCP log; stdout is reserved for the protocol.
const log = (...a: unknown[]) => console.error("[fourhands-bridge]", ...a);

const CONFIG_FILE = path.join(bridgeConfigDir(process.platform, process.env, os.homedir()), BRIDGE_CONFIG_FILE);

const APP_CLOSED =
  "Four Hands no está abierto. Ábrelo y vuelve a intentarlo. (Four Hands is not open. Ask the user to open it and try again.)";

interface AppResult {
  ok: boolean;
  text?: string;
  error?: string;
}

// ---------- Connection with the app ----------
let ws: WebSocket | null = null;
let connecting: Promise<WebSocket> | null = null;
let seq = 0;
const pending = new Map<number, (r: AppResult) => void>();

function readConfig(): { port: number; token: string } | null {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    return c && c.port && c.token ? c : null;
  } catch {
    return null;
  }
}

function connect(): Promise<WebSocket> {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws);
  if (connecting) return connecting;
  // Re-read every time: the app writes a new port and token on each start.
  const cfg = readConfig();
  if (!cfg) return Promise.reject(new Error("no-config"));
  connecting = new Promise<WebSocket>((resolve, reject) => {
    const sock = new WebSocket(`ws://127.0.0.1:${cfg.port}/bridge`, { headers: { "x-fourhands-token": cfg.token } });
    const timer = setTimeout(() => sock.terminate(), 1500);
    sock.on("open", () => {
      clearTimeout(timer);
      ws = sock;
      connecting = null;
      sock.send(
        JSON.stringify({
          type: "hello",
          bridge: BRIDGE_VERSION,
          toolsVersion: TOOLS_VERSION,
          client: clientInfo(),
          node: process.version,
          platform: process.platform,
        }),
      );
      resolve(sock);
    });
    sock.on("message", (data) => {
      let msg: { type?: string; id?: number } & AppResult;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.type === "result" && typeof msg.id === "number") {
        pending.get(msg.id)?.(msg);
        pending.delete(msg.id);
      }
    });
    const fail = (e?: Error) => {
      clearTimeout(timer);
      if (ws === sock) ws = null;
      connecting = null;
      for (const [id, done] of pending) {
        done({ ok: false, error: APP_CLOSED });
        pending.delete(id);
      }
      reject(e ?? new Error("closed"));
    };
    sock.on("error", (e) => {
      log("ws error", e.message);
      fail(e);
    });
    sock.on("close", () => fail());
  });
  return connecting;
}

async function callApp(tool: string, args: unknown): Promise<AppResult> {
  let sock: WebSocket;
  try {
    sock = await connect();
  } catch {
    return { ok: false, error: APP_CLOSED };
  }
  const id = ++seq;
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: "Four Hands no responde. (The app did not answer in time.)" });
    }, 5000);
    pending.set(id, (m) => {
      clearTimeout(t);
      resolve(m);
    });
    sock.send(JSON.stringify({ type: "call", id, tool, args, at: Date.now() }));
  });
}

// Only the compact text goes back: no structuredContent (docs/architecture.md, 6.2).
function toResult(m: AppResult) {
  if (!m.ok) return { content: [{ type: "text" as const, text: m.error ?? "Error" }], isError: true };
  return { content: [{ type: "text" as const, text: m.text ?? "" }] };
}

// ---------- MCP server ----------
const server = new McpServer(
  { name: "fourhands-mcp", title: "Four Hands Studio", version: BRIDGE_VERSION },
  { instructions: SERVER_INSTRUCTIONS },
);

function clientInfo() {
  try {
    return server.server.getClientVersion() ?? null;
  } catch {
    return null;
  }
}

for (const tool of TOOLS) {
  server.registerTool(
    tool.name,
    { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
    async (args: unknown) => toResult(await callApp(tool.name, args ?? {})),
  );
}

for (const prompt of PROMPTS) {
  server.registerPrompt(
    prompt.name,
    { title: prompt.title, description: prompt.description, argsSchema: prompt.argsSchema },
    (args: Record<string, unknown>) => ({
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text: prompt.render(Object.fromEntries(Object.entries(args).map(([k, v]) => [k, String(v ?? "")]))) },
        },
      ],
    }),
  );
}

server.server.oninitialized = () => {
  log("client:", JSON.stringify(clientInfo()));
  connect().catch(() => log("app not open yet"));
};

// Gentle retry every 3 s so the app notices the connection even if it opens later.
setInterval(() => {
  if (!ws && !connecting && server.server.getClientVersion()) connect().catch(() => {});
}, 3000).unref();

await server.connect(new StdioServerTransport());
log(`started v${BRIDGE_VERSION} (tools v${TOOLS_VERSION}) node ${process.version} config ${CONFIG_FILE}`);
