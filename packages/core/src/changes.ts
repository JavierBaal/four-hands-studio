/**
 * What changed between two versions of the song (ESQUEMA_MCP.md, 4: get_changes_since), for the AI
 * when it comes back to the conversation: the signed history in between, then the differences
 * grouped by kind (notes per track, harmony, form, song, tracks, annotations). Pure: the app keeps
 * the earlier version and passes both.
 */
import type { HistoryEntry } from "./document.js";
import { type Authorship, type Note, type Song, bpm, orderedSections, orderedTracks } from "./model.js";
import { barHarmony, formatNote } from "./compact.js";
import { barsOf, keyText, songBars } from "./notation.js";

export interface ChangesOptions {
  /** How the AI asked for it: "since your last call", "since r120". */
  since: string;
  /** History entries after `before.revision`, oldest first. */
  history: readonly HistoryEntry[];
  /** "Claude" for "claude-ai": the name the user reads. */
  aiName?: (client: string) => string;
  /** Every note is listed when the notes changed are at most this many. */
  detailLimit?: number;
}

const DETAIL_LIMIT = 40;
const HISTORY_LIMIT = 30;

function who(a: Authorship, aiName: (client: string) => string): string {
  return a.by === "user" ? "user" : `${aiName(a.client)} (${a.client})`;
}

export function historyLine(h: HistoryEntry, aiName: (client: string) => string = (c) => c): string {
  const what = h.kind === "undo" ? `undid: ${h.label}` : h.kind === "redo" ? `redid: ${h.label}` : h.label;
  return `r${h.revision} ${who(h.actor, aiName)} · ${what}`;
}

/** The parts of a note that make it sound different (its author does not). */
function noteDiff(a: Note, b: Note): string[] {
  const d: string[] = [];
  if (a.trackId !== b.trackId) d.push("track");
  if (a.pitch !== b.pitch) d.push("pitch");
  if (a.start !== b.start) d.push("timing");
  if (a.duration !== b.duration) d.push("length");
  if (a.velocity !== b.velocity) d.push("velocity");
  return d;
}

function span(song: Song, notes: readonly Note[]): string {
  const start = Math.min(...notes.map((n) => n.start));
  const end = Math.max(...notes.map((n) => n.start + 1));
  return barsOf(song.meter, start, end);
}

