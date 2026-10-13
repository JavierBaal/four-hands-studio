/**
 * MCP tool definitions shared by the bridge and the app (ARQUITECTURA.md, 6.2).
 *
 * One description per tool, with the mandatory rules inside it (ESQUEMA_MCP.md, 9).
 * Tool names, descriptions and server instructions are in English on purpose;
 * the AI talks to the user in the user's language.
 *
 * For now this holds the tools of the installation test (PRUEBA_MCPB.md) and of the
 * permissions test S1 (PRUEBA_S1.md): a representative slice of ESQUEMA_MCP.md with
 * read-only, pointing, writing and destructive tools. The full schema is added in milestone H3.
 */
import { z } from "zod";

/** Bumped whenever a tool, its parameters or its meaning changes. The app refuses older bridges. */
export const TOOLS_VERSION = 2;

export const SERVER_INSTRUCTIONS = `You are composing together with the user inside Four Hands Studio, a shared MIDI score.
The user sees every change you make, live.
Start by calling get_song_overview and get_user_context: "this" and "here" mean the user's selection, loop or cursor.
To change the song: begin_intervention with a short description in the user's language, make your edits,
then end_intervention. One intervention = one proposal = one undo step.
Never assume you can move the user's view, selection or playback. To show something, use point_to.
Talk to the user in their language.`;

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
const write: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const destructive: ToolAnnotations = { ...write, destructiveHint: true };

const RANGE_HELP = "Bars like '17-24' or '17.3-18.2', or 'selection', 'loop', 'section:Coro', 'all'.";
const NOTE_FORMAT =
  "One note per line: pitch position duration [velocity] [deviation]. " +
  "Pitch in scientific notation, middle C = C4 (C4, Eb5, F#3). Position bar.beat, plus a fraction of a beat if needed (17.1, 17.3+1/2). " +
  "Duration as a fraction of a whole note; '.' dotted, 't' triplet, '+' tie (1/4, 1/8., 1/8t, 1/2+1/8). Velocity v1-v127. " +
  "Deviation from the grid only if wanted: ~s for the start, ~d for the duration, in beats (~s+0.03). " +
  "Example: 'E5 17.1 1/4 v72'. If any line is wrong the whole call is rejected and nothing is written.";

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
  {
    name: "get_user_context",
    title: "User context",
    description:
      "Read what the user is looking at and how they work: selection, loop, cursor, active track, visible bars, " +
      "view preferences (note names Do Re Mi or C D E, octave of middle C, scale degrees), active theory aids, " +
      "and whether they review proposals or apply them directly. This is what 'this' and 'here' mean. Read-only.",
    inputSchema: {},
    annotations: readOnly,
  },
  {
    name: "read_notes",
    title: "Read notes",
    description:
      "Read the notes of a range and some tracks, one compact line per note grouped by track and bar, with the chord of each bar: " +
      "id pitch position duration velocity author [deviation], e.g. 'n482 E5 17.1 1/4 v72 @u ~s+0.03'. " +
      "@u = the user, @ai = an AI. Deviation (~s start, ~d duration, in beats) appears only off the grid: respect it, it is how the user played. " +
      `Up to about 800 notes per call; the answer says how to ask for the next page. range: ${RANGE_HELP} Read-only.`,
    inputSchema: {
      range: z.string().describe(RANGE_HELP),
      tracks: z.array(z.string()).optional().describe("Optional track ids or names; all tracks if omitted"),
      page: z.number().int().min(1).optional().describe("Page number, from 1"),
    },
    annotations: readOnly,
  },
  {
    name: "begin_intervention",
    title: "Begin an intervention",
    description:
      "Start a change to the song. Every write tool needs the intervention_id this returns. " +
      "description: what you are about to do, short and in the user's language; the user sees it in the history and on the proposal bar " +
      "('Reharmonizo el coro, c. 17-20'). base_revision: the revision you read (e.g. 'r1532'); notes the user changed after it are protected. " +
      "The answer says whether the user reviews proposals or applies changes directly. " +
      "Close it with end_intervention. An intervention with no calls for 5 minutes closes by itself.",
    inputSchema: {
      description: z.string().describe("Short description in the user's language"),
      base_revision: z.string().describe("Revision you read, e.g. 'r1532'"),
    },
    annotations: write,
  },
  {
    name: "add_notes",
    title: "Add notes",
    description:
      `Add notes to one track inside an open intervention. The user sees them appear live. Returns their ids. ${NOTE_FORMAT}`,
    inputSchema: {
      intervention_id: z.string().describe("From begin_intervention, e.g. 'i12'"),
      track: z.string().describe("Track id or name, e.g. 't3' or 'Violines'"),
      notes: z.string().describe("Notes, one per line"),
    },
    annotations: write,
  },
  {
    name: "delete_notes",
    title: "Delete notes",
    description:
      "Delete notes by id inside an open intervention. Notes the user changed after the intervention's base revision are refused, " +
      "and the answer says what changed.",
    inputSchema: {
      intervention_id: z.string().describe("From begin_intervention, e.g. 'i12'"),
      note_ids: z.array(z.string()).min(1).describe("Note ids, e.g. ['n482', 'n483']"),
    },
    annotations: destructive,
  },
  {
    name: "end_intervention",
    title: "End the intervention",
    description:
      "Close an intervention. If the user reviews proposals it becomes a proposal they accept or discard in the app; " +
      "if they apply directly, the changes enter the song. Either way it is a single undo step.",
    inputSchema: {
      intervention_id: z.string().describe("From begin_intervention, e.g. 'i12'"),
    },
    annotations: write,
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
