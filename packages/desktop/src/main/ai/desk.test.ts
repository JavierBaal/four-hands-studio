import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PPQ, USER, barStart, formatNotes, notesOf, orderedTracks } from "@fourhands/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AiState, PatchMessage, SoundBankInfo } from "../../shared/protocol.js";
import { SongSession } from "../session.js";
import { AiDesk, type ToolReply } from "./desk.js";
import { SkillLibrary } from "./skills.js";
import { TRACK_COLOR_NAMES } from "@fourhands/mcp-tools";
import { TRACK_PALETTE } from "../../shared/track-colors.js";

const DILATACION = path.resolve(__dirname, "../../../../core/test-data/Dilatacion.mid");
const REPO_SKILLS = path.resolve(__dirname, "../../../../../skills");

let root: string;
let session: SongSession;
let desk: AiDesk;
let clock: number;
let timers: { fn: () => void; at: number; done: boolean }[];
let states: AiState[];
let logs: Record<string, unknown>[];

const BANKS: SoundBankInfo[] = [
  {
    id: "Sonatina.sf2",
    name: "Sonatina Symphonic Orchestra",
    bytes: 1,
    inUserFolder: true,
    presets: [
      { program: 0, bankMSB: 0, name: "1st Violins Sustain" },
      { program: 12, bankMSB: 0, name: "Cello Sustain", profile: { low: 36, high: 72, attack: 0.3, release: 1.5, sustain: "holds", fade: null } },
      { program: 35, bankMSB: 0, name: "Mixed Choir", profile: { low: 43, high: 84, attack: 0.62, release: 1.25, sustain: "decays", fade: 8.82 } },
    ],
  },
];

let tone: "direct" | "gentle" = "direct";

async function open(file = DILATACION): Promise<void> {
  session = await SongSession.open(
    { songsDir: path.join(root, "Four Hands"), backupsDir: path.join(root, "copias"), untitledName: "Sin título", autosaveDelayMs: 5, now: () => clock },
    file,
  );
  desk = new AiDesk({
    session: () => session,
    banks: () => BANKS,
    builtInSounds: () => [
      { program: 52, bankMSB: 0, name: "Choir Aahs", profile: { low: 0, high: 96, attack: 0.01, release: 1.7, sustain: "holds", fade: null } },
      { program: 46, bankMSB: 0, name: "Harp", profile: { low: 0, high: 108, attack: 0, release: 9.6, sustain: "fades", fade: 10.2 } },
    ],
    skills: new SkillLibrary({ builtIn: REPO_SKILLS, user: path.join(root, "Four Hands", "Skills") }),
    now: () => clock,
    setTimer: (fn, ms) => {
      const t = { fn, at: clock + ms, done: false };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => ((t as { done: boolean }).done = true),
    onState: (s) => states.push(s),
    tone: () => tone,
    log: (e) => logs.push(e),
  });
  desk.connect("c1", "claude-ai");
}

/** Advances the fake clock and fires the timers that are due. */
function advance(ms: number): void {
  clock += ms;
  for (const t of timers) if (!t.done && t.at <= clock) (t.done = true), t.fn();
}

function call(tool: string, args: Record<string, unknown> = {}, conn = "c1"): ToolReply {
  return desk.call(conn, tool, args);
}

function ok(tool: string, args: Record<string, unknown> = {}, conn = "c1"): string {
  const r = call(tool, args, conn);
  if (!r.ok) throw new Error(`${tool} failed: ${r.error}`);
  return r.text;
}

function fail(tool: string, args: Record<string, unknown> = {}, conn = "c1"): string {
  const r = call(tool, args, conn);
  if (r.ok) throw new Error(`${tool} should have failed: ${r.text}`);
  return r.error;
}

function begin(description = "Contramelodía de chelo", conn = "c1"): string {
  const text = ok("begin_intervention", { description, base_revision: `r${session.song.revision}` }, conn);
  return /Intervention (i\d+)/.exec(text)![1]!;
}

const trackByName = (name: string) => orderedTracks(session.song).find((t) => t.name.toLowerCase().includes(name.toLowerCase()))!;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fh-desk-"));
  clock = 1_000_000;
  timers = [];
  states = [];
  logs = [];
  await open();
});

