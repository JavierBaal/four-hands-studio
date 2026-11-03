/**
 * What the AI reads (ESQUEMA_MCP.md, 4): the overview, the user's context and the instruments,
 * as compact text in English. Pure functions of the song, so they are tested without the app.
 * Notes themselves are formatted by the core (compact.ts).
 */
import { type EngineLevels, type EngineLoad, levelsReport } from "../../shared/mix.js";
import { trackColorId } from "../../shared/track-colors.js";
import {
  type Song,
  type Track,
  barAt,
  barHarmony,
  barStart,
  bpm,
  formatPosition,
  keyChangesText,
  keyText,
  notesOf,
  orderedSections,
  orderedTracks,
  pitchName,
  secondsAt,
  songBars,
  tempoChangesText,
} from "@fourhands/core";
import { GM_NOTES, PALETTE, type PaletteItem, instrumentName } from "../../shared/instruments.js";
import type { BankPreset, SoundProfile } from "../../shared/soundbank-info.js";
import type { EnginePlugin } from "../../shared/engine.js";
import type { AiApply, AiTone, SoundBankInfo } from "../../shared/protocol.js";

/** What the window tells the main process about what the user sees (not part of the song). */
export interface WindowInfo {
  noteNames: "solfege" | "letters";
  /** The authorship layer: the AI's notes shown in their own colour. */
  authorship: boolean;
  /** Ticks shown in the piano roll. */
  visible: { start: number; end: number } | null;
}

export const DEFAULT_WINDOW: WindowInfo = { noteNames: "letters", authorship: true, visible: null };

export function paletteItem(program: number | null): PaletteItem | undefined {
  for (const group of PALETTE) for (const item of group.items) if (item.program === program) return item;
  return undefined;
}

function rangeText(range: [number, number] | undefined): string {
  return range ? `${pitchName(range[0])}–${pitchName(range[1])}` : "";
}

export function trackInstrument(track: Track): string {
  const base = `${instrumentName(track.program, track.channel, "en")}${track.program !== null && track.channel !== 9 ? ` (program ${track.program})` : ""}`;
  return track.sound ? `${base}, sound "${track.sound.name}" from ${track.sound.bank}` : base;
}

/** "pan C", "pan L30", "pan R15". */
export function panText(pan: number): string {
  const v = Math.round(pan * 100);
  return v === 0 ? "C" : v < 0 ? `L${-v}` : `R${v}`;
}

/** "mix vol 80 pan L30", "mix vol 80 pan C rev 30" or "mix vol 80 pan C muted" (no reverb: no "rev"). */
export function mixText(track: Track): string {
  const rev = track.reverb ? ` rev ${Math.round(track.reverb * 100)}` : "";
  return `mix vol ${Math.round(track.volume * 100)} pan ${panText(track.pan)}${rev}${track.mute ? " muted" : ""}`;
}

function bars(from: number, to: number): string {
  return from === to ? `c. ${from}` : `c. ${from}–${to}`;
}

