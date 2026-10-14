import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PPQ, USER, barStart, formatNotes, notesOf, orderedTracks } from "@fourhands/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AiState, SoundBankInfo } from "../../shared/protocol.js";
import { SongSession } from "../session.js";
import { AiDesk, type ToolReply } from "./desk.js";

const DILATACION = path.resolve(__dirname, "../../../../core/test-data/Dilatacion.mid");

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
      { program: 12, bankMSB: 0, name: "Cello Sustain" },
    ],
  },
];

async function open(file = DILATACION): Promise<void> {
  session = await SongSession.open(
    { songsDir: path.join(root, "Four Hands"), backupsDir: path.join(root, "copias"), untitledName: "Sin título", autosaveDelayMs: 5, now: () => clock },
    file,
  );
  desk = new AiDesk({
    session: () => session,
    banks: () => BANKS,
    now: () => clock,
    setTimer: (fn, ms) => {
      const t = { fn, at: clock + ms, done: false };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => ((t as { done: boolean }).done = true),
    onState: (s) => states.push(s),
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
