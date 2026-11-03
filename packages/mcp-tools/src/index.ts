/**
 * MCP tool definitions shared by the bridge and the app (ARQUITECTURA.md, 6.2).
 *
 * One description per tool, with the mandatory rules inside it (ESQUEMA_MCP.md, 9).
 * Tool names, descriptions and server instructions are in English on purpose;
 * the AI talks to the user in the user's language.
 *
 * Milestone H3 (the AI's hand): reading, interventions, every write tool of ESQUEMA_MCP.md, 6, and
 * point_to. H3.1 (15/10/2026): the mix (set_mix, mute), remove_track and move_track. H3.2: track colours (color in
 * add_track and update_track). 19/10/2026: analyze (ESTUDIO_SKILLS_COMPOSICION.md, 5). 20/10/2026: list_skills and load_skill (ESTUDIO_SKILLS.md, 3).
 * Still to come in H4: summarize, get_changes_since, get_history, get_proposals and withdraw_proposal.
 *
 * No tool composes (ESQUEMA_MCP.md, 8): they read, write, and transform mechanically.
 */
import { z } from "zod";

/** Bumped whenever a tool, its parameters or its meaning changes. The app refuses other bridges. */
export const TOOLS_VERSION = 18;

/**
 * Track colours by name (H3.2). The app's palette (desktop/src/shared/track-colors.ts) has the same
 * names in the same order; a test keeps them equal. Spanish names are accepted too.
 */
export const TRACK_COLOR_NAMES = ["lavender", "sand", "sage", "clay", "slate", "stone", "plum", "moss", "water", "heather"] as const;
const COLOR_HELP = `Track colour, one of: ${TRACK_COLOR_NAMES.join(", ")}. Muted tones; amber and blue are kept for who wrote each note`;

export const SERVER_INSTRUCTIONS = `You are composing together with the user inside Four Hands Studio, a shared MIDI score.
The user sees every change you make, live.

Start of each turn: call get_user_context (and get_song_overview the first time). When it says the song
changed since your last call, call get_changes_since before writing: the user may have moved, replaced or
deleted your notes, and their changes win. "This", "here" and "these bars" refer to the user's selection,
loop or cursor. For a long song, summarize gives the big picture; read in detail only what you will touch.

Four Hands serves skills: craft written down for composing here. At the start of every conversation, before
you write anything, call load_skill("four-hands-basics"). Then call list_skills and load the ones whose
description fits what the user asks (a style, a feeling, an arrangement, a review). They are short; load them.

To change the song: begin_intervention with a short description in the user's language, make your edits,
then end_intervention. One intervention = one undo step for the user.

Respect what the user played: notes may carry a timing deviation (~s, ~d). Moving, repitching and copying
keep each note's deviation. Quantize only when the user asks or clearly wants it.
To change only the pitches of a rhythm the user drew or played, use repitch_notes.

Never assume you can move the user's view, selection or playback. To show something, use point_to.

You cannot hear. After writing anything substantial, run analyze on what you touched and fix what is
clearly unintended before handing the turn back; then tell the user what only their ears can judge.

Talk to the user with the note names and octave convention from get_user_context
(e.g. Do Re Mi, middle C = Do4), even though the tools always use scientific pitch (C4 = middle C).

The app does not compose: you decide every note.

Honest opinions. The user wants the music to come out well, not to be flattered.
- Every judgement points to the score: bars, notes, what analyze reports. No adjectives on their own.
- Say what works only when it is true, as concretely as what fails.
- Taste is the user's call; craft is not. If something is badly written (a muddy low end, parallel fifths,
  a mechanical ramp, one part masking another), say so plainly even if they like it: what it does, what it
  costs, the fix.
- Don't change your opinion because the user insists; change it for a new reason or something new in the score.
- You cannot hear, so never praise your own work ("queda precioso"). Say what you wrote, what analyze
  flagged and what you left unresolved.
- Judge the user's music as if a stranger wrote it.
get_user_context says how the user wants opinions delivered (direct or with tact): only the delivery
changes, never what you say is wrong.`;

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolDefinition {
  name: string;
  /** What the user sees in Claude's settings (PRUEBA_S1.md, 5): short and clear. */
  title: string;
  description: string;
  /** Zod raw shape, as the MCP TypeScript SDK expects it. */
  inputSchema: z.ZodRawShape;
  annotations: ToolAnnotations;
}

