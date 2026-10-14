import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { SongSession } from "../session.js";
import { AiDesk } from "./desk.js";
import { AiServer, OUTDATED } from "./server.js";

let root: string;
let session: SongSession;
let desk: AiDesk;
let server: AiServer;
let configFile: string;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fh-server-"));
  session = await SongSession.createNew({ songsDir: root, backupsDir: root, untitledName: "Sin título", autosaveDelayMs: 5 });
  desk = new AiDesk({ session: () => session });
  configFile = path.join(root, "config", "bridge.json");
  server = new AiServer({ desk, configFile, toolsVersion: 3, port: 0 });
  await server.start();
});

afterEach(async () => {
  await server.stop();
  desk.dispose();
  await session.flush();
  session.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

function open(token: string): Promise<WebSocket> {
  const { port } = JSON.parse(fs.readFileSync(configFile, "utf8"));
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge`, { headers: { "x-fourhands-token": token } });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function call(ws: WebSocket, id: number, tool: string, args: unknown = {}): Promise<{ ok: boolean; text?: string; error?: string }> {
  return new Promise((resolve) => {
    const onMessage = (data: WebSocket.RawData) => {
      const m = JSON.parse(String(data));
      if (m.id === id) {
        ws.off("message", onMessage);
        resolve(m);
      }
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify({ type: "call", id, tool, args, at: Date.now() }));
  });
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
};

describe("the bridges' door", () => {
  it("writes bridge.json with a port and a token only for this run, and removes it on close", async () => {
    const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
    expect(config).toMatchObject({ port: server.port, app: "Four Hands Studio", toolsVersion: 3 });
    expect(config.token).toMatch(/^[0-9a-f]{48}$/);
    await server.stop();
    expect(fs.existsSync(configFile)).toBe(false);
  });

  it("refuses a connection without the token", async () => {
    await expect(open("wrong")).rejects.toThrow(/401/);
  });

  it("serves several bridges at once, each signing as its client", async () => {
    const { token } = JSON.parse(fs.readFileSync(configFile, "utf8"));
    const a = await open(token);
    const b = await open(token);
    a.send(JSON.stringify({ type: "hello", bridge: "0.3.0", toolsVersion: 3, client: { name: "claude-ai", version: "1" } }));
    b.send(JSON.stringify({ type: "hello", bridge: "0.3.0", toolsVersion: 3, client: { name: "local-agent-mode-Four Hands Studio" } }));
    await until(() => desk.state().clients.length === 2);
    expect(desk.state().clients.map((c) => c.name)).toEqual(["Claude", "Claude"]);
    const overview = await call(a, 1, "get_song_overview");
    expect(overview.ok).toBe(true);
    expect(overview.text).toMatch(/^Four Hands · r\d+ · "Sin título"/);
    const begin = await call(b, 2, "begin_intervention", { description: "Melodía", base_revision: `r${session.song.revision}` });
    expect(begin.text).toMatch(/Intervention i\d+ open/);
    a.close();
    await until(() => desk.state().clients.length === 1);
    b.close();
  });

  it("answers a bridge of another version: update the connection", async () => {
    const { token } = JSON.parse(fs.readFileSync(configFile, "utf8"));
    const ws = await open(token);
    ws.send(JSON.stringify({ type: "hello", bridge: "0.2.0", toolsVersion: 2, client: { name: "claude-ai" } }));
    const r = await call(ws, 1, "get_song_overview");
    expect(r).toMatchObject({ ok: false, error: OUTDATED });
    ws.close();
  });
});