function percent(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

export interface OverviewExtras {
  /** Open interventions, for the AI to know whether someone is writing. */
  open: { id: string; who: string; description: string }[];
}

export function overviewText(song: Song, extras: OverviewExtras = { open: [] }): string {
  const total = songBars(song);
  const seconds = Math.round(secondsAt(song, barStart(song.meter, total + 1)));
  const lines = [
    `Four Hands · r${song.revision} · "${song.title}"`,
    `Tempo ${Math.round(bpm(song) * 100) / 100} BPM · ${song.meter.numerator}/${song.meter.denominator} · ${keyText(song.key)} · ${total} bar${total === 1 ? "" : "s"} (about ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")})`,
  ];
  // The concept first: the intention and the limits every change is measured against.
  if (song.concept) lines.push(`Concept (by ${song.concept.author.by === "user" ? "the user" : "an AI"}; reread it before changing anything): ${song.concept.text}`);
  else lines.push("Concept: none yet. For a new piece, write one with set_song_properties concept: the intention in a line, then the limits (duration, tempo, where the sound will go).");
  // H4: tempo and key along the song (set_tempo_changes, set_key_changes).
  const tempoChanges = tempoChangesText(song);
  if (tempoChanges) lines.push(`Tempo changes: ${tempoChanges.split("\n").join(" · ")}`);
  const keyChanges = keyChangesText(song);
  if (keyChanges) lines.push(`Key changes: ${keyChanges.split("\n").join(" · ")}`);
  const sections = orderedSections(song);
  lines.push(sections.length ? `Form: ${sections.map((s) => `${s.id} ${s.name} ${s.startBar}-${s.endBar}`).join(" · ")}` : "Form: no sections yet");

  lines.push("Tracks:");
  const tracks = orderedTracks(song);
  if (tracks.length === 0) lines.push("(no tracks)");
  for (const track of tracks) {
    const notes = notesOf(song, track.id);
    const parts = [`${track.id} ${track.name} · ${trackInstrument(track)}`];
    if (notes.length === 0) parts.push("no notes");
    else {
      const low = Math.min(...notes.map((n) => n.pitch));
      const high = Math.max(...notes.map((n) => n.pitch));
      const ai = notes.filter((n) => n.shapedBy.by === "ai").length;
      const first = barAt(song.meter, notes[0]!.start);
      const last = barAt(song.meter, notes.at(-1)!.start);
      const velocity = Math.round(notes.reduce((sum, n) => sum + n.velocity, 0) / notes.length);
      parts.push(`${notes.length} notes`, bars(first, last), `${pitchName(low, song.key)}–${pitchName(high, song.key)}`, `avg v${velocity}`);
      parts.push(ai === 0 ? "all by the user" : ai === notes.length ? "all by an AI" : `user ${percent(notes.length - ai, notes.length)}% · AI ${percent(ai, notes.length)}%`);
    }
    parts.push(mixText(track), `color ${trackColorId(track.color)}`);
    if (track.solo) parts.push("solo (the user is listening to it alone)");
    if (track.pedal.length) parts.push(`${track.pedal.length} pedal spans`);
    if (track.output === "external") parts.push("sounds outside Four Hands (MIDI out to the user's DAW, e.g. Studio One with Kontakt): the built-in sound and its profile do not apply, ask what instrument plays it");
    if (track.output === "plugin" && track.plugin) parts.push(`plays through the plugin ${track.plugin.name} (hosted by Four Hands): the built-in sound and its profile do not apply, ask what instrument is loaded in it`);
    if (track.curves?.expression?.length) parts.push("expression curve (CC11)");
    if (track.curves?.modulation?.length) parts.push("modulation curve (CC1)");
    lines.push(parts.join(" · "));
  }

  // F2.2 parte B: the master fader, 0-100 like the tracks' volume (100 = 0 dB).
  lines.push(`Master: vol ${Math.round((song.masterVolume ?? 1) * 100)}${(song.masterVolume ?? 1) === 1 ? " (0 dB)" : ""}`);
  if (Object.keys(song.harmony).length === 0) lines.push("Harmony: no chords written yet");
  else {
    lines.push("Harmony (chord of each bar; 'F, 3 G' = F, then G on beat 3):");
    for (let start = 1; start <= total; start += 8) {
      const end = Math.min(total, start + 7);
      const chords: string[] = [];
      for (let b = start; b <= end; b++) chords.push((barHarmony(song, b) || "—").replace(new RegExp(`(^|, )${b}\\.(\\d)`, "g"), "$1$2"));
      lines.push(`${bars(start, end)}: ${chords.join(" | ")}`);
    }
  }

  const annotations = Object.values(song.annotations).sort((a, b) => a.start - b.start);
  if (annotations.length) {
    lines.push("Annotations:");
    for (const a of annotations) {
      const where = bars(barAt(song.meter, a.start), barAt(song.meter, Math.max(a.start, a.end - 1)));
      const on = a.trackIds.length ? ` (${a.trackIds.join(", ")})` : "";
      lines.push(`${a.id} ${where}${on} · ${a.author.by === "user" ? "user" : "AI"}: "${a.text}"`);
    }
  }
  lines.push(extras.open.length ? `Open interventions: ${extras.open.map((i) => `${i.id} by ${i.who} "${i.description}"`).join("; ")}` : "Open interventions: none");
  return lines.join("\n");
}

export interface ContextExtras {
  /** This client's open intervention, if any. */
  mine: { id: string; description: string } | null;
  /** Other AI clients connected. */
  others: string[];
  /** How the user wants opinions given (Tu IA > Opiniones). */
  tone?: AiTone;
  /** Tu IA > Lo que escribe (H4). */
  apply?: AiApply;
  /** Pending proposals (proposal mode). */
  proposals?: { id: string; label: string; stale: boolean }[];
  /** What changed since this AI's last call (null on its first call). */
  changed?: string | null;
}

/**
 * The tone line of get_user_context. Only the delivery changes: the honesty rules of the server
 * instructions and four-hands-basics hold in both.
 */
export function toneText(tone: AiTone): string {
  return tone === "gentle"
    ? "Opinions: with tact (the user's setting). Same diagnosis and every problem still said, with its bars; start with what works and give a bit more context. Never soften what is wrong, only how you say it."
    : "Opinions: direct (the user's setting). Lead with the problem, plainly and briefly, with its bars; say what works when it is true. No cushioning, no flattery.";
}

export function userContextText(song: Song, win: WindowInfo, extras: ContextExtras): string {
  const ctx = song.context;
  const lines = [`Four Hands · r${song.revision} · user context`];
  const selected = ctx.selection.map((id) => song.notes[id]).filter((n) => n !== undefined);
  if (selected.length === 0) lines.push("Selection: nothing selected");
  else {
    const start = Math.min(...selected.map((n) => n.start));
    const end = Math.max(...selected.map((n) => n.start));
    const trackNames = [...new Set(selected.map((n) => n.trackId))].map((id) => `${song.tracks[id]?.name ?? id} (${id})`);
    const ids = selected.length <= 60 ? ` · ${selected.map((n) => n.id).join(" ")}` : "";
    lines.push(`Selection: ${selected.length} note${selected.length === 1 ? "" : "s"} · ${trackNames.join(", ")} · ${bars(barAt(song.meter, start), barAt(song.meter, end))}${ids}`);
    lines.push("  (read them with read_notes, range 'selection')");
  }
  lines.push(ctx.loop ? `Loop: ${bars(barAt(song.meter, ctx.loop.start), barAt(song.meter, Math.max(ctx.loop.start, ctx.loop.end - 1)))} (range 'loop')` : "Loop: none");
  lines.push(`Cursor: ${formatPosition(song.meter, ctx.cursor)}`);
  const active = ctx.activeTrackId ? song.tracks[ctx.activeTrackId] : undefined;
  lines.push(`Active track (open in the piano roll): ${active ? `${active.name} (${active.id})` : "none"}`);
  if (win.visible) {
    lines.push(`Visible in the piano roll: ${bars(barAt(song.meter, win.visible.start), barAt(song.meter, Math.max(win.visible.start, win.visible.end - 1)))}`);
  }
  lines.push(
    win.noteNames === "solfege"
      ? "Note names the user reads: Do Re Mi (Do, Re, Mi, Fa, Sol, La, Si), middle C = Do4. The tools still use C4."
      : "Note names the user reads: C D E, middle C = C4.",
  );
  lines.push(`The AI's notes are ${win.authorship ? "shown in their own colour (blue) next to the user's (amber)" : "shown in the same colour as the user's (authorship layer off)"}.`);
  lines.push("Your changes go straight into the song as you write them; the user sees them live and undoes a whole intervention in one step.");
  lines.push(extras.mine ? `Your open intervention: ${extras.mine.id} "${extras.mine.description}"` : "Your open intervention: none");
  if (extras.others.length) lines.push(`Other AI connected: ${extras.others.join(", ")}`);
  if (extras.changed) lines.push(extras.changed);
  lines.push(toneText(extras.tone ?? "direct"));
  lines.push(
    extras.apply === "proposal"
      ? "Changes: as proposals. When you end an intervention, what you wrote leaves the song and waits for the user to accept or discard it."
      : "Changes: straight into the song (the user hears them with and without, and can undo).",
  );
  if (extras.proposals?.length) {
    lines.push(`Pending proposals: ${extras.proposals.map((p) => `${p.id} "${p.label}"${p.stale ? " (out of date: the user changed what it touches)" : ""}`).join(" · ")}`);
  }
  return lines.join("\n");
}

const secs = (s: number) => `${s < 1 ? s.toFixed(2).replace(/0$/, "") : Math.round(s * 10) / 10} s`;

/**
 * How a sound behaves, from its bank's data (soundbank-info.ts): what to expect when you write for it.
 * `keys` adds the keys it has samples for (left out for General MIDI banks, which cover everything).
 */
export function profileText(p: SoundProfile, keys = true): string {
  const parts: string[] = [];
  if (keys) parts.push(`plays ${pitchName(p.low)}–${pitchName(p.high)} (silent outside)`);
  if (p.attack >= 0.1) parts.push(`slow attack ${secs(p.attack)}: sounds late, not for short hits; write it early`);
  else if (p.attack >= 0.03) parts.push(`attack ${secs(p.attack)}`);
  else parts.push("fast attack");
  if (p.sustain === "holds") parts.push("holds long notes");
  else if (p.sustain === "fades") parts.push(`fades away in about ${secs(p.fade ?? 0)} even when held`);
  else parts.push(p.fade ? `no loop: dies out after about ${secs(p.fade)}, re-strike long notes` : "no loop: dies out, re-strike long notes");
  if (p.release >= 0.3) parts.push(`rings ${secs(p.release)} after the note ends`);
  return parts.join(", ");
}

export function instrumentsText(banks: SoundBankInfo[], builtIn: readonly BankPreset[] = [], plugins: readonly EnginePlugin[] = []): string {
  const lines = [
    "Four Hands · instruments (built-in sound; ranges are the real sounding range).",
    "Behaviour comes from each sound's own data (attack, whether it holds a long note, how long it rings): trust it over the name.",
  ];
  const profileOf = (program: number | null) => (program === null ? undefined : builtIn.find((p) => p.bankMSB === 0 && p.program === program)?.profile);
  for (const group of PALETTE) {
    lines.push(`${group.en}:`);
    for (const item of group.items) {
      const program = item.program === null ? "drums" : `program ${item.program}`;
      const profile = profileOf(item.program);
      const extra = [item.range ? rangeText(item.range) : "", item.note ?? "", profile ? profileText(profile, false) : ""].filter(Boolean);
      lines.push(`  ${item.en} / ${item.es} · ${program}${extra.length ? ` · ${extra.join(" · ")}` : ""}`);
    }
  }
  lines.push("Any General MIDI program number (0-127) also works.", GM_NOTES);
  if (banks.length === 0) lines.push("Installed sound banks: none");
  else {
    lines.push("Installed sound banks (list one's sounds with list_instruments, bank):");
    for (const b of banks) lines.push(`  ${b.id} · "${b.name}" · ${b.presets.length} sounds`);
  }
  if (plugins.length === 0) lines.push("Instrument plugins on this computer: none found yet");
  else {
    lines.push(
      `Instrument plugins on this computer (hosted by Four Hands; use sound: 'plugin / <name>'). You do not hear them or know what each has loaded: ask the user what instrument is in it (a Kontakt library, an Omnisphere patch) before writing for it:`,
    );
    for (const p of plugins) lines.push(`  ${p.name}${p.vendor ? ` · ${p.vendor}` : ""}${p.category ? ` · ${p.category}` : ""}`);
  }
  return lines.join("\n");
}

export function bankText(bank: SoundBankInfo): string {
  const lines = [
    `Four Hands · sounds of ${bank.id} ("${bank.name}")`,
    "Use them as sound: '<bank file> / <sound name>'. Behaviour comes from the bank's own data: trust it over the name.",
  ];
  for (const p of bank.presets) lines.push(`  ${p.name}${p.bankMSB === 128 ? " (drum kit)" : ""}${p.profile ? ` · ${profileText(p.profile)}` : ""}`);
  return lines.join("\n");
}

/** "c. 17–20" for a span of ticks. */
export function spanText(song: Song, start: number, end: number): string {
  return bars(barAt(song.meter, start), barAt(song.meter, Math.max(start, end - 1)));
}

export { barStart };

/**
 * F2.2: get_levels. Peak and RMS per track after its fader, and the master, from the last playback.
 * A meter, not ears: it says how loud, not which frequencies (that comes with F2.3).
 */
/** The engine's load as get_levels gives it (F2.2 parte B). */
export function loadText(load: EngineLoad | null | undefined): string | null {
  if (!load) return null;
  const cut = load.dropouts > 0 ? `; the audio was CUT ${load.dropouts} time(s) in the last second it measured (too many plugins, or too small a buffer)` : "; no audio cut";
  return `Engine load: ${Math.round(load.avgLoad * 100)} % average, ${Math.round(load.maxLoad * 100)} % peak of each audio block's time${cut}.`;
}

export function levelsText(
  levels: EngineLevels | null,
  tracks: ReadonlyArray<{ name: string; channel: number; strip?: number | undefined }>,
  at: number | null,
  extras: { masterVolume?: number | undefined; load?: EngineLoad | null } = {},
): string {
  const load = loadText(extras.load);
  if (!levels) return ["No levels yet: they are measured in the audio engine while the song plays. Ask the user to play it (or the part you care about) and stop; then call get_levels again.", ...(load ? [load] : [])].join("\n");
  const r = levelsReport(levels, tracks);
  const db = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}` : "silent");
  const clip = (n: number) => (n > 0 ? `, CLIPPING (${n} samples over 0 dBFS)` : "");
  const when = at ? ` (${new Date(at).toISOString().slice(11, 16)} UTC)` : "";
  const fader = extras.masterVolume !== undefined && extras.masterVolume !== 1 ? ` (after its fader, vol ${Math.round(extras.masterVolume * 100)})` : "";
  const lines = [`Levels of the last playback${when}, measured after each fader, in dBFS (peak / average RMS):`, `- Master${fader}: ${db(r.master.peakDb)} / ${db(r.master.rmsDb)}${clip(r.master.clips)}`];
  const silent: string[] = [];
  for (const t of r.tracks) {
    if (!Number.isFinite(t.peakDb)) silent.push(t.track);
    else lines.push(`- ${t.track}: ${db(t.peakDb)} / ${db(t.rmsDb)}${clip(t.clips)}`);
  }
  if (silent.length) lines.push(`Silent in that playback (muted, not playing there, or no notes): ${silent.join(", ")}.`);
  if (load) lines.push(load);
  lines.push("This is a meter, not hearing: it does not tell frequencies or masking. Say so if you base an opinion on it.");
  return lines.join("\n");
}