const readOnly: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const write: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const destructive: ToolAnnotations = { ...write, destructiveHint: true };

const RANGE_HELP = "Bars like '17-24', '17', '17.3-18.2', or 'selection', 'loop', 'section:Coro', 'all'.";
const PITCH_HELP = "Pitch in scientific notation, middle C = C4 (C4, Eb5, F#3).";
const POSITION_HELP = "Position bar.beat, plus a fraction of a beat if needed (17.1, 17.3+1/2, 17.2+1/3 for a triplet).";
const DURATION_HELP = "Duration as a fraction of a whole note; '.' dotted, 't' triplet, '+' tie (1/4, 1/8., 1/8t, 1/2+1/8).";
const NOTE_FORMAT =
  "One note per line: pitch position duration [velocity] [deviation]. " +
  `${PITCH_HELP} ${POSITION_HELP} ${DURATION_HELP} Velocity v1-v127 (default v80). ` +
  "Deviation from the grid only if you want a played feel: ~s for the start, ~d for the duration, in beats (~s+0.03). " +
  "Example: 'E5 17.1 1/4 v72'. If any line is wrong the whole call is rejected and nothing is written.";
const INTERVENTION = z.string().describe("From begin_intervention, e.g. 'i12'");
const TRACKS = z.array(z.string()).optional().describe("Track ids or names, e.g. ['t3'] or ['Violines']; all tracks if omitted");
const NOTE_IDS = z.array(z.string()).optional().describe("Note ids, e.g. ['n482', 'n483']");
const RANGE = z.string().optional().describe(`Instead of note_ids: ${RANGE_HELP}`);
const BASE = z
  .string()
  .optional()
  .describe("The revision you last read (e.g. 'r1540'), if newer than the intervention's base. Notes the user changed after it are protected.");
const TARGET_HELP = "Choose the notes with note_ids, or with range plus optional tracks.";
const PROTECTED =
  "Notes the user changed after the revision you read are refused, and the answer says what changed: read them again first.";