afterEach(async () => {
  desk.dispose();
  await session.flush();
  session.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("reading (route 1: the AI reads the song without the user describing it)", () => {
  it("gives an overview of Dilatación", () => {
    const text = ok("get_song_overview");
    expect(text).toMatch(/^Four Hands · r\d+ · "/);
    expect(text).toContain("Tempo 72 BPM · 4/4 · A minor · 52 bars");
    expect(text).toMatch(/Form: s\d+ Intro 1-8/);
    expect(text).toMatch(/Puente/);
    for (const t of orderedTracks(session.song)) expect(text).toContain(`${t.id} ${t.name}`);
    expect(text).toMatch(/all by the user/);
    expect(text).toContain("Open interventions: none");
    expect(text.length).toBeLessThan(6000);
  });

  it("reads a section of some tracks, and pages long reads", () => {
    const cello = trackByName("cello");
    const text = ok("read_notes", { range: "section:Puente", tracks: [cello.name] });
    expect(text).toContain(`${cello.name} (${cello.id})`);
    expect(text).toMatch(/notes? in Puente \(c\. \d+–\d+\)\./);
    const all = ok("read_notes", { range: "all" });
    expect(all).toMatch(/Page 1 of 2 \(800 of \d+ notes/);
    expect(all).toContain("Next: read_notes with page 2.");
    const second = ok("read_notes", { range: "all", page: 2 });
    expect(second).toMatch(/Page 2 of 2/);
    const lines = (all + second).split("\n").filter((l) => /^n\d+ /.test(l));
    expect(new Set(lines.map((l) => l.split(" ")[0])).size).toBe(Object.keys(session.song.notes).length);
  });

  it("analyzes what it wrote: the low clash it creates is found, with its notes (ESTUDIO_SKILLS_COMPOSICION.md, 5)", () => {
    const whole = ok("analyze");
    expect(whole).toMatch(/^Analysis of whole song \(c\. 1–52\), all tracks/);
    expect(whole).toMatch(/cannot hear sounds/);
    const iv = begin("Pedal grave de Si bemol");
    const added = ok("add_notes", { intervention_id: iv, track: "Organo", notes: "A#1 5.1 1/1 v60" });
    ok("end_intervention", { intervention_id: iv });
    const id = /n\d+/.exec(added)![0];
    const text = ok("analyze", { range: "5", tracks: ["Organo"] });
    expect(text).toMatch(/Analysis of c\. 5, Organo/);
    expect(text).toContain(id);
    expect(text).toMatch(/Low register/);
    expect(fail("analyze", { range: "90" })).toBe("Bar 90 does not exist: the song has 52 bars.");
  });

  it("explains impossible ranges in musical terms", () => {
    expect(fail("read_notes", { range: "90" })).toBe("Bar 90 does not exist: the song has 52 bars.");
    expect(fail("read_notes", { range: "1-4", tracks: ["Trompeta"] })).toMatch(/^There is no track 'Trompeta'\. Tracks: t\d+/);
  });

  it("reads what the user is looking at", () => {
    const ids = notesOf(session.song, trackByName("cello").id).slice(0, 3).map((n) => n.id);
    session.document.setContext({ selection: ids, loop: { start: barStart(session.song.meter, 17), end: barStart(session.song.meter, 21) }, cursor: barStart(session.song.meter, 17) });
    desk.setWindow({ noteNames: "solfege", authorship: true, visible: { start: 0, end: barStart(session.song.meter, 9) } });
    const text = ok("get_user_context");
    expect(text).toContain(`Selection: 3 notes`);
    expect(text).toContain(ids.join(" "));
    expect(text).toContain("Loop: c. 17–20 (range 'loop')");
    expect(text).toContain("Cursor: 17.1");
    expect(text).toContain("Visible in the piano roll: c. 1–8");
    expect(text).toContain("Do Re Mi");
    expect(text).toContain("middle C = Do4");
    expect(ok("read_notes", { range: "selection" }).split("\n").filter((l) => /^n\d+ /.test(l))).toHaveLength(3);
  });

  it("tells the AI how the user wants opinions, and that only the delivery changes (H4)", () => {
    expect(ok("get_user_context")).toMatch(/Opinions: direct \(the user's setting\)\. Lead with the problem/);
    tone = "gentle";
    const text = ok("get_user_context");
    tone = "direct";
    expect(text).toMatch(/Opinions: with tact/);
    expect(text).toContain("every problem still said");
    expect(text).toContain("Never soften what is wrong");
  });

  it("Con / Sin: after an intervention ends, the window can hear the song without it (H4)", () => {
    const messages: PatchMessage[] = [];
    const off = session.onPatch((m) => messages.push(m));
    const before = Object.keys(session.song.notes).length;
    const iv = begin("Dos notas de chelo");
    ok("add_notes", { intervention_id: iv, track: trackByName("cello").id, notes: "C3 1.1 1/4\nD3 1.2 1/4" });
    expect(messages.at(-1)?.lastAi).toBeNull(); // still writing
    expect(session.songBefore()).toBeNull();
    ok("end_intervention", { intervention_id: iv });
    off();
    expect(messages.at(-1)?.lastAi).toMatchObject({ label: "Dos notas de chelo", client: "claude-ai" });
    expect(Object.keys(session.songBefore()!.notes)).toHaveLength(before);
    expect(Object.keys(session.song.notes)).toHaveLength(before + 2);
  });

  it("tells the AI what the user changed since its last call, and shows it with get_changes_since (H4)", () => {
    expect(ok("get_user_context")).not.toContain("Since your last call"); // its first call
    expect(ok("get_changes_since")).toContain("Nothing changed.");
    const cello = trackByName("cello").id;
    const iv = begin("Dos notas");
    ok("add_notes", { intervention_id: iv, track: cello, notes: "C3 1.1 1/4\nD3 1.2 1/4" });
    ok("end_intervention", { intervention_id: iv });
    // Its own writing is not news.
    expect(ok("get_user_context")).toContain("Since your last call: nothing changed.");
    const mine = notesOf(session.song, cello).filter((n) => n.shapedBy.by === "ai").map((n) => n.id);
    session.handle({ type: "run", label: "borraste 1 nota (c. 1)", commands: [{ type: "deleteNotes", ids: [mine[0]!] }] });
    const context = ok("get_user_context");
    expect(context).toMatch(/Since your last call \(r\d+\): 1 change by the user \(borraste 1 nota \(c\. 1\)\)\. Call get_changes_since before writing\./);
    const changes = ok("get_changes_since");
    expect(changes).toContain("user · borraste 1 nota (c. 1)");
    expect(changes).toMatch(/1 removed c\. 1/);
    expect(changes).toMatch(/- n\d+ C3 1\.1 1\/4 v\d+ @ai/);
    // Asked again, nothing new.
    expect(ok("get_changes_since")).toContain("Nothing changed.");
    const rev = /last call \(r(\d+)\)/.exec(context)![1];
    expect(ok("get_changes_since", { since: `r${rev}` })).toContain("1 removed");
    // More than twelve versions later, the oldest copies are gone: only the history is left.
    for (let i = 0; i < 14; i++) {
      session.handle({ type: "run", label: `tempo ${i}`, commands: [{ type: "setSongProperties", props: { tempo: 800_000 + i } }] });
      ok("get_changes_since");
    }
    expect(ok("get_changes_since", { since: `r${rev}` })).toMatch(/No copy of r\d+ is kept/);
    expect(fail("get_changes_since", { since: "ayer" })).toMatch(/not a revision/);
  });

  it("gives the signed history newest first, and a summary by section (H4)", () => {
    const iv = begin("Contracanto");
    ok("add_notes", { intervention_id: iv, track: trackByName("cello").id, notes: "C3 1.1 1/4" });
    ok("end_intervention", { intervention_id: iv });
    const history = ok("get_history", { limit: 5 });
    expect(history.split("\n")[1]).toMatch(/^r\d+ Claude \(claude-ai\) · Contracanto$/);
    const summary = ok("summarize", { range: "section:Intro" });
    expect(summary).toMatch(/summary · c\. 1–8/);
    expect(summary).toMatch(/Intro c\. 1–8 · /);
    expect(summary).toMatch(/: silent|· user/);
  });

  it("writes expression ramps and modulation levels, reads them back as ramps, and undoes in one step (H4)", () => {
    const cello = trackByName("cello").id;
    const iv = begin("Crescendo del chelo");
    const reply = ok("write_expression", { intervention_id: iv, track: cello, curve: "expression", lines: "17-20 40>100\n21 100" });
    expect(reply).toMatch(/^Expression \(CC11\) of .* in c\. 17–21: 17\.1→20\.4\+3\/4 40→100 · 21\.1 100\./);
    const points = session.song.tracks[cello]!.curves!.expression!;
    expect(points[0]).toEqual({ tick: barStart(session.song.meter, 17), value: 40 });
    expect(points.find((p) => p.tick === barStart(session.song.meter, 21))?.value).toBe(100);
    ok("write_expression", { intervention_id: iv, track: cello, curve: "modulation", lines: "17-18 30", step: "1/8" });
    ok("end_intervention", { intervention_id: iv });
    const read = ok("read_notes", { range: "17-20", tracks: [cello] });
    expect(read).toContain("expression CC11: 17.1→20.4+3/4 40→100");
    expect(read).toContain("modulation CC1: 17.1 30");
    expect(ok("get_song_overview")).toContain("expression curve (CC11)");
    expect(fail("write_expression", { intervention_id: begin("x"), track: cello, curve: "expression", lines: "17-20 40>200" })).toMatch(/0 to 127/);
    session.handle({ type: "undo" });
    session.handle({ type: "undo" });
    expect(session.song.tracks[cello]!.curves).toBeUndefined();
  });

  it("lists the interventions it finished on this song for the activity panel, newest first (H4)", () => {
    const cello = trackByName("cello").id;
    const a = begin("Primera");
    ok("add_notes", { intervention_id: a, track: cello, notes: "C3 1.1 1/4\nD3 1.2 1/4" });
    ok("end_intervention", { intervention_id: a });
    const b = begin("Vacía");
    ok("end_intervention", { intervention_id: b });
    const c = begin("Segunda");
    ok("add_notes", { intervention_id: c, track: cello, notes: "E3 3.1 1/2" });
    ok("end_intervention", { intervention_id: c });
    const recent = desk.state().recent!;
    expect(recent.map((r) => r.description)).toEqual(["Segunda", "Primera"]); // the empty one is not listed
    expect(recent[1]).toMatchObject({ name: "Claude", added: 2, changed: 0, removed: 0, trackIds: [cello], start: 0 });
    desk.songChanged();
    expect(desk.state().recent).toEqual([]);
  });

  it("tells the AI which tracks sound outside Four Hands (H4, MIDI out)", () => {
    const cello = trackByName("cello").id;
    session.handle({ type: "run", label: "chelo a Studio One", commands: [{ type: "updateTrack", id: cello, changes: { output: "external" } }] });
    expect(ok("get_song_overview")).toMatch(/sounds outside Four Hands \(MIDI out/);
  });

  it("lists instruments with their ranges and the installed banks", () => {
    const text = ok("list_instruments");
    expect(text).toContain("Cellos / Chelos · program 42 · C2–A5");
    expect(text).toContain("Sonatina.sf2");
    expect(ok("list_instruments", { bank: "sonatina" })).toContain("Cello Sustain");
  });

  it("shows the window that the AI is reading, for a moment", () => {
    ok("get_song_overview");
    expect(states.at(-1)?.reading).toBe("Claude");
    advance(3000);
    expect(states.at(-1)?.reading).toBe(null);
  });
});

describe("interventions: one intervention = one undo step", () => {
  it("writes live, signs the history and undoes in one step", () => {
    const cello = trackByName("cello");
    const notesText = () => formatNotes(session.song).replace(/ · r\d+ · /g, " · ");
    const before = notesText();
    const revision = session.song.revision;
    const id = begin();
    const a = ok("add_notes", { intervention_id: id, track: cello.name, notes: "E3 17.1 1/2 v70\nF3 17.3 1/4" });
    expect(a).toMatch(/^Added 2 notes to .* c\. 17: n\d+ n\d+ · r\d+$/);
    expect(session.song.revision).toBe(revision + 1); // live: the window already has it
    expect(states.at(-1)?.writing[0]).toMatchObject({ id, name: "Claude", description: "Contramelodía de chelo", notes: 2, trackIds: [cello.id] });
    ok("add_notes", { intervention_id: id, track: cello.id, notes: "G3 18.1 1/1 v64" });
    const [, , third] = a.match(/n\d+/g)!;
    void third;
    const added = notesOf(session.song, cello.id).filter((n) => n.shapedBy.by === "ai");
    expect(added).toHaveLength(3);
    expect(added.every((n) => n.shapedBy.by === "ai" && n.shapedBy.client === "claude-ai")).toBe(true);
    const end = ok("end_intervention", { intervention_id: id });
    expect(end).toMatch(/closed: 3 notes added \(c\. 17–18, .*\)\. It is one undo step/);
    expect(session.history.at(-1)).toMatchObject({ label: "Contramelodía de chelo", actor: { by: "ai", client: "claude-ai" } });
    expect(session.history.filter((h) => h.label === "Contramelodía de chelo")).toHaveLength(1);
    session.handle({ type: "undo" });
    expect(notesText()).toBe(before);
    expect(states.at(-1)?.writing).toEqual([]);
  });

  it("refuses writes without an open intervention, and says why", () => {
    expect(fail("add_notes", { intervention_id: "i99", track: "t1", notes: "C4 1.1 1/4" })).toMatch(/There is no intervention i99\. Start one with begin_intervention/);
    const id = begin();
    expect(fail("begin_intervention", { description: "otra", base_revision: "r1" })).toMatch(/is still open/);
    ok("end_intervention", { intervention_id: id });
    expect(fail("add_notes", { intervention_id: id, track: "t1", notes: "C4 1.1 1/4" })).toMatch(/is closed\. You closed it/);
  });

  it("closes by itself after 5 minutes without calls, and each call restarts the count", () => {
    const id = begin();
    advance(4 * 60_000);
    ok("add_notes", { intervention_id: id, track: "t1", notes: "C4 60.1 1/4" });
    advance(4 * 60_000);
    ok("add_notes", { intervention_id: id, track: "t1", notes: "D4 60.2 1/4" });
    advance(5 * 60_000);
    expect(fail("add_notes", { intervention_id: id, track: "t1", notes: "E4 60.3 1/4" })).toMatch(/closed by itself after 5 minutes/);
    expect(logs.some((l) => l.type === "ai_intervention_closed" && l.how === "timeout")).toBe(true);
  });

  it("the user can close it from the app", () => {
    const id = begin();
    ok("add_notes", { intervention_id: id, track: "t1", notes: "C4 60.1 1/4" });
    desk.closeByUser(id);
    expect(states.at(-1)?.writing).toEqual([]);
    expect(fail("add_notes", { intervention_id: id, track: "t1", notes: "D4 60.2 1/4" })).toMatch(/The user closed it/);
  });

  it("rejects a whole call when one line is wrong, and writes nothing", () => {
    const id = begin();
    const revision = session.song.revision;
    expect(fail("add_notes", { intervention_id: id, track: "t1", notes: "C4 17.1 1/4\nG#9 17.2 1/4" })).toBe(
      'Line 2 ("G#9 17.2 1/4"): \'G#9\' is outside the MIDI range (C-1 to G9). Nothing was written.',
    );
    expect(session.song.revision).toBe(revision);
  });

  it("if the user edits in the middle, the intervention becomes more than one step but undo stays correct", () => {
    const id = begin("Bajo del verso");
    ok("add_notes", { intervention_id: id, track: "t1", notes: "C3 60.1 1/4" });
    const user = notesOf(session.song, "t1")[0]!;
    session.run("moviste 1 nota", [{ type: "moveNotes", ids: [user.id], ticks: PPQ }]);
    ok("add_notes", { intervention_id: id, track: "t1", notes: "D3 60.2 1/4" });
    expect(session.history.slice(-3).map((h) => h.label)).toEqual(["Bajo del verso", "moviste 1 nota", "Bajo del verso"]);
  });
});

describe("the user's notes are protected (ESQUEMA_MCP.md, 5.2)", () => {
  it("refuses to change a note the user changed after the AI read it", () => {
    const note = notesOf(session.song, "t1")[0]!;
    const id = begin();
    session.run("subiste 1 nota", [{ type: "moveNotes", ids: [note.id], semitones: 1 }]);
    const error = fail("edit_notes", { intervention_id: id, changes: `${note.id} v40` });
    expect(error).toMatch(new RegExp(`^${note.id} has changed since r\\d+ \\(the user made it: ${note.id} \\S+ .*\\)\\. Read it again with read_notes; then pass base_revision\\. Nothing was written\\.$`));
    // After reading again, with the new revision, it is allowed.
    ok("edit_notes", { intervention_id: id, changes: `${note.id} v40`, base_revision: `r${session.song.revision}` });
    expect(session.song.notes[note.id]?.velocity).toBe(40);
  });

  it("says when the user deleted the note", () => {
    const note = notesOf(session.song, "t1")[0]!;
    const id = begin();
    session.run("borraste 1 nota", [{ type: "deleteNotes", ids: [note.id] }]);
    expect(fail("delete_notes", { intervention_id: id, note_ids: [note.id] })).toMatch(/^The user deleted n\d+ after r\d+/);
  });

  it("the AI's own changes do not block it", () => {
    const note = notesOf(session.song, "t1")[0]!;
    const id = begin();
    ok("edit_notes", { intervention_id: id, changes: `${note.id} v41` });
    ok("edit_notes", { intervention_id: id, changes: `${note.id} v42` });
    expect(session.song.notes[note.id]?.velocity).toBe(42);
  });
});

describe("route 3: my rhythm, your pitches", () => {
  it("changes only pitches; rhythm, durations, velocities and deviations stay exact", () => {
    const t = session.run("Nueva pista", [{ type: "addTrack", spec: { name: "Violines", program: 40, channel: 12 } }])[0] as string;
    // The user draws a rhythm on one pitch, slightly off the grid as a hand does.
    const bar = barStart(session.song.meter, 30);
    const drawn = [
      { pitch: 72, start: bar + 7, duration: 470, velocity: 70 },
      { pitch: 72, start: bar + PPQ - 5, duration: 230, velocity: 64 },
      { pitch: 72, start: bar + 1.5 * PPQ + 12, duration: 250, velocity: 66 },
      { pitch: 72, start: bar + 2 * PPQ, duration: 2 * PPQ - 30, velocity: 72 },
    ];
    const ids = session.run("dibujaste 4 notas", [{ type: "addNotes", trackId: t, notes: drawn }])[0] as string[];
    const before = ids.map((id) => ({ ...session.song.notes[id]! }));
    const read = ok("read_notes", { range: "30", tracks: ["Violines"] });
    expect(read).toMatch(/~s\+0\.01|~s-0\.01/);
    const id = begin("Alturas para tu ritmo");
    const text = ok("repitch_notes", { intervention_id: id, pitches: ids.map((n, i) => `${n} ${["E5", "D5", "C5", "B4"][i]}`).join("\n") });
    expect(text).toMatch(/rhythm, durations, velocities and deviations untouched/);
    ids.forEach((nid, i) => {
      const after = session.song.notes[nid]!;
      expect(after.start).toBe(before[i]!.start);
      expect(after.duration).toBe(before[i]!.duration);
      expect(after.velocity).toBe(before[i]!.velocity);
      expect(after.pitch).toBe([76, 74, 72, 71][i]);
      // Authorship rule: whoever decided the pitch now shapes the note; it was created by the user.
      // The third one already was C5: nothing changed, so it stays the user's.
      expect(after.createdBy.by).toBe("user");
      expect(after.shapedBy.by).toBe(i === 2 ? "user" : "ai");
    });
    expect(fail("repitch_notes", { intervention_id: id, pitches: `${ids[0]} E5 30.2` })).toMatch(/only changes pitches/);
  });
});

describe("route 6: play and polish", () => {
  it("writes a counter-melody without quantizing or touching what the user played", () => {
    // The user records a rubato piano phrase (no quantize).
    const bar = barStart(session.song.meter, 53);
    const played = [0, 1, 2, 3, 4, 5].map((i) => ({ pitch: 64 + i, start: bar + i * PPQ + [13, -21, 37, 8, -30, 55][i]!, duration: PPQ - [40, 10, 70, 0, 25, 90][i]!, velocity: 60 + i }));
    const ids = session.run("grabaste 6 notas", [{ type: "addNotes", trackId: "t1", notes: played }])[0] as string[];
    const snapshot = ids.map((id) => JSON.stringify(session.song.notes[id]));
    const id = begin("Contramelodía de chelo que respira contigo");
    ok("add_track", { intervention_id: id, name: "Chelo", instrument: "cello" });
    const cello = trackByName("Chelo");
    expect(cello.program).toBe(42);
    const added = ok("add_notes", { intervention_id: id, track: "Chelo", notes: "A2 53.1 1/2 ~s+0.02\nB2 53.3 1/4.\nC3 54.1 1/2 v58 ~d-0.10" });
    expect(added).toMatch(/Added 3 notes/);
    ok("end_intervention", { intervention_id: id });
    expect(ids.map((nid) => JSON.stringify(session.song.notes[nid]))).toEqual(snapshot);
    const celloNotes = notesOf(session.song, cello.id);
    expect(celloNotes[0]!.start).toBe(bar + Math.round(0.02 * PPQ));
    expect(celloNotes[2]!.duration).toBe(2 * PPQ - Math.round(0.1 * PPQ));
  });
});

describe("transformations keep the played feel", () => {
  it("move_notes keeps each note's deviation, by time and by scale degree", () => {
    const bar = barStart(session.song.meter, 53);
    const ids = session.run("grabaste", [{ type: "addNotes", trackId: "t1", notes: [{ pitch: 69, start: bar + 17, duration: PPQ, velocity: 70 }, { pitch: 72, start: bar + PPQ - 9, duration: PPQ, velocity: 70 }] }])[0] as string[];
    const id = begin("Mover");
    ok("move_notes", { intervention_id: id, note_ids: ids, by_time: "+1 bar", by_degrees: 2, base_revision: `r${session.song.revision}` });
    expect(session.song.notes[ids[0]!]).toMatchObject({ start: bar + 4 * PPQ + 17, pitch: 72 });
    expect(session.song.notes[ids[1]!]).toMatchObject({ start: bar + 5 * PPQ - 9, pitch: 76 });
  });

  it("copy_notes copies deviations and quantize_notes only does what it is told", () => {
    const bar = barStart(session.song.meter, 53);
    const ids = session.run("grabaste", [{ type: "addNotes", trackId: "t1", notes: [{ pitch: 69, start: bar + 20, duration: PPQ - 20, velocity: 70 }] }])[0] as string[];
    const id = begin("Copiar");
    const copy = ok("copy_notes", { intervention_id: id, note_ids: ids, to: "55.1" });
    const newId = /n\d+/.exec(copy.split(":")[1]!)![0];
    expect(session.song.notes[newId]!.start).toBe(barStart(session.song.meter, 55) + 20);
    ok("quantize_notes", { intervention_id: id, note_ids: [newId], grid: "1/16", strength: 50, base_revision: `r${session.song.revision}` });
    expect(session.song.notes[newId]!.start).toBe(barStart(session.song.meter, 55) + 10);
  });

  it("shape_velocities: set, crescendo and accents", () => {
    const bar = barStart(session.song.meter, 53);
    const ids = session.run("notas", [{ type: "addNotes", trackId: "t1", notes: [0, 1, 2, 3].map((i) => ({ pitch: 60, start: bar + i * PPQ, duration: PPQ, velocity: 50 })) }])[0] as string[];
    const id = begin("Dinámica");
    const base = `r${session.song.revision}`;
    ok("shape_velocities", { intervention_id: id, note_ids: ids, from: 40, to: 100, base_revision: base });
    expect(ids.map((n) => session.song.notes[n]!.velocity)).toEqual([40, 60, 80, 100]);
    ok("shape_velocities", { intervention_id: id, note_ids: ids, accent: 10, every_beats: 2, base_revision: base });
    expect(ids.map((n) => session.song.notes[n]!.velocity)).toEqual([50, 60, 90, 100]);
    expect(fail("shape_velocities", { intervention_id: id, note_ids: ids, velocity: 10, accent: 5 })).toMatch(/Use one of/);
  });
});

describe("form, harmony, pedal, properties, tracks and annotations", () => {
  it("writes them inside the same undo step", () => {
    const before = JSON.stringify({ ...session.song, revision: 0, counters: null });
    const id = begin("Preparo el final");
    ok("set_harmony", { intervention_id: id, chords: "53 Am\n53.3 F/A\n54 E7sus4" });
    expect(session.song.harmony[String(barStart(session.song.meter, 53) + 2 * PPQ)]).toBe("F/A");
    ok("set_sections", { intervention_id: id, sections: "Coda 53-56" });
    ok("write_pedal", { intervention_id: id, track: "t1", spans: "53.1-53.4+1/2\n54-55" });
    expect(session.song.tracks.t1!.pedal.at(-1)).toEqual({ start: barStart(session.song.meter, 54), end: barStart(session.song.meter, 55) });
    ok("set_song_properties", { intervention_id: id, title: "Dilatación (a cuatro manos)", tempo: 70 });
    ok("annotate", { intervention_id: id, range: "53-56", text: "Aquí respira" });
    ok("update_track", { intervention_id: id, track: "t1", volume: 70, pan: -20 });
    expect(ok("get_song_overview")).toMatch(/Coda 53-56/);
    const end = ok("end_intervention", { intervention_id: id });
    expect(end).toMatch(/chords, sections, pedal of .*, title/);
    session.handle({ type: "undo" });
    expect(JSON.stringify({ ...session.song, revision: 0, counters: null })).toBe(before);
  });

  it("rewrites and removes its own annotations, never the user's (the Severance sessions, 20/10/2026)", () => {
    session.document.transact({ actor: USER, label: "nota" }, (tx) => {
      tx.set(["annotations", "a900"], { id: "a900", start: 0, end: 3840, trackIds: [], text: "mía", author: USER });
    });
    const id = begin("Notas");
    const first = ok("annotate", { intervention_id: id, range: "1-4", text: "Versión 1" });
    const a = /Annotation (a\d+)/.exec(first)![1]!;
    ok("annotate", { intervention_id: id, range: "5-8", text: "Versión 1, otra" });
    expect(ok("annotate", { intervention_id: id, id: a, text: "Versión 2", range: "1-2" })).toMatch(/rewritten on c\. 1–2: "Versión 2" \(was "Versión 1"\)/);
    expect(session.song.annotations[a]!.text).toBe("Versión 2");
    expect(fail("annotate", { intervention_id: id, id: "a900", text: "x" })).toMatch(/is the user's/);
    expect(fail("remove_annotations", { intervention_id: id, ids: ["a900"] })).toMatch(/is the user's/);
    expect(ok("remove_annotations", { intervention_id: id, range: "all" })).toMatch(/^Removed a\d+ a\d+\. The user's annotations stay/);
    expect(Object.keys(session.song.annotations)).toEqual(["a900"]);
    ok("end_intervention", { intervention_id: id });
    session.handle({ type: "undo" });
    expect(Object.keys(session.song.annotations).length).toBe(1);
  });

  it("finds instruments and installed sounds by name", () => {
    const id = begin("Pistas");
    ok("add_track", { intervention_id: id, name: "Violas", instrument: "Violas" });
    expect(trackByName("Violas").program).toBe(41);
    ok("add_track", { intervention_id: id, name: "Chelos Sonatina", instrument: "Chelos", sound: "Sonatina.sf2 / cello sus" });
    expect(trackByName("Chelos Sonatina").sound).toEqual({ bank: "Sonatina.sf2", program: 12, bankMSB: 0, name: "Cello Sustain" });
    expect(fail("add_track", { intervention_id: id, name: "X", instrument: "theremin" })).toMatch(/not an instrument I know/);
    ok("update_track", { intervention_id: id, track: "Chelos Sonatina", sound: "default" });
    expect(trackByName("Chelos Sonatina").sound).toBeUndefined();
  });

  it("warns, without refusing, when notes leave the instrument's range", () => {
    const id = begin("Grave");
    ok("add_track", { intervention_id: id, name: "Chelo", instrument: "Chelos" });
    expect(ok("add_notes", { intervention_id: id, track: "Chelo", notes: "C1 53.1 1/4" })).toMatch(/outside the usual range of Cellos \(C2–A5\)/);
  });
});

describe("several AIs and pointing", () => {
  it("keeps one intervention per AI and does not let one write in another's", () => {
    desk.connect("c2", "local-agent-mode-Four Hands Studio");
    const a = begin("Desde el escritorio", "c1");
    const b = begin("Desde la web", "c2");
    expect(a).not.toBe(b);
    expect(fail("add_notes", { intervention_id: a, track: "t1", notes: "C4 53.1 1/4" }, "c2")).toMatch(/belongs to another AI/);
    expect(desk.state().writing.map((w) => w.description)).toEqual(["Desde el escritorio", "Desde la web"]);
    expect(desk.state().clients).toHaveLength(2);
  });

  it("point_to leaves a mark without touching the song", () => {
    const revision = session.song.revision;
    const text = ok("point_to", { range: "23", tracks: ["t1"], reason: "aquí el chelo cruza a la viola" });
    expect(text).toMatch(/Pointed to c\. 23 .*their view did not move/);
    expect(session.song.revision).toBe(revision);
    expect(desk.state().mark).toMatchObject({ name: "Claude", reason: "aquí el chelo cruza a la viola", trackIds: ["t1"], start: barStart(session.song.meter, 23) });
    desk.markSeen(desk.state().mark!.id);
    expect(desk.state().mark).toBeNull();
  });

  it("opening another song closes everything", async () => {
    const id = begin();
    await session.newSong();
    desk.songChanged();
    expect(desk.state().writing).toEqual([]);
    expect(fail("add_notes", { intervention_id: id, track: "t1", notes: "C4 1.1 1/4" })).toMatch(/There is no intervention/);
    // The new song's patches are still followed.
    void USER;
  });
});

describe("H3.1: the mix and the track list", () => {
  it("the overview shows each track's mix and average velocity", () => {
    const text = ok("get_song_overview");
    expect(text).toMatch(/t1 .* avg v\d+ .*mix vol 80 pan C/);
  });

  it("set_mix balances several tracks in one undo step", () => {
    const before = orderedTracks(session.song).map((t) => ({ v: t.volume, p: t.pan, m: t.mute }));
    const id = begin("Equilibro la mezcla");
    const text = ok("set_mix", { intervention_id: id, mix: "t1 vol 65 pan -40\nPiano ostinato vol 70 pan R25\nBateria mute\nt3 pan C vol 85" });
    expect(text).toContain("t1 Organo · mix vol 65 pan L40");
    expect(text).toMatch(/Piano ostinato · mix vol 70 pan R25/);
    expect(text).toMatch(/Bateria · mix vol 80 pan C muted/);
    expect(session.song.tracks.t3).toMatchObject({ volume: 0.85, pan: 0 });
    // Velocities, notes and authorship untouched: the mix is not the music.
    expect(Object.values(session.song.notes).every((n) => n.shapedBy.by === "user")).toBe(true);
    expect(ok("end_intervention", { intervention_id: id })).toMatch(/the mix/);
    session.handle({ type: "undo" });
    expect(orderedTracks(session.song).map((t) => ({ v: t.volume, p: t.pan, m: t.mute }))).toEqual(before);
  });

  it("set_mix and update_track set the reverb send, and the overview shows it (H4)", () => {
    const id = begin("Los violines más lejos");
    const text = ok("set_mix", { intervention_id: id, mix: "t1 rev 35\nt2 vol 70 reverb 20" });
    expect(text).toContain("t1 Organo · mix vol 80 pan C rev 35");
    expect(session.song.tracks.t1!.reverb).toBe(0.35);
    expect(session.song.tracks.t2).toMatchObject({ volume: 0.7, reverb: 0.2 });
    expect(ok("update_track", { intervention_id: id, track: "t1", reverb: 0 })).toContain("reverb 0");
    expect("reverb" in session.song.tracks.t1!).toBe(false);
    expect(fail("set_mix", { intervention_id: id, mix: "t1 rev 120" })).toMatch(/reverb goes from 0 \(dry\) to 100/);
    expect(ok("get_song_overview")).toMatch(/t2 .*mix vol 70 pan C rev 20/);
    ok("end_intervention", { intervention_id: id });
  });

  it("set_mix rejects the whole call when a line is wrong", () => {
    const id = begin("Mezcla");
    const revision = session.song.revision;
    expect(fail("set_mix", { intervention_id: id, mix: "t1 vol 65\nt2 vol 140" })).toMatch(/^Line 2 \("t2 vol 140"\): volume goes from 0 to 100\. Nothing was written\.$/);
    expect(fail("set_mix", { intervention_id: id, mix: "t1 solo" })).toMatch(/write the track first/);
    expect(fail("set_mix", { intervention_id: id, mix: "t1 vol 60\nt1 pan L10" })).toMatch(/appears twice/);
    expect(fail("set_mix", { intervention_id: id, mix: "t1 pan X9" })).toMatch(/is not a pan/);
    expect(session.song.revision).toBe(revision);
  });

  it("update_track mutes; solo stays the user's", () => {
    const id = begin("El órgano calla");
    ok("update_track", { intervention_id: id, track: "t1", mute: true });
    expect(session.song.tracks.t1!.mute).toBe(true);
    expect(fail("update_track", { intervention_id: id, track: "t1", mute: "yes" })).toMatch(/true or false/);
  });

  it("move_track reorders and remove_track removes, each undone in one step", () => {
    const id = begin("Ordeno las pistas");
    const order = [...session.song.trackOrder];
    expect(ok("move_track", { intervention_id: id, track: "t5", position: 1 })).toMatch(/^Tracks now: 1\. Bajo \(contrabajo\) \(t5\)/);
    expect(fail("move_track", { intervention_id: id, track: "t5", position: 9 })).toMatch(/position goes from 1 to 6/);
    const notes = notesOf(session.song, "t6").length;
    expect(ok("remove_track", { intervention_id: id, track: "Bateria" })).toMatch(new RegExp(`removed, with its ${notes} notes`));
    expect(session.song.tracks.t6).toBeUndefined();
    ok("end_intervention", { intervention_id: id });
    session.handle({ type: "undo" });
    expect(session.song.trackOrder).toEqual(order);
    expect(notesOf(session.song, "t6")).toHaveLength(notes);
  });

  it("remove_track is refused if the user changed that track after the AI read it", () => {
    const id = begin("Quito la percusión");
    const note = notesOf(session.song, "t6")[0]!;
    session.run("moviste 1 nota", [{ type: "moveNotes", ids: [note.id], ticks: PPQ }]);
    expect(fail("remove_track", { intervention_id: id, track: "t6" })).toMatch(new RegExp(`^${note.id} has changed since`));
    expect(session.song.tracks.t6).toBeDefined();
  });
});

describe("H3.2: track colours", () => {
  it("the overview names each track's colour", () => {
    expect(ok("get_song_overview")).toMatch(/t1 .*mix vol 80 pan C · color lavender/);
  });

  it("add_track and update_track take a colour by name, in English or Spanish", () => {
    const id = begin("Colores");
    expect(ok("add_track", { intervention_id: id, name: "Arpa", instrument: "46", color: "moss" })).toMatch(/color moss/);
    const harp = orderedTracks(session.song).at(-1)!;
    expect(harp.color).toBe(7);
    expect(ok("update_track", { intervention_id: id, track: "t1", color: "Ciruela" })).toMatch(/color plum/);
    expect(session.song.tracks.t1!.color).toBe(6);
    expect(fail("update_track", { intervention_id: id, track: "t1", color: "rojo" })).toMatch(/There is no colour 'rojo'. Colours: lavender, sand/);
    ok("end_intervention", { intervention_id: id });
    session.handle({ type: "undo" });
    expect(session.song.tracks.t1!.color).toBe(0);
  });

  it("the tool descriptions list the same colour names as the app's palette", () => {
    expect([...TRACK_COLOR_NAMES]).toEqual(TRACK_PALETTE.map((c) => c.id));
  });
});

describe("skills served by the app (ESTUDIO_SKILLS.md, 3)", () => {
  it("list_skills lists the built-in skills, the basics first, and the overview points to them", () => {
    const text = ok("list_skills");
    expect(text).toMatch(/^Skills \(\d+\)\. Load with load_skill/);
    expect(text.split("\n")[1]).toMatch(/^- four-hands-basics \(built in\): /);
    for (const name of ["feelings-to-music", "listening-review", "orchestration-register", "styles"]) expect(text).toContain(`- ${name} (built in`);
    expect(text).toMatch(/styles \(built in, 3 reference files\)/);
    expect(ok("get_song_overview")).toMatch(/\nSkills \(list_skills\): four-hands-basics, .*Load four-hands-basics before you write anything/);
  });

  it("load_skill returns the instructions without the front matter, and its references on request", () => {
    const basics = ok("load_skill", { name: "four-hands-basics" });
    expect(basics).toMatch(/^Skill four-hands-basics \(built in\)\. Follow it\./);
    expect(basics).not.toMatch(/^---$/m);
    const styles = ok("load_skill", { name: "Styles" });
    expect(styles).toContain("Reference files (load_skill with file when the instructions point to them): references/cinematic-hybrid.md, references/dark-synth.md, references/title-experimental.md");
    expect(ok("load_skill", { name: "styles", file: "references/dark-synth.md" })).toMatch(/^Skill styles, file references\/dark-synth\.md:\n\n# /);
    expect(ok("load_skill", { name: "styles", file: "dark-synth.md" })).toMatch(/file dark-synth\.md/);
  });

  it("refuses unknown skills and files outside the skill, saying what there is", () => {
    expect(fail("load_skill", { name: "jazz" })).toMatch(/^There is no skill 'jazz'\. Skills: four-hands-basics, /);
    expect(fail("load_skill", { name: "styles", file: "../four-hands-basics/SKILL.md" })).toMatch(/has no file .*Files: references\/cinematic-hybrid\.md/);
    expect(fail("load_skill", {})).toMatch(/Missing 'name'/);
    expect(fail("load_skill", { name: "jazz" })).not.toMatch(/Nothing was written/);
  });

  it("a skill in the user's folder shows up at once and wins over a built-in one with its name", () => {
    const user = path.join(root, "Four Hands", "Skills");
    fs.mkdirSync(path.join(user, "mi-armonia"), { recursive: true });
    fs.writeFileSync(path.join(user, "mi-armonia", "SKILL.md"), "---\nname: mi-armonia\ndescription: Cómo armonizo: nunca dobles la tercera.\n---\n\n# Mi armonía\n\nNunca dobles la tercera.\n");
    fs.mkdirSync(path.join(user, "styles"), { recursive: true });
    fs.writeFileSync(path.join(user, "styles", "SKILL.md"), "---\nname: styles\ndescription: Mis estilos.\n---\nSolo los míos.");
    const text = ok("list_skills");
    expect(text).toContain("- mi-armonia (the user's): Cómo armonizo: nunca dobles la tercera.");
    expect(text).toContain("- styles (the user's): Mis estilos.");
    expect(text).not.toContain("styles (built in");
    expect(ok("load_skill", { name: "mi-armonia" })).toMatch(/\(the user's\)\. Follow it\.\n\n# Mi armonía/);
    expect(ok("load_skill", { name: "styles" })).toMatch(/Solo los míos\.$/);
  });

  it("the window learns which skills an AI loaded", () => {
    ok("load_skill", { name: "jury" });
    ok("load_skill", { name: "styles", file: "references/dark-synth.md" });
    expect(desk.state().skillsUsed).toEqual(["jury", "styles"]);
  });

  it("need no intervention and don't show the AI reading the song", () => {
    states.length = 0;
    ok("list_skills");
    ok("load_skill", { name: "listening-review" });
    expect(states.every((s) => !s.reading)).toBe(true);
    expect(logs.at(-1)).toMatchObject({ type: "ai_call", tool: "load_skill", ok: true });
  });
});

describe("sound profiles (ESTUDIO_SKILLS_COMPOSICION.md, 5.4)", () => {
  it("list_instruments says how each built-in sound behaves, from the default bank's data", () => {
    const text = ok("list_instruments");
    expect(text).toMatch(/Choir \/ Coro · program 52 · E2–A5 · sung 'aah' vowels: no words, no consonants · fast attack, holds long notes, rings 1\.7 s after the note ends/);
    expect(text).toMatch(/Harp \/ Arpa · program 46 · B0–G#7 · fast attack, fades away in about 10\.2 s even when held, rings 9\.6 s/);
    expect(text).toMatch(/General MIDI 120-127 .* sound effects/);
  });

  it("a bank's sounds come with the keys they have samples for and their attack", () => {
    const text = ok("list_instruments", { bank: "sonatina" });
    expect(text).toContain("Mixed Choir · plays G2–C6 (silent outside), slow attack 0.62 s: sounds late, not for short hits; write it early, no loop: dies out after about 8.8 s, re-strike long notes, rings 1.3 s after the note ends");
    expect(text).toContain("Cello Sustain · plays C2–C5 (silent outside), slow attack 0.3 s");
  });

  it("writing or analysing outside a bank sound's samples is reported", () => {
    const id = begin("Chelos de Sonatina");
    ok("add_track", { intervention_id: id, name: "Chelos Sonatina", instrument: "Chelos", sound: "Sonatina.sf2 / cello sus" });
    const track = trackByName("Chelos Sonatina");
    const written = ok("add_notes", { intervention_id: id, track: track.id, notes: "C2 1.1 1/2\nB1 1.3 1/2" });
    expect(written).toMatch(/1 note is outside the keys "Cello Sustain" has samples for \(C2–C5\)/);
    ok("end_intervention", { intervention_id: id });
    expect(ok("analyze", { range: "1", tracks: [track.id] })).toMatch(/Outside the instrument's usual range \(or the keys a bank's sound has samples for\):\n.*B1/);
  });
});

describe("the song concept (ESTUDIO_SKILLS_COMPOSICION.md, 6.3)", () => {
  it("the overview says there is none and how to write one, then shows it with its author", () => {
    expect(ok("get_song_overview").split("\n")[2]).toMatch(/^Concept: none yet\. For a new piece, write one with set_song_properties concept/);
    const id = begin("Concepto");
    expect(ok("set_song_properties", { intervention_id: id, concept: "Dilatación: el tiempo se estira. Dura 2:20." })).toMatch(/^Song: concept rewritten\./);
    ok("end_intervention", { intervention_id: id });
    expect(session.song.concept).toEqual({ text: "Dilatación: el tiempo se estira. Dura 2:20.", author: { by: "ai", client: "claude-ai" } });
    expect(ok("get_song_overview").split("\n")[2]).toBe("Concept (by an AI; reread it before changing anything): Dilatación: el tiempo se estira. Dura 2:20.");
    expect(ok("analyze")).toMatch(/Against the limits in the song concept:\n  the concept says 2:20; the music lasts/);
  });

  it("'' removes it, and it is one undo step with the rest of the intervention", () => {
    const id = begin("Concepto");
    ok("set_song_properties", { intervention_id: id, concept: "Algo" });
    ok("set_song_properties", { intervention_id: id, concept: "" });
    ok("end_intervention", { intervention_id: id });
    expect(session.song.concept).toBeUndefined();
    expect(fail("set_song_properties", { intervention_id: begin("x"), concept: 3 })).toMatch(/'concept' must be text/);
  });
});
