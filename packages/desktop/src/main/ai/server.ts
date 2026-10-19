/**
 * The door for the bridges (ARQUITECTURA.md, 6): a WebSocket on 127.0.0.1 with a token.
 *
 * - The app writes its port and a fresh token in bridge.json (ESQUEMA_MCP.md, 2) at every start
 *   and removes it when it closes. Only a program that can read that file can write in the song.
 * - Any number of bridges at once (Claude Desktop and a linked claude.ai session start one each).
 * - A bridge of another tools version gets a clear answer on every call: update the connection.
 * - The window does not use this door: it talks to the main process over IPC (ARQUITECTURA.md, 6.2).
 *
 * It only carries messages: what each tool does is in desk.ts.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AppMessage, BridgeConfig, BridgeMessage } from "@fourhands/mcp-tools";
import { WebSocketServer, type WebSocket } from "ws";
import type { AiDesk } from "./desk.js";

export interface AiServerOptions {
  desk: AiDesk;
  /** Full path of bridge.json. */
  configFile: string;
  toolsVersion: number;
  /** 47474, as in the installation test; another free one if it is taken. */
  port?: number;
  log?: (entry: Record<string, unknown>) => void;
}

export const OUTDATED =
  "La conexión de Four Hands con Claude está desactualizada. Pide al usuario que la actualice desde Four Hands (Ayuda > Conectar con Claude). " +
  "(The Four Hands connection is outdated: ask the user to update it from Four Hands, Help > Connect with Claude.)";

export class AiServer {
  private server: http.Server | null = null;
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly token = crypto.randomBytes(24).toString("hex");
  private seq = 0;
  private sockets = new Set<WebSocket>();
  port = 0;

  constructor(private readonly options: AiServerOptions) {}

  async start(): Promise<number> {
    const server = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      // A web page can open a WebSocket to localhost but cannot send this header: browsers are kept out.
      if (url.pathname !== "/bridge" || req.headers["x-fourhands-token"] !== this.token) {
        this.options.log?.({ type: "bridge_rejected", reason: url.pathname !== "/bridge" ? "path" : "token" });
        // end(), not destroy(): on Windows destroy() resets the connection before the client reads
        // the 401, and the bridge would see "ECONNRESET" instead of a clear refusal (19/10/2026).
        socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onBridge(ws));
    });
    this.server = server;
    this.port = await new Promise<number>((resolve, reject) => {
      const listen = (port: number) => {
        server.once("error", (e: NodeJS.ErrnoException) => {
          if (e.code === "EADDRINUSE" && port !== 0) listen(0);
          else reject(e);
        });
        server.listen(port, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
      };
      listen(this.options.port ?? 47474);
    });
    this.writeConfig();
    this.options.log?.({ type: "ai_server_started", port: this.port, config: this.options.configFile });
    return this.port;
  }

  private writeConfig(): void {
    const config: BridgeConfig = { port: this.port, token: this.token, pid: process.pid, app: "Four Hands Studio", toolsVersion: this.options.toolsVersion };
    fs.mkdirSync(path.dirname(this.options.configFile), { recursive: true });
    const tmp = `${this.options.configFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.options.configFile);
  }

  private onBridge(ws: WebSocket): void {
    const id = `c${++this.seq}`;
    let outdated = false;
    let hello = false;
    this.sockets.add(ws);
    ws.on("message", (data) => {
      let msg: BridgeMessage;
      try {
        msg = JSON.parse(String(data)) as BridgeMessage;
      } catch {
        return;
      }
      if (msg.type === "hello") {
        hello = true;
        outdated = msg.toolsVersion !== this.options.toolsVersion;
        const client = msg.client?.name ?? "unknown";
        this.options.log?.({ type: "bridge_connected", connection: id, client, clientVersion: msg.client?.version, bridge: msg.bridge, toolsVersion: msg.toolsVersion, outdated, node: msg.node, platform: msg.platform });
        this.options.desk.connect(id, client, msg.client?.title);
        return;
      }
      if (msg.type === "call") {
        const transit = typeof msg.at === "number" ? Date.now() - msg.at : undefined;
        const reply = !hello || outdated ? { ok: false as const, error: OUTDATED } : this.options.desk.call(id, msg.tool, msg.args);
        const out: AppMessage = reply.ok ? { type: "result", id: msg.id, ok: true, text: reply.text } : { type: "result", id: msg.id, ok: false, error: reply.error };
        ws.send(JSON.stringify(out));
        if (transit !== undefined && transit > 200) this.options.log?.({ type: "bridge_slow", tool: msg.tool, transitMs: transit });
      }
    });
    ws.on("close", () => {
      this.sockets.delete(ws);
      if (hello) this.options.desk.disconnect(id);
    });
    ws.on("error", () => ws.terminate());
  }

  /** Closes every bridge and removes bridge.json (if it is still ours). */
  async stop(): Promise<void> {
    try {
      const c = JSON.parse(fs.readFileSync(this.options.configFile, "utf8")) as Partial<BridgeConfig>;
      if (c.token === this.token) fs.unlinkSync(this.options.configFile);
    } catch {
      /* already gone */
    }
    for (const ws of this.sockets) ws.terminate();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = null;
  }
}