export const TOOLS: readonly ToolDefinition[] = [
  // -------------------------------------------------------------------------
  // Reading (ESQUEMA_MCP.md, 4)
  {
    name: "get_song_overview",
    title: "Song overview",
    description:
      "Read the overview of the song open in Four Hands Studio: title, tempo, meter, key, length, form (sections with bars), " +
      "tracks (id, instrument, sound, mix: volume, pan, reverb and mute; range, note count, average velocity, share by author), " +
      "harmony per bar, annotations and current revision. " +
      "Small on purpose: call it first. Read-only.",
    inputSchema: {},
    annotations: readOnly,
  },
  {
    name: "get_user_context",
    title: "User context",
    description:
      "Read what the user is looking at and how they work: selection, loop, cursor, active track, visible bars, " +
      "note names they read (Do Re Mi or C D E) and the octave of middle C, whether the AI's notes are shown in colour, " +
      "and how your changes reach the song. This is what 'this' and 'here' mean. Read-only.",
    inputSchema: {},
    annotations: readOnly,
  },
  {
    name: "read_notes",
    title: "Read notes",
    description:
      "Read the notes of a range and some tracks, one compact line per note grouped by track and bar, with the chord of each bar: " +
      "id pitch position duration velocity author [deviation], e.g. 'n482 E5 17.1 1/4 v72 @u ~s+0.03'. " +
      "@u = the user, @ai = an AI. Position and duration are the nearest sixteenth or eighth-note triplet; " +
      "deviation (~s start, ~d duration, in beats) appears only off that grid: it is how the user played, respect it. " +
      `Up to 800 notes per call; the answer says how to ask for the next page. range: ${RANGE_HELP} Read-only.`,
    inputSchema: {
      range: z.string().describe(RANGE_HELP),
      tracks: TRACKS,
      page: z.number().int().min(1).optional().describe("Page number, from 1"),
    },
    annotations: readOnly,
  },
  {
    name: "list_instruments",
    title: "List instruments",
    description:
      "List the sounds you can give a track: the built-in palette with each instrument's real range and how each sound behaves " +
      "(fast or slow attack, whether it holds a long note or dies out, how long it rings after the note ends), and the sound banks the user installed. " +
      "Also the instrument plugins Four Hands hosts on this computer (Kontakt, Omnisphere…), with their vendor and category. " +
      "With bank, that bank's sounds with the same profile and the keys each has samples for (silent outside them). The profile comes from the sound's own data: " +
      "trust it over the name (a slow-attack choir cannot do short hits; an unlooped sample dies out on a long note). " +
      "Use it before add_track or update_track, and to keep each part inside its range. Read-only.",
    inputSchema: {
      bank: z.string().optional().describe("A bank's file name from the list, to see its sounds"),
    },
    annotations: readOnly,
  },
  {
    name: "get_levels",
    title: "Get levels",
    description:
      "The levels each track reached in the last playback, measured in the audio engine after its fader (F2.2): peak and average (RMS) in dBFS, " +
      "how many samples went over 0 dBFS (clipping), and the master's. Silent tracks are listed apart. " +
      "It is a meter, not hearing: it says how loud, not which frequencies, nor whether two parts mask each other. Say so when you use it. " +
      "Use it before changing volumes with set_mix, and after the user plays, to check what a change did. Read-only.",
    inputSchema: {},
    annotations: readOnly,
  },
  {
    name: "analyze",
    title: "Analyze (your ears)",
    description:
      "Your substitute for ears: you cannot hear what you write, so check it. First the shape (notes per bar, tracks and loudness, section by section, and the busiest bar), then mechanical findings, each with its bars, tracks and note ids: " +
      "chords, sections or annotations left after the last note and empty tracks (leftovers of earlier versions), " +
      "the song concept's limits (a duration or tempo written in it, against the music), close intervals too low (mud), too many notes below C3, four or more parts crowded in one octave, bars or blocks repeated identically three or more times, the same chord progression looped three or more times, " +
      "straight velocity ramps and long runs of one velocity, several tracks stopping at the same bar line or a sharp drop in loudness, " +
      "notes outside the instrument's usual range (or the keys a bank's sound has samples for), notes outside the key (the key in force there), long notes on the beat outside the written chord, " +
      "two tracks in the same register and the same place in the stereo (with their pan and volume: what to change to mix with judgement), a lower part crossing above the one usually above it, " +
      "and parallel fifths and octaves between two lines (a long run is reported once, as a doubling). " +
      "It describes, it does not judge: a finding can be exactly what the music wants. " +
      "Use it after writing anything substantial and before handing the turn back, and when the user asks for your opinion. " +
      `tracks: only those parts are reported, but every unmuted track counts as heard around them. range: ${RANGE_HELP} Default: all. Read-only.`,
    inputSchema: {
      range: z.string().optional().describe(`${RANGE_HELP} Default 'all'`),
      tracks: TRACKS,
    },
    annotations: readOnly,
  },
  {
    name: "get_changes_since",
    title: "What changed since",
    description:
      "What changed in the song since your last call (default) or since a revision ('r120'): the signed history in between (who did what: the user, you, another AI), " +
      "then the differences grouped by kind: notes per track (added, changed with what changed, removed; every note when they are few), harmony per bar, form, tempo, meter, key, concept, tracks and mix, annotations. " +
      "Call it when you come back to a conversation or when get_user_context says the song changed since your last call: the user may have moved, deleted or replaced your notes, and you must not undo their work by writing over it. Read-only.",
    inputSchema: {
      since: z.string().optional().describe("A revision, 'r120'. Default: the end of your last call"),
    },
    annotations: readOnly,
  },
  {
    name: "get_history",
    title: "Signed history",
    description:
      "The signed history of the song, newest first: revision, who (the user, you, another AI) and what, with undo and redo. " +
      "Shorter than get_changes_since; use it to see the order of decisions, what the user undid, or to find a revision to pass to get_changes_since. Read-only.",
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional().describe("Entries, newest first. Default 30"),
    },
    annotations: readOnly,
  },
  {
    name: "summarize",
    title: "Summarize the song",
    description:
      "The song by section (or blocks of 8 bars) and track, without reading every note: notes and notes per bar, range and where most notes sit, the usual figure and how much falls on the beat, " +
      "the contour of the top line (rising, falling, arch, valley, level), velocity, and who wrote it; plus the chords written in each section. " +
      "Use it to get the big picture of a long song, then read in detail only what you will touch. It describes, it does not judge. " +
      `range: ${RANGE_HELP} Default: all. Read-only.`,
    inputSchema: {
      range: z.string().optional().describe(`${RANGE_HELP} Default 'all'`),
      tracks: TRACKS,
    },
    annotations: readOnly,
  },
  {
    name: "list_skills",
    title: "List skills",
    description:
      "List the skills Four Hands serves: craft for composing here (how to work in the shared score, translating feelings, styles, orchestration, reviewing). " +
      "Each line gives the name, whether it is built in or the user's own, and when to use it. " +
      "Call it at the start of a conversation and load with load_skill every skill whose description fits the request. " +
      "The user's skills win over the built-in ones when they disagree. Read-only.",
    inputSchema: {},
    annotations: readOnly,
  },
  {
    name: "load_skill",
    title: "Load a skill",
    description:
      "Load a skill from list_skills and follow it. Without file, returns its instructions and the list of its reference files; " +
      "with file, returns that reference (load a reference when the instructions point to it, e.g. one style of the atlas). Read-only.",
    inputSchema: {
      name: z.string().describe("Skill name from list_skills, e.g. 'four-hands-basics'"),
      file: z.string().optional().describe("A reference file listed by the skill, e.g. 'references/dark-synth.md'"),
    },
    annotations: readOnly,
  },
  {
    name: "point_to",
    title: "Point to a place",
    description:
      "Point the user to a place in the score with a short reason. A mark appears on their screen; if they click it, the app takes them there. " +
      "It does NOT change the song and does NOT move the user's view, selection or playback. No intervention needed. " +
      `range: ${RANGE_HELP} tracks and note_ids are optional.`,
    inputSchema: {
      range: z.string().describe("Bars, e.g. '17-24', '17.3-18.2', 'section:Coro'"),
      tracks: TRACKS,
      note_ids: NOTE_IDS,
      reason: z.string().describe("Short reason, in the user's language"),
    },
    annotations: { ...readOnly, idempotentHint: false },
  },

  // -------------------------------------------------------------------------
  // Interventions (ESQUEMA_MCP.md, 5)
  {
    name: "begin_intervention",
    title: "Begin an intervention",
    description:
      "Start a change to the song. Every write tool needs the intervention_id this returns. " +
      "description: what you are about to do, short and in the user's language; the user sees it while you write and in the history " +
      "('Contramelodía de chelo, c. 17-20'). base_revision: the revision you read (e.g. 'r1532'); notes the user changed after it are protected. " +
      "The answer says how your changes reach the song. " +
      "Close it with end_intervention. An intervention with no calls for 5 minutes closes by itself, and the user can close it too.",
    inputSchema: {
      description: z.string().describe("Short description in the user's language"),
      base_revision: z.string().describe("Revision you read, e.g. 'r1532'"),
    },
    annotations: write,
  },
  {
    name: "end_intervention",
    title: "End the intervention",
    description:
      "Close an intervention. Everything you wrote in it becomes a single undo step for the user. " +
      "(When the user reviews proposals, it becomes a proposal they accept or discard in the app.)",
    inputSchema: {
      intervention_id: INTERVENTION,
    },
    annotations: write,
  },

  // -------------------------------------------------------------------------
  // Writing (ESQUEMA_MCP.md, 6). All need an open intervention.
  {
    name: "add_notes",
    title: "Add notes",
    description: `Add notes to one track inside an open intervention. The user sees them appear live. Returns their ids. ${NOTE_FORMAT}`,
    inputSchema: {
      intervention_id: INTERVENTION,
      track: z.string().describe("Track id or name, e.g. 't3' or 'Violines'"),
      notes: z.string().describe("Notes, one per line"),
    },
    annotations: write,
  },
  {
    name: "edit_notes",
    title: "Edit notes",
    description:
      "Change some fields of existing notes. One note per line: its id, then only what changes, in any order: " +
      `pitch, position, duration, velocity, deviation. E.g. 'n482 F5' (pitch only), 'n483 v40', 'n484 18.1 1/2'. ` +
      "Fields you leave out stay exactly as they are, including the played deviation. " +
      "A new position or duration is taken exactly as written (add ~s / ~d to keep a played feel). " +
      `To change only pitches, prefer repitch_notes; to shift notes, move_notes. ${PROTECTED}`,
    inputSchema: {
      intervention_id: INTERVENTION,
      changes: z.string().describe("One note per line: id and the fields that change"),
      base_revision: BASE,
    },
    annotations: write,
  },
  {
    name: "repitch_notes",
    title: "Change pitches only",
    description:
      "Change only the pitches of some notes and keep their rhythm, durations, velocities and played deviation untouched. " +
      "For 'my rhythm, your pitches': the user draws or plays a rhythm and you choose the notes. " +
      `One note per line: id and new pitch, e.g. 'n482 E5'. ${PITCH_HELP} ${PROTECTED}`,
    inputSchema: {
      intervention_id: INTERVENTION,
      pitches: z.string().describe("One note per line: id and new pitch"),
      base_revision: BASE,
    },
    annotations: write,
  },
  {
    name: "move_notes",
    title: "Move notes",
    description:
      "Shift notes in time and/or pitch. Each note keeps its own played deviation. " +
      "by_time: '+1 bar', '-2 beats', '+1/8', '+1 bar 2 beats'. by_semitones: chromatic transposition. " +
      "by_degrees: transposition inside the song's key (scale steps; notes outside the scale keep their alteration). " +
      `${TARGET_HELP} ${PROTECTED}`,
    inputSchema: {
      intervention_id: INTERVENTION,
      note_ids: NOTE_IDS,
      range: RANGE,
      tracks: TRACKS,
      by_time: z.string().optional().describe("E.g. '+1 bar', '-2 beats', '+1/8'"),
      by_semitones: z.number().int().optional().describe("E.g. 12 for an octave up"),
      by_degrees: z.number().int().optional().describe("Scale steps in the song's key, e.g. 2 for a third up"),
      base_revision: BASE,
    },
    annotations: write,
  },
  {
    name: "copy_notes",
    title: "Copy notes",
    description:
      "Copy notes, as they are (pitches, rhythm, velocities and played deviation), to another place and/or track. " +
      "to: where the copy starts, bar.beat (e.g. '25.1'): a range starts there; with note_ids, the first note lands there. " +
      `to_track: optional, defaults to each note's own track. ${TARGET_HELP} Returns the new ids.`,
    inputSchema: {
      intervention_id: INTERVENTION,
      note_ids: NOTE_IDS,
      range: RANGE,
      tracks: TRACKS,
      to: z.string().describe("Start of the copy, e.g. '25.1'"),
      to_track: z.string().optional().describe("Track id or name"),
    },
    annotations: write,
  },
  {
    name: "delete_notes",
    title: "Delete notes",
    description: `Delete notes inside an open intervention. ${TARGET_HELP} ${PROTECTED}`,
    inputSchema: {
      intervention_id: INTERVENTION,
      note_ids: NOTE_IDS,
      range: RANGE,
      tracks: TRACKS,
      base_revision: BASE,
    },
    annotations: destructive,
  },
  {
    name: "quantize_notes",
    title: "Quantize notes",
    description:
      "Pull notes towards a grid: an explicit decision, only when the user asks or clearly wants it (it removes the played feel). " +
      "grid: '1/16', '1/8', '1/8t', '1/4'… strength 0-100 % (100 = exactly on the grid). ends: also quantize where notes end. " +
      `${TARGET_HELP} ${PROTECTED}`,
    inputSchema: {
      intervention_id: INTERVENTION,
      note_ids: NOTE_IDS,
      range: RANGE,
      tracks: TRACKS,
      grid: z.string().describe("E.g. '1/16', '1/8t'"),
      strength: z.number().min(0).max(100).optional().describe("Percent, default 100"),
      ends: z.boolean().optional().describe("Also quantize the ends (default false)"),
      base_revision: BASE,
    },
    annotations: write,
  },
  {
    name: "shape_velocities",
    title: "Shape velocities",
    description:
      "Set the velocities (loudness) of some notes. Use one of: velocity (all the same); from and to (a crescendo or diminuendo across the notes, in time order); " +
      "accent with every_beats (add accent to the notes that fall on every Nth beat, from the first beat of each bar). " +
      `Velocities stay within 1-127. Changing only velocities does not change whose notes they are. ${TARGET_HELP} ${PROTECTED}`,
    inputSchema: {
      intervention_id: INTERVENTION,
      note_ids: NOTE_IDS,
      range: RANGE,
      tracks: TRACKS,
      velocity: z.number().int().min(1).max(127).optional(),
      from: z.number().int().min(1).max(127).optional(),
      to: z.number().int().min(1).max(127).optional(),
      accent: z.number().int().min(-126).max(126).optional().describe("Added to the accented notes, e.g. 12"),
      every_beats: z.number().int().min(1).optional().describe("E.g. 1 = every beat, 2 = every other beat"),
      base_revision: BASE,
    },
    annotations: write,
  },
  {
    name: "write_pedal",
    title: "Write sustain pedal",
    description:
      "Write the sustain pedal of a track: one span per line, 'start-end' positions where the pedal goes down and comes up " +
      "(e.g. '17.1-17.4+1/2'; a bare bar means its start: '17-18' = down at 17.1, up at 18.1). " +
      "The spans you write replace the pedal inside range (by default, from the first to the last span you write). " +
      "An empty spans text with a range clears the pedal there. Spans cannot overlap.",
    inputSchema: {
      intervention_id: INTERVENTION,
      track: z.string().describe("Track id or name"),
      spans: z.string().describe("One span per line, e.g. '17.1-17.4+1/2'"),
      range: z.string().optional().describe(`Where the pedal is replaced. ${RANGE_HELP}`),
    },
    annotations: write,
  },
  {
    name: "write_expression",
    title: "Write expression curves",
    description:
      "Write a track's expression (CC11: loudness inside the notes, for crescendos and swells on long notes, especially strings and winds) or modulation (CC1: vibrato in the built-in sounds; dynamics or another control in many orchestral libraries). " +
      "One line per span: '<range> <from>><to>' a straight ramp (e.g. '17-20 40>100', '33.3-34.4 100>55'), '<range> <value>' a level from the start of the span, or '<range> clear'. " +
      "Each line replaces the curve inside its range; the value then holds until the next point. Values 0–127; expression is 127 and modulation 0 where nothing is written. " +
      "step: the ramp's resolution, '1/16' by default ('1/8' or '1/32'). Expression multiplies the velocity: shape phrases with it instead of writing velocity ramps. " +
      `range: ${RANGE_HELP}`,
    inputSchema: {
      intervention_id: INTERVENTION,
      track: z.string().describe("Track id or name"),
      curve: z.enum(["expression", "modulation"]).describe("expression = CC11, modulation = CC1"),
      lines: z.string().describe("One per line: '17-20 40>100', '21 100', '25-26 clear'"),
      step: z.string().optional().describe("Ramp resolution: '1/16' (default), '1/8', '1/32'"),
    },
    annotations: write,
  },
  {
    name: "set_harmony",
    title: "Write chords",
    description:
      "Write or change the chord symbols of the harmony ruler: one per line, position and symbol, e.g. '17 Am', '17.3 F/A', '18 E7sus4'. " +
      "A bare bar means its first beat. '18 -' clears the chord at that position. " +
      "clear_range: optional, removes every chord inside it first (to rewrite a passage). " +
      "The harmony ruler is what read_notes shows at the head of each bar; writing chords does not write notes.",
    inputSchema: {
      intervention_id: INTERVENTION,
      chords: z.string().describe("One chord per line: position and symbol"),
      clear_range: z.string().optional().describe(RANGE_HELP),
    },
    annotations: write,
  },
  {
    name: "set_sections",
    title: "Write sections",
    description:
      "Create, rename, move or remove sections of the form, one per line: 'Coro 17-24' creates; 's3 Coro final 41-48' changes section s3; " +
      "'s3 -' removes it. Section ids come from get_song_overview.",
    inputSchema: {
      intervention_id: INTERVENTION,
      sections: z.string().describe("One section per line"),
    },
    annotations: write,
  },
  {
    name: "set_song_properties",
    title: "Song properties",
    description:
      "Change the title, concept, tempo, meter or key of the song. tempo and key are those at the start; " +
      "changes along the song go with set_tempo_changes and set_key_changes. " +
      "concept: the song's intention and limits in a few sentences, in the user's language ('Orquesta infectada. Dura 1:12, como los créditos; se exportará a Vital y Kontakt'). " +
      "Every AI reads it first in get_song_overview, and analyze checks a duration or tempo written in it. Write it for a new piece; if the user wrote it, change it only when they ask. '' removes it. " +
      "tempo in BPM (quarter notes per minute); meter like '3/4' or '6/8'; key like 'A minor', 'Eb major', 'F# minor'. " +
      "Changing the meter keeps every note where it is in time, so bar numbers change: tell the user.",
    inputSchema: {
      intervention_id: INTERVENTION,
      title: z.string().optional(),
      concept: z.string().max(1000).optional().describe("The intention, then the limits (duration, tempo, where the sound will go); '' removes it"),
      tempo: z.number().min(10).max(400).optional().describe("BPM"),
      meter: z.string().optional().describe("E.g. '3/4'"),
      key: z.string().optional().describe("E.g. 'A minor'"),
    },
    annotations: write,
  },
  {
    name: "set_tempo_changes",
    title: "Tempo changes",
    description:
      "Write the tempo changes after the start, one per line; the list replaces the current one (read it in get_song_overview first, and keep what you don't mean to change). " +
      "'17.1 60' jumps to 60 BPM there; '21.1 rit 50' slows down from the previous point and reaches 50 there; '25.1 accel 72' speeds up the same way; " +
      "'24.3 fermata' holds that beat twice as long (a fermata) and comes back to the tempo; 'fermata 3' three times; 'fermata 2 1/2' for a half note. " +
      "'' removes every change. The tempo at 1.1 is set_song_properties tempo. Notes stay where they are in bars; what changes is how long they last, so say how the duration changes.",
    inputSchema: {
      intervention_id: INTERVENTION,
      changes: z.string().describe("One per line, e.g. '51.1 rit 66\n52.1 58'; '' for none"),
    },
    annotations: write,
  },
  {
    name: "set_key_changes",
    title: "Key changes",
    description:
      "Write the key changes after the start, one per line, each from a bar line on; the list replaces the current one. " +
      "'17 C major', 'c. 25 La menor', or a section's name: 'Coro D major'. '' removes every change. The key at bar 1 is set_song_properties key. " +
      "Notes do not move: this says which key the music is in from there (note names, scale degrees in move_notes, and analyze follow it).",
    inputSchema: {
      intervention_id: INTERVENTION,
      changes: z.string().describe("One per line, e.g. '17 C major'; '' for none"),
    },
    annotations: write,
  },
  {
    name: "add_track",
    title: "Add a track",
    description:
      "Create a track. instrument: a name from list_instruments (e.g. 'Cellos', 'Chelos') or a General MIDI program number; " +
      "sound: optional, a sound from an installed bank as 'bank file / sound name' (from list_instruments with bank), or a plugin as 'plugin / <name>' (e.g. 'plugin / Kontakt 8'). " +
      "color: optional; by default the first colour no other track uses. Returns the track id.",
    inputSchema: {
      intervention_id: INTERVENTION,
      name: z.string().describe("Track name as the user will read it, in their language"),
      instrument: z.string().optional().describe("From list_instruments; piano if omitted"),
      sound: z.string().optional().describe("'bank file / sound name', or 'plugin / <name>'"),
      color: z.string().optional().describe(COLOR_HELP),
    },
    annotations: write,
  },
  {
    name: "update_track",
    title: "Change a track",
    description:
      "Change a track's name, instrument, installed sound, volume (0-100), pan (-100 left to 100 right), reverb (0 dry to 100), mute or colour. " +
      "sound: 'bank file / sound name', 'plugin / <name>' (a plugin from list_instruments), or 'default' to go back to the built-in sound. A track has one sound: a built-in one or a bank's replaces its plugin. " +
      "To balance several tracks at once, use set_mix. The current mix is in get_song_overview.",
    inputSchema: {
      intervention_id: INTERVENTION,
      track: z.string().describe("Track id or name"),
      name: z.string().optional(),
      instrument: z.string().optional(),
      sound: z.string().optional(),
      volume: z.number().min(0).max(100).optional(),
      pan: z.number().min(-100).max(100).optional(),
      reverb: z.number().min(0).max(100).optional().describe("Reverb send: 0 dry, more sounds further away"),
      mute: z.boolean().optional().describe("Silence the whole track (an arrangement decision)"),
      color: z.string().optional().describe(COLOR_HELP),
    },
    annotations: write,
  },
  {
    name: "set_mix",
    title: "Balance the mix",
    description:
      "Set volume, pan, reverb and mute of several tracks in one step, one track per line: the track (id or name), then any of " +
      "'vol 70' (0-100), 'pan -30' (-100 left to 100 right; also 'pan L30', 'pan R20', 'pan C'), 'rev 30' (reverb send, 0 dry to 100), 'mute' or 'unmute'. " +
      "E.g. 't1 vol 65 pan -40', 'Violines vol 80 pan L25 rev 35', 'Bateria mute'. Read the current mix in get_song_overview first. " +
      "Reverb places a track in depth: more sounds further back. Keep bass, drums and fast or short parts drier, and remember " +
      "tracks sounding in the user's DAW get the send too, where their own reverb may already be on. " +
      "You cannot hear the result: describe what you changed and why, and let the user listen. " +
      "Solo is the user's listening tool and is not available.",
    inputSchema: {
      intervention_id: INTERVENTION,
      mix: z.string().describe("One track per line, e.g. 't1 vol 65 pan -40'"),
    },
    annotations: write,
  },
  {
    name: "move_track",
    title: "Reorder a track",
    description: "Move a track to another place in the track list (position 1 = top). Only the order changes, not the music.",
    inputSchema: {
      intervention_id: INTERVENTION,
      track: z.string().describe("Track id or name"),
      position: z.number().int().min(1).describe("New position, 1 = top"),
    },
    annotations: write,
  },
  {
    name: "remove_track",
    title: "Remove a track",
    description:
      "Remove a track and all its notes. Only when the user asks for it or clearly agrees: say what will go. " +
      "Refused if the user changed after the revision you read any note of that track. The user can undo it in one step.",
    inputSchema: {
      intervention_id: INTERVENTION,
      track: z.string().describe("Track id or name"),
      base_revision: BASE,
    },
    annotations: destructive,
  },
  {
    name: "annotate",
    title: "Add a note in words",
    description:
      "Leave a short text annotation over some bars (and optionally some tracks), visible on the Notes ruler above the score: an idea, a question, a reminder. " +
      "With id, rewrite one of your annotations instead (text, and range or tracks if given): keep the score's notes true to the music " +
      "rather than adding new ones on top of old ones. The user's annotations are theirs. " +
      `range: ${RANGE_HELP}`,
    inputSchema: {
      intervention_id: INTERVENTION,
      range: z.string().optional().describe(`${RANGE_HELP} Required for a new annotation`),
      tracks: TRACKS,
      text: z.string().describe("In the user's language"),
      id: z.string().optional().describe("An annotation of yours to rewrite, e.g. 'a3'"),
    },
    annotations: write,
  },
  {
    name: "remove_annotations",
    title: "Remove annotations",
    description:
      "Remove annotations of yours that no longer describe the music (an earlier version, bars that moved). " +
      "ids from get_song_overview, or a range: every annotation of yours that starts there. The user's annotations are never removed: ask them.",
    inputSchema: {
      intervention_id: INTERVENTION,
      ids: z.array(z.string()).optional().describe("E.g. ['a1', 'a2']"),
      range: z.string().optional().describe(RANGE_HELP),
    },
    annotations: destructive,
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
      `In Four Hands Studio, read the song and what I am looking at first (get_song_overview, get_user_context). ` +
      `I want this to convey: ${feeling ?? ""}. Write it in notes inside one intervention and explain your musical choices.`,
  },
  {
    name: "review_my_harmony",
    title: "Review my harmony",
    description: "The AI reads the harmony of your selection and talks through options, without writing until you ask.",
    argsSchema: {},
    render: () =>
      "In Four Hands Studio, read my selection (get_user_context, then read_notes with range 'selection') and talk me through its harmony " +
      "and a few options. Do not write anything until I ask.",
  },
  {
    name: "continue_my_idea",
    title: "Continue my idea",
    description: "The AI continues the selected phrase, respecting its style.",
    argsSchema: {},
    render: () =>
      "In Four Hands Studio, read my selection (get_user_context, then read_notes with range 'selection') and continue the phrase " +
      "right after it, in the same style, inside one intervention. Keep my notes as they are.",
  },
  {
    name: "call_the_jury",
    title: "Call the jury",
    description: "Three judges (craft, brief, destination) assess the piece with scores, a verdict and the three changes that matter most. Nothing changes unless you ask.",
    argsSchema: { range: z.string().optional().describe("What to judge, e.g. 'section:Coro' or '1-24'; the whole song if empty") },
    render: ({ range }) =>
      `In Four Hands Studio, call the jury on ${range?.trim() ? range.trim() : "the whole song"}: load_skill("jury") and follow it. ` +
      "Do not change anything until I ask.",
  },
];
export * from "./config.js";
