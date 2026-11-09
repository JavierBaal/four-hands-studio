import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PPQ, USER, barStart, formatNotes, notesOf, orderedTracks } from "@fourhands/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AiState, PatchMessage, SoundBankInfo } from "../../shared/protocol.js";
import { SongSession } from "../session.js";
import { AiDesk, type ToolReply } from "./desk.js";
import { SkillLibrary } from "./skills.js";
import { LibraryCatalogFile } from "../library-catalog.js";
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
let cards: LibraryCatalogFile | undefined;

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
let apply: "direct" | "proposal" = "direct";

async function open(file = DILATACION): Promise<void> {
  session = await SongSession.open(
    { songsDir: path.join(root, "Four Hands"), backupsDir: path.join(root, "copias"), untitledName: "Sin título", autosaveDelayMs: 5, now: () => clock },
    file,
  );
  desk = new AiDesk({
    session: () => session,
    banks: () => BANKS,
    plugins: () => [
      { id: "VST3-Kontakt 8-1", name: "Kontakt 8", vendor: "Native Instruments", category: "Instrument|Sampler", format: "VST3", instrument: true },
      { id: "VST3-Ozone 11-2", name: "Ozone 11", vendor: "iZotope", category: "Fx|Mastering", format: "VST3", instrument: false },
    ],
    builtInSounds: () => [
      { program: 52, bankMSB: 0, name: "Choir Aahs", profile: { low: 0, high: 96, attack: 0.01, release: 1.7, sustain: "holds", fade: null } },
      { program: 46, bankMSB: 0, name: "Harp", profile: { low: 0, high: 108, attack: 0, release: 9.6, sustain: "fades", fade: 10.2 } },
    ],
    skills: new SkillLibrary({ builtIn: REPO_SKILLS, user: path.join(root, "Four Hands", "Skills") }),
    libraries: () => (cards ??= new LibraryCatalogFile(path.join(root, "libraries.json"))),
    now: () => clock,
    setTimer: (fn, ms) => {
      const t = { fn, at: clock + ms, done: false };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => ((t as { done: boolean }).done = true),
    onState: (s) => states.push(s),
    tone: () => tone,
    apply: () => apply,
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
  cards = undefined;
  apply = "direct";
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

  it("puts plugins on tracks (fase 2): one sound per track", () => {
    expect(ok("list_instruments")).toMatch(/Kontakt 8 · Native Instruments · Instrument\|Sampler/);
    // An effect plugin is not an instrument: it is listed apart, for add_effect (F2.2 parte C).
    expect(ok("list_instruments").split("Effect plugins")[0]).not.toMatch(/Ozone/);
    const id = begin("Kontakt");
    ok("add_track", { intervention_id: id, name: "Cuerdas Kontakt", sound: "plugin / kontakt" });
    expect(trackByName("Cuerdas Kontakt")).toMatchObject({ output: "plugin", plugin: { id: "VST3-Kontakt 8-1", name: "Kontakt 8" } });
    expect(fail("update_track", { intervention_id: id, track: "Cuerdas Kontakt", sound: "plugin / Ozone 11" })).toMatch(/no instrument plugin 'Ozone 11'/);
    ok("update_track", { intervention_id: id, track: "Cuerdas Kontakt", instrument: "Violines" });
    const back = trackByName("Cuerdas Kontakt");
    expect(back.output).toBeUndefined();
    expect(back.plugin).toBeUndefined();
    expect(back.program).toBe(40);
  });

  it("adds tracks past 15, sharing MIDI channels but never the drums' or the metronome's (A2, 03/11/2026)", () => {
    const id = begin("Orquesta grande");
    for (let i = 0; i < 20; i++) ok("add_track", { intervention_id: id, name: `Atril ${i + 1}`, instrument: "Violines" });
    expect(session.song.trackOrder.length).toBeGreaterThan(16);
    const channels = Array.from({ length: 20 }, (_, i) => trackByName(`Atril ${i + 1}`).channel);
    expect(channels.filter((c) => c === 9 || c === 15)).toEqual([]);
    ok("end_intervention", { intervention_id: id });
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

  it("reverb is a bus and a send, not a track setting (Fran, 04/11/2026)", () => {
    const id = begin("Los violines más lejos");
    expect(fail("set_mix", { intervention_id: id, mix: "t1 rev 35" })).toMatch(/write the track or bus first/);
    ok("add_bus", { intervention_id: id, name: "Reverb", reverb: true });
    const text = ok("set_mix", { intervention_id: id, mix: "t1 send Reverb 35\nt2 vol 70 send Reverb 20" });
    expect(text).toContain("t1 Organo · mix vol 80 pan C send Reverb 35");
    expect(session.song.tracks.t2).toMatchObject({ volume: 0.7, sends: [{ bus: "b1", level: 0.2 }] });
    expect(ok("get_song_overview")).toMatch(/t2 .*mix vol 70 pan C send Reverb 20/);
    ok("end_intervention", { intervention_id: id });
  });

  it("set_tempo_changes and set_key_changes write the maps in one undo step; the overview shows them (H4)", () => {
    const id = begin("Ritardando final y modulación");
    const before = ok("get_song_overview");
    // Dilatación already ends with a ritardando: it shows, and it is what undo brings back.
    expect(before).toContain("Tempo changes: 51.1 66 · 52.1 58");
    const original = structuredClone(session.song.tempoChanges);
    const text = ok("set_tempo_changes", { intervention_id: id, changes: "49.1 rit 60\n52.3 fermata" });
    expect(text).toMatch(/^Tempo changes: 49\.1 rit 60 · 52\.3 30 · 52\.4 60\. The music lasts \d+:\d\d \(was \d+:\d\d\)/);
    expect(session.song.tempoChanges).toHaveLength(3);
    expect(ok("set_key_changes", { intervention_id: id, changes: "Coro C major" })).toContain("Key changes: c. 37 C major");
    expect(fail("set_tempo_changes", { intervention_id: id, changes: "3.1 accel 30" })).toMatch(/Line 1.*accelerando/);
    expect(fail("set_key_changes", { intervention_id: id, changes: "1 C major" })).toMatch(/set_song_properties/);
    const overview = ok("get_song_overview");
    expect(overview).toContain("Tempo changes: 49.1 rit 60 · 52.3 30 · 52.4 60");
    expect(overview).toContain("Key changes: c. 37 C major");
    expect(overview).not.toBe(before);
    ok("end_intervention", { intervention_id: id });
    session.handle({ type: "undo" });
    expect(session.song.tempoChanges).toEqual(original);
    expect("keyChanges" in session.song).toBe(false);
  });

  it("logs which intervention corrects which (H4): notes of an earlier one changed or removed", () => {
    const cello = trackByName("cello").id;
    const first = begin("Contracanto");
    const added = ok("add_notes", { intervention_id: first, track: cello, notes: "C3 1.1 1/4\nD3 1.2 1/4\nE3 1.3 1/4" });
    ok("end_intervention", { intervention_id: first });
    const [a, b] = [...added.matchAll(/\b(n\d+)\b/g)].map((m) => m[1]!);
    expect(logs.find((l) => l.type === "ai_intervention_closed" && l.id === first)).not.toHaveProperty("corrects");
    const second = begin("Limpio el contracanto");
    ok("edit_notes", { intervention_id: second, changes: `${a} B2` });
    ok("delete_notes", { intervention_id: second, note_ids: [b] });
    ok("add_notes", { intervention_id: second, track: cello, notes: "G2 1.4 1/4" });
    ok("end_intervention", { intervention_id: second });
    expect(logs.find((l) => l.type === "ai_intervention_closed" && l.id === second)).toMatchObject({ corrects: [{ id: first, notes: 2 }] });
  });

  it("proposal mode (H4): the intervention leaves the song when it ends, and comes back when the user accepts it", () => {
    apply = "proposal";
    const cello = trackByName("cello").id;
    const before = Object.keys(session.song.notes).length;
    const id = begin("Contracanto");
    ok("add_notes", { intervention_id: id, track: cello, notes: "C3 1.1 1/4\nD3 1.2 1/4" });
    expect(Object.keys(session.song.notes)).toHaveLength(before + 2);
    expect(ok("end_intervention", { intervention_id: id })).toMatch(/it left the song and waits/);
    expect(Object.keys(session.song.notes)).toHaveLength(before);
    expect(session.document.proposals.map((p) => p.id)).toEqual([id]);
    expect(ok("get_user_context")).toMatch(new RegExp(`Changes: as proposals[\\s\\S]*Pending proposals: ${id} "Contracanto"`));
    expect(logs.find((l) => l.type === "ai_intervention_closed" && l.id === id)).toMatchObject({ proposal: true });
    expect(session.handle({ type: "acceptProposal", id, label: "aceptaste la propuesta: Contracanto" }).ok).toBe(true);
    expect(Object.keys(session.song.notes)).toHaveLength(before + 2);
    expect(session.history.at(-1)).toMatchObject({ actor: { by: "user" }, author: { by: "ai", client: "claude-ai" } });
    expect(ok("get_user_context")).not.toMatch(/Pending proposals/);
  });

  it("proposal mode: a discarded proposal never touches the song; a stale one cannot be accepted", () => {
    apply = "proposal";
    const cello = trackByName("cello").id;
    const first = notesOf(session.song, cello)[0]!;
    const id = begin("Más fuerte");
    ok("shape_velocities", { intervention_id: id, range: "all", tracks: [cello], velocity: 110 });
    ok("end_intervention", { intervention_id: id });
    const rev = session.song.revision;
    expect(session.handle({ type: "discardProposal", id }).ok).toBe(true);
    expect(session.song.revision).toBe(rev);
    expect(session.document.proposals).toHaveLength(0);
    // Again, and this time the user edits a note it touches.
    const id2 = begin("Más fuerte otra vez");
    ok("shape_velocities", { intervention_id: id2, range: "all", tracks: [cello], velocity: 110 });
    ok("end_intervention", { intervention_id: id2 });
    session.run("muevo", [{ type: "moveNotes", ids: [first.id], semitones: 1 }]);
    expect(session.document.proposals[0]!.stale).toBe(true);
    expect(session.handle({ type: "acceptProposal", id: id2, label: "x" })).toMatchObject({ ok: false });
  });

  it("set_mix rejects the whole call when a line is wrong", () => {
    const id = begin("Mezcla");
    const revision = session.song.revision;
    expect(fail("set_mix", { intervention_id: id, mix: "t1 vol 65\nt2 vol 140" })).toMatch(/^Line 2 \("t2 vol 140"\): volume goes from 0 to 100\. Nothing was written\.$/);
    expect(fail("set_mix", { intervention_id: id, mix: "t1 solo" })).toMatch(/write the track or bus first/);
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

describe("get_levels (F2.2, 03/11/2026)", () => {
  it("reads the last playback's levels per track, says what is silent and that it is a meter", async () => {
    const { levelsText } = await import("./texts.js");
    const channels = Array.from({ length: 16 }, () => ({ peak: 0, rms: 0, clips: 0 }));
    channels[0] = { peak: 0.5, rms: 0.1, clips: 0 };
    channels[1] = { peak: 1.2, rms: 0.3, clips: 12 };
    const text = levelsText({ channels, master: { peak: 1.2, rms: 0.35, clips: 12 } }, [{ name: "Piano", channel: 0 }, { name: "Cuerdas", channel: 1 }, { name: "Cello", channel: 2 }], Date.UTC(2026, 10, 3, 13, 5));
    expect(text).toContain("- Piano: -6.0 / -20.0");
    expect(text).toContain("- Cuerdas: 1.6 / -10.5, CLIPPING (12 samples over 0 dBFS)");
    expect(text).toContain("Silent in that playback (muted, not playing there, or no notes): Cello.");
    expect(text).toMatch(/meter, not hearing/);
    expect(levelsText(null, [], null)).toMatch(/Ask the user to play/);
  });

  it("says the master's fader and the engine's load, and when the audio was cut (parte B)", async () => {
    const { levelsText } = await import("./texts.js");
    const channels = [{ peak: 0.5, rms: 0.1, clips: 0 }];
    const text = levelsText({ channels, master: { peak: 0.5, rms: 0.1, clips: 0 } }, [{ name: "Piano", channel: 0 }], null, { masterVolume: 0.9, load: { avgLoad: 0.23, maxLoad: 0.4, dropouts: 0 } });
    expect(text).toContain("- Master (after its fader, vol 90): -6.0 / -20.0");
    expect(text).toContain("Engine load: 23 % average, 40 % peak of each audio block's time; no audio cut.");
    const cut = levelsText(null, [], null, { load: { avgLoad: 0.95, maxLoad: 1.3, dropouts: 2 } });
    expect(cut).toMatch(/Ask the user to play/);
    expect(cut).toMatch(/audio was CUT 2 time/);
  });
});

describe("the master fader for the AI (F2.2 parte B)", () => {
  it("set_mix takes a 'master vol' line in the same undo step, and the overview shows the master", () => {
    expect(ok("get_song_overview")).toContain("Master: vol 100 (0 dB)");
    const id = begin("Bajo el máster");
    const text = ok("set_mix", { intervention_id: id, mix: "t1 vol 70\nmaster vol 90" });
    expect(text).toContain("Master · vol 90");
    expect(session.song.masterVolume).toBe(0.9);
    expect(session.song.tracks.t1!.volume).toBe(0.7);
    expect(ok("get_song_overview")).toContain("Master: vol 90");
    expect(fail("set_mix", { intervention_id: id, mix: "máster pan L20" })).toMatch(/the master only has 'vol'/);
    expect(fail("set_mix", { intervention_id: id, mix: "master vol 120" })).toMatch(/volume goes from 0 to 100/);
    ok("end_intervention", { intervention_id: id });
    session.handle({ type: "undo" });
    expect(session.song.masterVolume).toBeUndefined();
    expect(session.song.tracks.t1!.volume).toBe(0.8);
  });
});

describe("insert effects for the AI (F2.2 parte C)", () => {
  it("adds an own effect with settings, shows it in the overview, and undoes it in one step", () => {
    const id = begin("Limpio el órgano");
    const text = ok("add_effect", { intervention_id: id, track: "t1", effect: "ecualizador", settings: "Low cut: on\nLow cut freq: 120 Hz\nHigh-mid gain: -3 dB" });
    expect(text).toMatch(/Added x1 EQ \(low cut on, low cut freq 120 Hz, high-mid gain −3.0 dB\) to Organo \(t1\)/);
    expect(session.song.tracks.t1!.inserts![0]!.params!.lowCutFreq).toBe(120);
    expect(ok("get_song_overview")).toMatch(/t1 .*effects: x1 EQ \(low cut on/);
    ok("end_intervention", { intervention_id: id });
    session.handle({ type: "undo" });
    expect(session.song.tracks.t1!.inserts).toBeUndefined();
  });

  it("puts a limiter on the Master, adjusts and moves effects, and refuses what does not exist", async () => {
    const aok = async (tool: string, args: Record<string, unknown>) => {
      const r = await desk.callAsync("c1", tool, args);
      if (!r.ok) throw new Error(`${tool} failed: ${r.error}`);
      return r.text;
    };
    const afail = async (tool: string, args: Record<string, unknown>) => {
      const r = await desk.callAsync("c1", tool, args);
      if (r.ok) throw new Error(`${tool} should have failed`);
      return r.error;
    };
    const id = begin("Máster");
    ok("add_effect", { intervention_id: id, track: "master", effect: "limiter" });
    ok("add_effect", { intervention_id: id, track: "master", effect: "compresor", position: 1 });
    expect(session.song.masterInserts!.map((x) => x.kind)).toEqual(["compressor", "limiter"]);
    expect(await aok("set_effect", { intervention_id: id, effect: "x1", settings: "Ceiling: -1.5 dB\nBypass: off" })).toMatch(/Limiter \(ceiling −1.5 dB\)/);
    expect(await aok("set_effect", { intervention_id: id, effect: "x2", settings: "ratio 4:1\nattack 5 ms" })).toMatch(/ratio 4:1, attack 5.0 ms/);
    ok("move_effect", { intervention_id: id, effect: "x2", position: 2 });
    expect(session.song.masterInserts!.map((x) => x.id)).toEqual(["x1", "x2"]);
    expect(ok("get_song_overview")).toMatch(/Master: vol 100 \(0 dB\) · effects: x1 Limiter/);
    expect(await afail("set_effect", { intervention_id: id, effect: "x1", settings: "Ceiling: -30 dB" })).toMatch(/Ceiling goes from −12.0 dB to 0.0 dB/);
    expect(await afail("set_effect", { intervention_id: id, effect: "x1", settings: "Drive: 3" })).toMatch(/has no 'Drive'/);
    expect(fail("add_effect", { intervention_id: id, track: "t1", effect: "Valhalla" })).toMatch(/There is no effect 'Valhalla'/);
    expect(fail("remove_effect", { intervention_id: id, effect: "x9" })).toMatch(/There is no effect x9/);
    ok("remove_effect", { intervention_id: id, effect: "x2" });
    expect(session.song.masterInserts!.map((x) => x.id)).toEqual(["x1"]);
    ok("end_intervention", { intervention_id: id });
  });

  it("names effects, and the overview says the name with what it is (Fran, 04/11/2026)", async () => {
    const id = begin("Tres EQ");
    ok("add_effect", { intervention_id: id, track: "t1", effect: "eq", name: "EQ graves" });
    ok("add_effect", { intervention_id: id, track: "t1", effect: "eq" });
    const r = await desk.callAsync("c1", "set_effect", { intervention_id: id, effect: "x2", settings: "Name: EQ medios\nHigh-mid gain: -2 dB" });
    expect(r.ok && r.text).toMatch(/"EQ medios" \(EQ, high-mid gain −2.0 dB\)/);
    expect(ok("get_song_overview")).toMatch(/effects: x1 "EQ graves" \(EQ, neutral\) → x2 "EQ medios"/);
    ok("end_intervention", { intervention_id: id });
  });

  it("lists an own effect's parameters with their ranges", async () => {
    const id = begin("Compresor");
    ok("add_effect", { intervention_id: id, track: "t2", effect: "compressor" });
    const r = await desk.callAsync("c1", "list_effect_parameters", { effect: "x1" });
    expect(r.ok && r.text).toMatch(/Threshold: −18.0 dB \(−60.0 dB to 0.0 dB\)/);
    const s = await desk.callAsync("c1", "list_effect_parameters", { effect: "x1", search: "att" });
    expect(s.ok && s.text.split("\n").length).toBe(2);
    ok("end_intervention", { intervention_id: id });
  });

  it("adds a plugin effect by name; its parameters go through the engine, into the song for undo", async () => {
    const params = [
      { index: 0, name: "Input Gain", text: "0.0 dB", label: "dB", value: 0.5 },
      { index: 1, name: "Output Ceiling", text: "-0.3 dB", label: "dB", value: 0.97 },
    ];
    const set: Array<[string, number, string]> = [];
    await open();
    (desk as unknown as { options: Record<string, unknown> }).options.effectParams = async () => params;
    (desk as unknown as { options: Record<string, unknown> }).options.setEffectParam = async (id: string, index: number, text: string) => (set.push([id, index, text]), { ok: true, text: "-1.0 dB", value: 0.9 });
    const id = begin("Ozone en el máster");
    expect(ok("add_effect", { intervention_id: id, track: "master", effect: "ozone" })).toMatch(/Added x1 Ozone 11 to the Master/);
    const list = await desk.callAsync("c1", "list_effect_parameters", { effect: "x1", search: "ceiling" });
    expect(list.ok && list.text).toContain("Output Ceiling: -0.3 dB");
    const r = await desk.callAsync("c1", "set_effect", { intervention_id: id, effect: "x1", settings: "Output Ceiling: -1 dB" });
    expect(r.ok && r.text).toMatch(/Output Ceiling: -1.0 dB/);
    expect(set).toEqual([["x1", 1, "-1 dB"]]);
    expect(session.song.masterInserts![0]!.pluginParams).toEqual({ "1": 0.9 });
    expect(session.song.masterInserts![0]!.pluginBase).toEqual({ "1": 0.97 });
    const bad = await desk.callAsync("c1", "set_effect", { intervention_id: id, effect: "x1", settings: "Drive: 3" });
    expect(!bad.ok && bad.error).toMatch(/has no parameter 'Drive'/);
    ok("end_intervention", { intervention_id: id });
    expect(ok("list_instruments")).toMatch(/Effect plugins on this computer[^\n]*\n  Ozone 11 · iZotope/);
  });

  it("says when the engine cannot give a plugin's parameters", async () => {
    const id = begin("Ozone");
    ok("add_effect", { intervention_id: id, track: "t1", effect: "Ozone 11" });
    const r = await desk.callAsync("c1", "list_effect_parameters", { effect: "x1" });
    expect(!r.ok && r.error).toMatch(/engine is not running/);
    ok("end_intervention", { intervention_id: id });
  });
});

describe("buses for the AI (F2.2 parte D)", () => {
  it("a song starts without buses; the overview shows them with what goes into them", () => {
    expect(ok("get_song_overview")).toMatch(/Buses: none yet/);
    const id = begin("Profundidad");
    ok("add_bus", { intervention_id: id, name: "Reverb", reverb: true });
    ok("set_mix", { intervention_id: id, mix: "t1 send Reverb 30" });
    ok("end_intervention", { intervention_id: id });
    const text = ok("get_song_overview");
    expect(text).toMatch(/Buses \(/);
    expect(text).toMatch(/b1 Reverb · vol 100 pan C · effects: x1 Reverb \(neutral\) · sends from Organo/);
  });

  it("add_bus makes a subgroup with its tracks, set_mix routes and sends, one undo step each", () => {
    const id = begin("Subgrupo de cuerdas");
    const made = ok("add_bus", { intervention_id: id, name: "Cuerdas", tracks: ["t3", "t4"] });
    expect(made).toMatch(/^Bus b1 Cuerdas → Master\. Now going into it: Melodia \(cuerdas\), Contramelodia/);
    expect(session.song.tracks.t3!.bus).toBe("b1");
    ok("add_bus", { intervention_id: id, name: "Mix bus" });
    ok("add_bus", { intervention_id: id, name: "Delay", reverb: true });
    const text = ok("set_mix", { intervention_id: id, mix: "Cuerdas vol 85 to Mix bus\nt1 send Delay 25 pre\nt2 to Mix bus send Delay 10" });
    expect(text).toContain("b1 Cuerdas · mix vol 85 pan C → Mix bus");
    expect(text).toContain("t1 Organo · mix vol 80 pan C send Delay 25 pre");
    expect(session.song.buses!.b1!.bus).toBe("b2");
    expect(session.song.tracks.t2).toMatchObject({ bus: "b2", sends: [{ bus: "b3", level: 0.1 }] });
    expect(session.song.buses!.b3!.inserts![0]!.kind).toBe("reverb");
    // Loops and unknown buses are refused, and nothing is written.
    expect(fail("set_mix", { intervention_id: id, mix: "Mix bus to Cuerdas" })).toMatch(/loop/);
    expect(fail("set_mix", { intervention_id: id, mix: "t1 to Nada" })).toMatch(/There is no bus 'Nada'/);
    ok("set_mix", { intervention_id: id, mix: "t1 nosend Delay\nt2 to master" });
    expect("sends" in session.song.tracks.t1!).toBe(false);
    expect("bus" in session.song.tracks.t2!).toBe(false);
    // Effects go on a bus by its name.
    expect(ok("add_effect", { intervention_id: id, track: "Cuerdas", effect: "compressor" })).toMatch(/to the bus Cuerdas \(b1\)/);
    ok("end_intervention", { intervention_id: id });
    session.handle({ type: "undo" });
    expect(session.song.busOrder).toBeUndefined();
    expect("bus" in session.song.tracks.t3!).toBe(false);
  });

  it("remove_bus says what moved where", () => {
    const id = begin("Buses");
    ok("add_bus", { intervention_id: id, name: "Mix bus" });
    ok("add_bus", { intervention_id: id, name: "Voces", tracks: ["t1"], to: "Mix bus" });
    ok("set_mix", { intervention_id: id, mix: "t2 send Voces 40" });
    const text = ok("remove_bus", { intervention_id: id, bus: "Voces" });
    expect(text).toMatch(/Removed the bus Voces \(b2\)\. Organo went through it and now go to Mix bus\. The sends of Piano ostinato to it are gone\./);
    expect(session.song.tracks.t1!.bus).toBe("b1");
    expect(fail("remove_bus", { intervention_id: id, bus: "Voces" })).toMatch(/There is no bus/);
    ok("end_intervention", { intervention_id: id });
  });

  it("get_levels reads the buses too", async () => {
    const { levelsText } = await import("./texts.js");
    const text = levelsText(
      { channels: [{ peak: 0.5, rms: 0.1, clips: 0 }], master: { peak: 0.5, rms: 0.1, clips: 0 }, buses: [{ peak: 0.25, rms: 0.05, clips: 0 }, { peak: 0, rms: 0, clips: 0 }] },
      [{ name: "Piano", channel: 0 }],
      null,
      { buses: [{ name: "Reverb", index: 0 }, { name: "Voces", index: 1 }] },
    );
    expect(text).toContain("- bus Reverb: -12.0 / -26.0");
    expect(text).toContain("Silent in that playback (muted, not playing there, or no notes): bus Voces.");
  });
});

describe("Four Hands' delay for the AI (Fran, 04/11/2026)", () => {
  it("makes a delay return in time with the song and sets its note value in words", async () => {
    const a = async (tool: string, args: Record<string, unknown>) => desk.callAsync("c1", tool, args);
    const id = begin("Eco en la melodía");
    const made = ok("add_bus", { intervention_id: id, name: "Delay", delay: true });
    expect(made).toMatch(/effects: x1 Delay \(neutral\)/);
    ok("set_mix", { intervention_id: id, mix: "t3 send Delay 25" });
    const set = await a("set_effect", { intervention_id: id, effect: "x1", settings: "Note: 1/8 dotted\nFeedback: 45 %\nPing-pong: on" });
    expect(set.ok && set.text).toContain("x1 Delay (note 1/8 dotted, feedback 45 %, ping-pong on)");
    const bad = await a("set_effect", { intervention_id: id, effect: "x1", settings: "Note: 1/7" });
    expect(!bad.ok && bad.error).toMatch(/not a note value\. Use one of: 1\/32, 1\/16 triplet/);
    const list = await a("list_effect_parameters", { effect: "x1" });
    expect(list.ok && list.text).toMatch(/Note: 1\/8 dotted \(1\/32 to 1\/1\)/);
    ok("end_intervention", { intervention_id: id });
  });
});

describe("analyze_mix for the AI (F2.3)", () => {
  it("says to play first, and refuses targets and bars it cannot read", () => {
    expect(ok("analyze_mix")).toMatch(/Nothing measured yet/);
    expect(fail("analyze_mix", { target: "vinilo" })).toMatch(/Unknown target 'vinilo'/);
    expect(fail("analyze_mix", { bars: "por ahí" })).toMatch(/is not bars/);
    expect(fail("analyze_mix", { lufs: -2 })).toMatch(/lufs goes from -40 to -5/);
  });
});

describe("library cards (Fran, 05/11/2026)", () => {
  it("fills a plugin track's card in the user's catalog, links it, shows it in the overview and warns of notes outside its range", () => {
    const id = begin("Ficha de las violas");
    ok("add_track", { intervention_id: id, name: "Violas K", sound: "plugin / kontakt" });
    expect(ok("get_song_overview")).toMatch(/Violas K.*no library card yet \(set_library_card/);
    expect(fail("set_library_card", { intervention_id: id, track: "Violas K", velocity: "weak" })).toMatch(/has no library card yet: give it a 'name'/);
    expect(fail("set_library_card", { intervention_id: id, track: "Violas K", name: "Violas", velocity: "loud" })).toMatch(/start with yes, weak, no or untested/);
    const text = ok("set_library_card", {
      intervention_id: id,
      track: "Violas K",
      name: "Symphonic Strings · Violas",
      velocity: "weak: mostly from v80 up",
      expression: "yes",
      range: "C2-C6",
      keyswitches: "C1 Sustain, C#1 Staccato",
      own_reverb: "off",
      why: "after the dynamics test",
    });
    expect(text).toContain("library card 'Symphonic Strings · Violas': velocity responds weakly (mostly from v80 up); expression CC11 responds; modulation CC1 untested; plays C2–C6: nothing outside");
    expect(text).toContain("Linked to the track (one undo step)");
    const track = trackByName("Violas K");
    expect(track.library?.name).toBe("Symphonic Strings · Violas");
    const saved = cards!.card(track.library!.id)!;
    expect(saved).toMatchObject({ host: "Kontakt 8", keyswitches: [{ pitch: 24, name: "Sustain" }, { pitch: 25, name: "Staccato" }], updated: { by: "ai", why: "after the dynamics test" } });
    expect(ok("get_song_overview")).toMatch(/Violas K.*plays through the plugin Kontakt 8 \(hosted by Four Hands\) · library card 'Symphonic Strings · Violas'/);
    // Only what is passed changes; it is not linked again.
    const second = ok("set_library_card", { intervention_id: id, track: "Violas K", modulation: "no" });
    expect(second).toContain("modulation CC1 does not respond");
    expect(second).not.toContain("Linked");
    expect(cards!.card(track.library!.id)!.velocity.state).toBe("weak");
    // Notes outside the range warn; keyswitches do not.
    const added = ok("add_notes", { intervention_id: id, track: "Violas K", notes: "C1 1.1 1/4\nC7 1.2 1/4\nE4 1.3 1/4" });
    expect(added).toMatch(/1 note is outside the range of its library card 'Symphonic Strings · Violas' \(they will not sound\) \(C2–C6\)/);
  });

  it("links an existing card by its name in another track, and refuses tracks without a plugin", () => {
    const id = begin("Fichas");
    ok("add_track", { intervention_id: id, name: "Violas A", sound: "plugin / kontakt" });
    ok("add_track", { intervention_id: id, name: "Violas B", sound: "plugin / kontakt" });
    ok("set_library_card", { intervention_id: id, track: "Violas A", name: "Symphonic Strings · Violas", expression: "yes" });
    expect(fail("set_library_card", { intervention_id: id, track: "Violas B", use: "Cellos" })).toMatch(/No card called 'Cellos'.*'Symphonic Strings · Violas'/);
    expect(ok("set_library_card", { intervention_id: id, track: "Violas B", use: "symphonic strings · violas" })).toContain("Linked to the track");
    expect(trackByName("Violas B").library).toEqual(trackByName("Violas A").library);
    expect(cards!.read().cards).toHaveLength(1);
    expect(fail("set_library_card", { intervention_id: id, track: orderedTracks(session.song)[0]!.name, name: "x" })).toMatch(/does not sound through a plugin/);
  });
});
