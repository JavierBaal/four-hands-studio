/**
 * MCP tool definitions shared by the bridge and the app (ARQUITECTURA.md, 6.2).
 *
 * One description per tool, with the mandatory rules inside it (ESQUEMA_MCP.md, 9).
 * Tool names, descriptions and server instructions are in English on purpose;
 * the AI talks to the user in the user's language.
 *
 * For now this holds the two tools of the installation test (PRUEBA_MCPB.md).
 * The full schema of ESQUEMA_MCP.md is added in milestone H3.
 */
import { z } from "zod";

/** Bumped whenever a tool, its parameters or its meaning changes. The app refuses older bridges. */
export const TOOLS_VERSION = 1;

export const SERVER_INSTRUCTIONS = `You are composing together with the user inside Four Hands Studio, a shared MIDI score.
The user sees every change you make, live.
Start by calling get_song_overview. Never assume you can move the user's view, selection or playback.
To show something, use point_to. Talk to the user in their language.`;

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  /** Zod raw shape, as the MCP TypeScript SDK expects it. */
  inputSchema: z.ZodRawShape;
  annotations: ToolAnnotations;
}

const readOnly: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: "get_song_overview",
    title: "Song overview",
    description:
      "Read the overview of the song open in Four Hands Studio: title, tempo, meter, key, form (sections with bars), " +
      "tracks (instrument, range, note count, share by author), harmony per bar, annotations, current revision and pending proposals. " +
      "Small on purpose: call it first. Read-only.",
    inputSchema: {},
    annotations: readOnly,
  },
  {
    name: "point_to",
    title: "Point to a place",
    description:
      "Point the user to a place in the score with a short reason. A mark appears on their screen; if they click it, the app takes them there. " +
      "It does NOT change the song and does NOT move the user's view, selection or playback. " +
      "range: bars like '17-24', '17.3-18.2', or 'section:Coro'. tracks: optional track ids or names (e.g. 't3', 'Violines').",
    inputSchema: {
      range: z.string().describe("Bars, e.g. '17-24', '17.3-18.2', 'section:Coro'"),
      tracks: z.array(z.string()).optional().describe("Optional track ids or names"),
      reason: z.string().describe("Short reason, in the user's language"),
    },
    annotations: { ...readOnly, idempotentHint: false },
  },
];

export interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  argsSchema: z.ZodRawShape;
  render: (args: Record<string, string>) => string;
}

export const PROMPTS: readonly PromptDefinition[] = [
  {
    name: "compose_from_feelings",
    title: "Compose from feelings",
    description: "Describe what you want to convey and the AI proposes it in notes, explaining its choices.",
    argsSchema: { feeling: z.string().describe("What you want the music to convey") },
    render: ({ feeling }) =>
      `In Four Hands Studio, read the song first (get_song_overview). I want this to convey: ${feeling ?? ""}. ` +
      `Tell me what you would write and where, and point to the place with point_to.`,
  },
];