function authorsOf(notes: readonly Note[]): string {
  const user = notes.filter((n) => n.shapedBy.by === "user").length;
  if (user === notes.length) return "user";
  if (user === 0) return "AI";
  return `user ${user}, AI ${notes.length - user}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function changesText(before: Song, after: Song, options: ChangesOptions): string {
  const aiName = options.aiName ?? ((c: string) => c);
  const lines = [`Four Hands · changes r${before.revision} → r${after.revision} (${options.since})`];
  if (before.revision === after.revision) {
    lines.push("Nothing changed.");
    return lines.join("\n");
  }

  const history = options.history;
  if (history.length) {
    lines.push("", `History (oldest first${history.length > HISTORY_LIMIT ? `, last ${HISTORY_LIMIT} of ${history.length}` : ""}):`);
    for (const h of history.slice(-HISTORY_LIMIT)) lines.push(`  ${historyLine(h, aiName)}`);
  }

  // Notes, per track.
  const added: Note[] = [];
  const removed: Note[] = [];
  const changed: { a: Note; b: Note; what: string[] }[] = [];
  for (const b of Object.values(after.notes)) {
    const a = before.notes[b.id];
    if (!a) added.push(b);
    else {
      const what = noteDiff(a, b);
      if (what.length) changed.push({ a, b, what });
    }
  }
  for (const a of Object.values(before.notes)) if (!after.notes[a.id]) removed.push(a);
  const total = added.length + removed.length + changed.length;
  if (total) {
    lines.push("", `Notes: ${added.length} added, ${changed.length} changed, ${removed.length} removed`);
    const trackIds = [...new Set([...added, ...removed, ...changed.map((c) => c.b)].map((n) => n.trackId))];
    const order = new Map([...after.trackOrder, ...before.trackOrder].map((id, i) => [id, i]));
    trackIds.sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0));
    for (const id of trackIds) {
      const name = after.tracks[id]?.name ?? before.tracks[id]?.name ?? id;
      const parts: string[] = [];
      const ad = added.filter((n) => n.trackId === id);
      const ch = changed.filter((c) => c.b.trackId === id);
      const rm = removed.filter((n) => n.trackId === id);
      if (ad.length) parts.push(`${ad.length} added ${span(after, ad)} (${authorsOf(ad)})`);
      if (ch.length) {
        const kinds = [...new Set(ch.flatMap((c) => c.what))].join(", ");
        parts.push(`${ch.length} changed ${span(after, ch.map((c) => c.b))} (${kinds}; ${authorsOf(ch.map((c) => c.b))})`);
      }
      if (rm.length) parts.push(`${rm.length} removed ${span(before, rm)}`);
      lines.push(`  ${name} (${id}): ${parts.join(" · ")}`);
    }
    if (total <= (options.detailLimit ?? DETAIL_LIMIT)) {
      const byStart = (x: Note, y: Note) => x.start - y.start || x.pitch - y.pitch;
      for (const n of [...added].sort(byStart)) lines.push(`  + ${formatNote(after, n)}`);
      for (const c of [...changed].sort((x, y) => byStart(x.b, y.b))) lines.push(`  ~ ${formatNote(before, c.a)} → ${formatNote(after, c.b).replace(/^n\d+ /, "")}`);
      for (const n of [...removed].sort(byStart)) lines.push(`  - ${formatNote(before, n)}`);
    } else {
      lines.push("  Too many to list: read the bars you need with read_notes.");
    }
  }

  // Harmony, bar by bar.
  const bars = Math.max(songBars(before), songBars(after));
  const chordLines: string[] = [];
  for (let bar = 1; bar <= bars; bar++) {
    const x = barHarmony(before, bar);
    const y = barHarmony(after, bar);
    if (x !== y) chordLines.push(`  c${bar}: ${x || "—"} → ${y || "—"}`);
  }
  if (chordLines.length) {
    lines.push("", `Harmony: ${plural(chordLines.length, "bar")} changed`);
    lines.push(...chordLines.slice(0, 16));
    if (chordLines.length > 16) lines.push(`  …and ${chordLines.length - 16} more: see get_song_overview.`);
  }

  // Form.
  const formLines: string[] = [];
  const secText = (s: { name: string; startBar: number; endBar: number }) => `${s.name} c. ${s.startBar}–${s.endBar}`;
  for (const s of orderedSections(after)) {
    const old = before.sections[s.id];
    if (!old) formLines.push(`  + ${secText(s)}`);
    else if (secText(old) !== secText(s)) formLines.push(`  ~ ${secText(old)} → ${secText(s)}`);
  }
  for (const s of orderedSections(before)) if (!after.sections[s.id]) formLines.push(`  - ${secText(s)}`);
  if (formLines.length) lines.push("", "Form:", ...formLines);

  // The song itself.
  const songLines: string[] = [];
  if (before.title !== after.title) songLines.push(`  title: ${before.title} → ${after.title}`);
  if (before.tempo !== after.tempo) songLines.push(`  tempo: ${Math.round(bpm(before) * 100) / 100} → ${Math.round(bpm(after) * 100) / 100} BPM`);
  if (before.meter.numerator !== after.meter.numerator || before.meter.denominator !== after.meter.denominator)
    songLines.push(`  meter: ${before.meter.numerator}/${before.meter.denominator} → ${after.meter.numerator}/${after.meter.denominator}`);
  if (keyText(before.key) !== keyText(after.key)) songLines.push(`  key: ${keyText(before.key)} → ${keyText(after.key)}`);
  if ((before.concept?.text ?? "") !== (after.concept?.text ?? ""))
    songLines.push(after.concept ? `  concept (${who(after.concept.author, aiName)}): ${after.concept.text}` : "  concept removed");
  if (songLines.length) lines.push("", "Song:", ...songLines);

  // Tracks.
  const trackLines: string[] = [];
  for (const t of orderedTracks(after)) {
    const old = before.tracks[t.id];
    if (!old) {
      trackLines.push(`  + ${t.name} (${t.id})`);
      continue;
    }
    const d: string[] = [];
    if (old.name !== t.name) d.push(`renamed from ${old.name}`);
    if (old.program !== t.program || old.sound?.name !== t.sound?.name) d.push(`sound ${t.sound ? `"${t.sound.name}"` : `program ${t.program}`}`);
    if (old.volume !== t.volume) d.push(`vol ${Math.round(old.volume * 100)} → ${Math.round(t.volume * 100)}`);
    if (old.pan !== t.pan) d.push(`pan ${Math.round(old.pan * 100)} → ${Math.round(t.pan * 100)}`);
    if (old.mute !== t.mute) d.push(t.mute ? "muted" : "unmuted");
    if (JSON.stringify(old.pedal) !== JSON.stringify(t.pedal)) d.push("pedal rewritten");
    if (d.length) trackLines.push(`  ${t.name} (${t.id}): ${d.join(", ")}`);
  }
  for (const t of orderedTracks(before)) if (!after.tracks[t.id]) trackLines.push(`  - ${t.name} (${t.id})`);
  const kept = after.trackOrder.filter((id) => before.tracks[id]);
  const keptBefore = before.trackOrder.filter((id) => after.tracks[id]);
  if (kept.join() !== keptBefore.join()) trackLines.push(`  order: ${orderedTracks(after).map((t) => t.name).join(", ")}`);
  if (trackLines.length) lines.push("", "Tracks:", ...trackLines);

  // Annotations.
  const annLines: string[] = [];
  const annText = (song: Song, a: Song["annotations"][string]) => `"${a.text}" ${barsOf(song.meter, a.start, a.end)} (${who(a.author, aiName)})`;
  for (const a of Object.values(after.annotations)) {
    const old = before.annotations[a.id];
    if (!old) annLines.push(`  + ${annText(after, a)}`);
    else if (old.text !== a.text || old.start !== a.start || old.end !== a.end) annLines.push(`  ~ ${annText(before, old)} → ${annText(after, a)}`);
  }
  for (const a of Object.values(before.annotations)) if (!after.annotations[a.id]) annLines.push(`  - ${annText(before, a)}`);
  if (annLines.length) lines.push("", "Annotations:", ...annLines);

  if (lines.length === 1) lines.push("Only the history changed (an undo and its redo, or nothing audible).");
  return lines.join("\n");
}

