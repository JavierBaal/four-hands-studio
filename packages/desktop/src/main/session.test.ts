import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exportMidi, importMidi, parseSongFile } from "@fourhands/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FileState, PatchMessage } from "../shared/protocol.js";
import { backup, uniquePath, writeAtomic } from "./files.js";
import { SongSession, type SessionOptions } from "./session.js";

const DILATACION = path.resolve(__dirname, "../../../core/test-data/Dilatacion.mid");
const PPQ = 960;

let root: string;
let clock: number;
let patches: PatchMessage[];
let files: FileState[];
let reloads: number;

function options(extra: Partial<SessionOptions> = {}): SessionOptions {
  return {
    songsDir: path.join(root, "Four Hands"),
    backupsDir: path.join(root, "data", "copias"),
    untitledName: "Sin título",
    autosaveDelayMs: 20,
    now: () => clock,
    onPatch: (m) => patches.push(m),
    onFile: (s) => files.push(s),
    onReload: () => reloads++,
    ...extra,
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fh-session-"));
  clock = 1_000_000;
  patches = [];
  files = [];
  reloads = 0;
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("files", () => {
  it("write atomically and leave no temporary files", async () => {
    const f = path.join(root, "a", "song.fourhands");
    await writeAtomic(f, "one");
    await writeAtomic(f, "two");
    expect(fs.readFileSync(f, "utf8")).toBe("two");
    expect(fs.readdirSync(path.dirname(f))).toEqual(["song.fourhands"]);
  });

  it("keep only the newest backups", async () => {
    const f = path.join(root, "song.fourhands");
    fs.writeFileSync(f, "x");
    const dir = path.join(root, "copias");
    for (let i = 0; i < 4; i++) await backup(f, dir, Date.UTC(2026, 9, 13, 10, 0, i), 3);
    expect(fs.readdirSync(dir)).toHaveLength(3);
    expect(await backup(path.join(root, "missing.fourhands"), dir, 0)).toBeNull();
  });

  it("never overwrite an existing song when naming a new one", () => {
    fs.writeFileSync(path.join(root, "Sin título.fourhands"), "");
    fs.writeFileSync(path.join(root, "Sin título 2.fourhands"), "");
    expect(path.basename(uniquePath(root, "Sin título", ".fourhands"))).toBe("Sin título 3.fourhands");
    expect(path.basename(uniquePath(root, 'a/b:c*"d', ".fourhands"))).toBe("abcd.fourhands");
  });
});

describe("SongSession", () => {
  it("creates a new song already on disk, in Documents/Four Hands", async () => {
    const s = await SongSession.createNew(options());
    expect(s.path).toBe(path.join(root, "Four Hands", "Sin título.fourhands"));
    const saved = parseSongFile(fs.readFileSync(s.path, "utf8")).song;
    expect(saved.title).toBe("Sin título");
    expect(saved.tracks.t1).toMatchObject({ name: "Piano", program: 0 });
    expect(saved.context.activeTrackId).toBe("t1");
    expect(files.at(-1)).toMatchObject({ name: "Sin título", dirty: false, savedAt: clock, error: null });
    s.dispose();
  });

  it("imports a MIDI file into a new song and keeps it identical", async () => {
    const s = await SongSession.open(options(), DILATACION);
    expect(path.basename(s.path)).toBe("Dilatacion.fourhands");
    expect(Object.keys(s.song.notes)).toHaveLength(1024);
    const reopened = parseSongFile(fs.readFileSync(s.path, "utf8")).song;
    expect(Buffer.from(exportMidi(reopened)).equals(fs.readFileSync(DILATACION))).toBe(true);
    s.dispose();
  });

  it("runs the window's commands as one undo step and sends patches with the new history", async () => {
    const s = await SongSession.open(options(), DILATACION);
    const reply = s.handle({
      type: "run",
      label: "Mover dos notas",
      commands: [
        { type: "moveNotes", ids: ["n1"], semitones: 1 },
        { type: "moveNotes", ids: ["n2"], semitones: 1 },
      ],
    });
    expect(reply).toEqual({ ok: true, results: [null, null] });
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ canUndo: true, undoLabel: "Mover dos notas", history: [{ kind: "edit", label: "Mover dos notas" }] });
    s.handle({ type: "undo" });
    expect(s.song.notes.n1!.pitch).toBe(45);
    expect(patches.at(-1)).toMatchObject({ canUndo: false, canRedo: true, redoLabel: "Mover dos notas" });
    s.dispose();
  });

  it("answers errors without changing the song", async () => {
    const s = await SongSession.createNew(options());
    const reply = s.handle({ type: "run", label: "x", commands: [{ type: "addNotes", trackId: "t9", notes: [] }] });
    expect(reply).toEqual({ ok: false, error: "Unknown track: t9" });
    expect(patches).toHaveLength(0);
    s.dispose();
  });

  it("autosaves shortly after the last change, and marks the song dirty meanwhile", async () => {
    const s = await SongSession.createNew(options());
    s.run("Pista", [{ type: "addTrack", spec: { name: "Chelo" } }]);
    expect(files.at(-1)).toMatchObject({ dirty: true });
    s.run("Nota", [{ type: "addNotes", trackId: "t1", notes: [{ pitch: 60, start: 0, duration: PPQ, velocity: 80 }] }]);
    expect(Object.keys(parseSongFile(fs.readFileSync(s.path, "utf8")).song.notes)).toHaveLength(0);
    await wait(60);
    const saved = parseSongFile(fs.readFileSync(s.path, "utf8"));
    expect(Object.keys(saved.song.notes)).toEqual(["n1"]);
    expect(saved.history.map((h) => h.label)).toEqual(["Pista", "Nota"]);
    expect(files.at(-1)).toMatchObject({ dirty: false, error: null });
    s.dispose();
  });

  it("does not consider moving the cursor a change to save", async () => {
    const s = await SongSession.createNew(options());
    s.handle({ type: "setContext", changes: { cursor: 4 * PPQ } });
    expect(s.fileState().dirty).toBe(false);
    expect(patches).toHaveLength(1);
    s.dispose();
  });

  it("flushes pending changes before quitting", async () => {
    const s = await SongSession.createNew(options({ autosaveDelayMs: 60_000 }));
    s.run("Pista", [{ type: "addTrack", spec: { name: "Piano" } }]);
    await s.flush();
    expect(parseSongFile(fs.readFileSync(s.path, "utf8")).song.trackOrder).toEqual(["t1", "t2"]);
    s.dispose();
  });

  it("keeps a backup of the previous version, at most every few minutes", async () => {
    const s = await SongSession.open(options({ backupEveryMs: 1000 }), DILATACION);
    const copies = () => (fs.existsSync(path.join(root, "data", "copias")) ? fs.readdirSync(path.join(root, "data", "copias")) : []);
    expect(copies()).toHaveLength(0); // nothing to back up before the first save
    clock += 2000;
    s.run("a", [{ type: "moveNotes", ids: ["n1"], semitones: 1 }]);
    await s.flush();
    expect(copies()).toHaveLength(1);
    clock += 500;
    s.run("b", [{ type: "moveNotes", ids: ["n1"], semitones: 1 }]);
    await s.flush();
    expect(copies()).toHaveLength(1);
    s.dispose();
  });

  it("saves as a new file and keeps autosaving there", async () => {
    const s = await SongSession.createNew(options());
    const target = path.join(root, "mis canciones", "Nocturno");
    await s.saveAs(target);
    expect(s.path).toBe(`${target}.fourhands`);
    s.run("Pista", [{ type: "addTrack", spec: { name: "Chelo" } }]);
    await s.flush();
    expect(parseSongFile(fs.readFileSync(s.path, "utf8")).song.trackOrder).toEqual(["t1", "t2"]);
    s.dispose();
  });

  it("reports a failed save instead of losing the change silently", async () => {
    const s = await SongSession.createNew(options());
    fs.rmSync(s.path);
    fs.mkdirSync(s.path); // a folder where the song should be: the rename fails
    s.run("Pista", [{ type: "addTrack", spec: { name: "Piano" } }]);
    await s.flush();
    expect(files.at(-1)!.error).toBeTruthy();
    expect(files.at(-1)!.dirty).toBe(true);
    s.dispose();
  });

  it("opens a saved song with its history and exports MIDI", async () => {
    const first = await SongSession.open(options(), DILATACION);
    first.run("Editar", [{ type: "updateNotes", changes: [{ id: "n1", velocity: 99 }] }]);
    await first.flush();
    first.dispose();
    const s = await SongSession.open(options(), first.path);
    expect(s.history.map((h) => h.label)).toEqual(["Editar"]);
    expect(s.snapshot()).toMatchObject({ canUndo: false, file: { name: "Dilatacion", dirty: false } });
    const midi = path.join(root, "out.mid");
    await s.exportMidi(midi);
    expect(importMidi(fs.readFileSync(midi)).song.notes.n1!.velocity).toBe(99);
    s.dispose();
  });

  it("loads another song in place and tells the window to reload", async () => {
    const s = await SongSession.createNew(options());
    await s.load(DILATACION);
    expect(reloads).toBe(1);
    expect(path.basename(s.path)).toBe("Dilatacion.fourhands");
    s.run("x", [{ type: "moveNotes", ids: ["n3"], ticks: PPQ }]);
    expect(patches.at(-1)!.history[0]!.label).toBe("x");
    await s.newSong();
    expect(path.basename(s.path)).toBe("Sin título 2.fourhands");
    expect(reloads).toBe(2);
    s.dispose();
  });

  it("refuses to open a damaged song and keeps the current one", async () => {
    const s = await SongSession.createNew(options());
    const bad = path.join(root, "roto.fourhands");
    fs.writeFileSync(bad, '{"format":"fourhands","version":1,"song":{}}');
    await expect(s.load(bad)).rejects.toThrow(/damaged/);
    expect(path.basename(s.path)).toBe("Sin título.fourhands");
    s.dispose();
  });
});
