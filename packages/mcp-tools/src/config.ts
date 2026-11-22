/**
 * Where the app leaves its port and token for the bridges (bridge.json), so that both read the
 * same place (docs/mcp.md, 2). Not the app's own data folder: the bridge runs
 * inside Claude Desktop and only knows this fixed path.
 */
import path from "node:path";

export const BRIDGE_CONFIG_FILE = "bridge.json";

export function bridgeConfigDir(platform: string, env: Record<string, string | undefined>, home: string): string {
  if (platform === "win32") return path.join(env.APPDATA ?? path.join(home, "AppData", "Roaming"), "FourHandsStudio");
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "FourHandsStudio");
  return path.join(env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "FourHandsStudio");
}

/** What the app writes in bridge.json. */
export interface BridgeConfig {
  port: number;
  token: string;
  pid: number;
  app: string;
  toolsVersion: number;
}

/** Messages between a bridge and the app over the local WebSocket. */
export type BridgeMessage =
  | { type: "hello"; bridge: string; toolsVersion: number; client: { name?: string; version?: string; title?: string } | null; node?: string; platform?: string }
  | { type: "call"; id: number; tool: string; args: unknown; at?: number };

export type AppMessage = { type: "result"; id: number; ok: boolean; text?: string; error?: string };
