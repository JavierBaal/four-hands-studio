// Prueba de permisos S1: herramientas de lectura, intervención y escritura con datos de prueba.
// No compone ni guarda nada: solo responde como lo haría la app, para contar los avisos de permiso
// de Claude Desktop con ocho herramientas (PRUEBA_S1.md).

import { SONG, parseRange, resolveTracks } from "./song.mjs";

const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const OCTAVE = { organ: 3, piano: 4, strings: 5, cello: 3, contrabass: 2, "cinematic drums (timpani)": 2 };

const state = {
  revision: 1,
  added: [], // { id, track, line, bar, intervention }
  deleted: new Set(),
  intervention: null, // { id, description, base, changes, timer }
  proposals: [],
  noteSeq: 2000,
  intSeq: 0,
};

const AUTO_CLOSE_MS = 5 * 60 * 1000;

function rootPitch(chord, octave) {
  const m = /^([A-G](?:#|b)?)/.exec(chord);
  return `${m ? m[1] : "A"}${octave}`;
}

// Una nota redonda por compás y pista: la fundamental del acorde. Identificadores estables.
function testNotes(track, from, to) {
  const ti = SONG.tracks.indexOf(track) + 1;
  const out = [];
  for (let b = from; b <= to; b++) {
    const id = `n${ti}${String(b).padStart(2, "0")}`;
    if (state.deleted.has(id)) continue;
    out.push({ id, bar: b, line: `${id} ${rootPitch(SONG.harmony[b - 1], OCTAVE[track.instrument] ?? 4)} ${b}.1 1/1 v70 @ai` });
  }
  return out;
}

export function userContext() {
  return [
    `Four Hands · r${state.revision} · user context (TEST DATA)`,
    `Selection: bars 17-20 · Melodía (cuerdas) (t3) · 16 notes`,
    `Loop: 17-20 (on) · Cursor: 17.1 · Active track: t3 · Visible: bars 13-28`,
    `View: note names C D E, middle C = C4, degrees off · Aids: harmony on, scale on`,
    `Mode: the user reviews proposals (your changes become a proposal they accept or discard)`,
    state.intervention ? `Open intervention: ${state.intervention.id} "${state.intervention.description}"` : `Open intervention: none`,
  ].join("\n");
}

export function readNotes(args) {
  const r = parseRange(args.range === "selection" || args.range === "loop" ? "17-20" : args.range || "");
  if (!r.ok) return r;
  const tr = resolveTracks(args.tracks);
  if (!tr.ok) return tr;
  const tracks = tr.tracks.length ? tr.tracks : SONG.tracks;
  const L = [`Four Hands · r${state.revision} · bars ${r.from}-${r.to} (TEST DATA: one root note per bar)`];
  let count = 0;
  for (const t of tracks) {
    L.push(`${t.name} (${t.id})`);
    const notes = testNotes(t, r.from, r.to).concat(
      state.added.filter((n) => n.track === t.id && n.bar >= r.from && n.bar <= r.to && !state.deleted.has(n.id)),
    );
    for (let b = r.from; b <= r.to; b++) {
      const inBar = notes.filter((n) => n.bar === b);
      if (!inBar.length) continue;
      L.push(`c${b} · ${SONG.harmony[b - 1]}`);
      for (const n of inBar) L.push(n.line);
      count += inBar.length;
    }
  }
  L.push(`${count} notes · page 1 of 1`);
  return { ok: true, text: L.join("\n") };
}

function touch(id) {
  const iv = state.intervention;
  if (!iv || iv.id !== id) {
    const last = state.proposals.find((p) => p.intervention === id);
    if (last) return { ok: false, error: `Intervention ${id} is already closed${last.auto ? " (5 minutes without calls)" : ""} and is proposal ${last.id}. Start another with begin_intervention.` };
    return { ok: false, error: `There is no open intervention ${id}. Start one with begin_intervention.` };
  }
  clearTimeout(iv.timer);
  iv.timer = setTimeout(() => close(true), AUTO_CLOSE_MS);
  return { ok: true, iv };
}

function close(auto = false) {
  const iv = state.intervention;
  if (!iv) return null;
  clearTimeout(iv.timer);
  state.intervention = null;
  const p = { id: `p${state.proposals.length + 1}`, intervention: iv.id, description: iv.description, changes: iv.changes, auto };
  state.proposals.push(p);
  return p;
}

export function beginIntervention(args) {
  if (!args.description || !String(args.description).trim()) return { ok: false, error: "begin_intervention needs a short description for the user." };
  if (state.intervention) return { ok: false, error: `Intervention ${state.intervention.id} is still open. Close it with end_intervention first.` };
  const id = `i${++state.intSeq}`;
  state.intervention = { id, description: String(args.description).trim(), base: args.base_revision || `r${state.revision}`, changes: 0, timer: null };
  state.intervention.timer = setTimeout(() => close(true), AUTO_CLOSE_MS);
  return { ok: true, text: `Intervention ${id} open: "${state.intervention.description}" (base ${state.intervention.base}). Mode: the user reviews proposals. Close it with end_intervention.` };
}

const LINE = /^([A-G](?:#|b)?-?\d)\s+((\d+)\.\d+(?:\+\d+\/\d+)?)\s+(\d+\/\d+\.?t?(?:\+\d+\/\d+\.?t?)*)(?:\s+v(\d{1,3}))?((?:\s+~s[+-]\d+(?:\.\d+)?)?(?:\s+~d[+-]\d+(?:\.\d+)?)?)$/;

export function addNotes(args) {
  const t = touch(args.intervention_id);
  if (!t.ok) return t;
  const tr = resolveTracks([args.track || ""]);
  if (!tr.ok) return tr;
  const track = tr.tracks[0];
  const lines = String(args.notes || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { ok: false, error: "No notes: write one note per line, e.g. 'E5 17.1 1/4 v72'." };
  const parsed = [];
  for (const [i, l] of lines.entries()) {
    const m = LINE.exec(l);
    if (!m) return { ok: false, error: `Line ${i + 1} "${l}" is not a note I understand (expected e.g. 'E5 17.1 1/4 v72'). Nothing was written.` };
    const bar = +m[3];
    if (bar < 1 || bar > SONG.bars) return { ok: false, error: `Line ${i + 1}: bar ${bar} does not exist (the song has ${SONG.bars} bars). Nothing was written.` };
    if (m[5] && (+m[5] < 1 || +m[5] > 127)) return { ok: false, error: `Line ${i + 1}: velocity must be v1-v127. Nothing was written.` };
    // Mismo orden que la lectura: id altura posición duración velocidad autor [desviación].
    parsed.push({ bar, l: `${m[1]} ${m[2]} ${m[4]} v${m[5] || 80} @ai${m[6] || ""}` });
  }
  const ids = [];
  for (const p of parsed) {
    const id = `n${++state.noteSeq}`;
    state.added.push({ id, track: track.id, bar: p.bar, line: `${id} ${p.l}`, intervention: t.iv.id });
    ids.push(id);
  }
  t.iv.changes += ids.length;
  state.revision++;
  return { ok: true, text: `Added ${ids.length} note${ids.length === 1 ? "" : "s"} to ${track.name} (${track.id}): ${ids.join(" ")} · r${state.revision}`, summary: { track: track.name, count: ids.length } };
}

export function deleteNotes(args) {
  const t = touch(args.intervention_id);
  if (!t.ok) return t;
  const ids = (args.note_ids || []).map(String);
  const known = new Set(state.added.map((n) => n.id));
  for (const id of ids) {
    if (!known.has(id) && !/^n[1-6]\d{2}$/.test(id)) return { ok: false, error: `There is no note ${id}. Read the notes again with read_notes. Nothing was deleted.` };
    if (state.deleted.has(id)) return { ok: false, error: `Note ${id} was already deleted. Nothing was deleted.` };
  }
  for (const id of ids) state.deleted.add(id);
  t.iv.changes += ids.length;
  state.revision++;
  return { ok: true, text: `Deleted ${ids.length} note${ids.length === 1 ? "" : "s"}: ${ids.join(" ")} · r${state.revision}`, summary: { count: ids.length } };
}

export function endIntervention(args) {
  const t = touch(args.intervention_id);
  if (!t.ok) return t;
  const p = close(false);
  return { ok: true, text: `Intervention ${p.intervention} closed. It is now proposal ${p.id} ("${p.description}", ${p.changes} changes): the user will accept or discard it in the app. One undo step.` };
}

export const S1_TOOLS = ["get_song_overview", "get_user_context", "read_notes", "point_to", "begin_intervention", "add_notes", "delete_notes", "end_intervention"];
