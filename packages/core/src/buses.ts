/**
 * Buses and sends (F2.2 parte D, Fran 04/11/2026).
 *
 * A bus is a channel fed by tracks and by other buses: their output (`bus`: where the sound goes
 * after the fader) or their sends (a copy at a level, after the fader or before it). Buses chain
 * (Voces → Mix bus → Máster) and never loop. Reverb is a bus with Four Hands' reverb (or a plugin)
 * on it, or an effect on the track (Fran, 04/11/2026: no per-track reverb knob). A song from before
 * that used H4's per-track reverb opens with the «Reverb» bus (file.ts). Deleting a bus sends what
 * went through it on to the next bus, or the Master, and drops the sends to it (the window warns).
 */
import { CommandError, type Transaction } from "./document.js";
import { defaultParams } from "./effects.js";
import { type Bus, type Send, type Song, TRACK_COLOR_COUNT, type Track } from "./model.js";

export class BusError extends CommandError {}

function check(ok: boolean, message: string): asserts ok {
  if (!ok) throw new BusError(message);
}

/** Buses in a song, at most: the limit is the machine, this only stops a runaway loop. */
export const MAX_BUSES = 128;
/** Sends per track or bus, at most. */
export const MAX_SENDS = 32;
export const BUS_NAME_MAX = 60;
/** The bus every song starts with. */
export const REVERB_BUS_NAME = "Reverb";
/** Its colour: the palette's blue (the app names the tones). */
export const REVERB_BUS_COLOR = 4;

export function isBusId(id: string): boolean {
  return /^b\d+$/.test(id);
}

/** The buses in console order. */
export function busList(song: Song): Bus[] {
  return (song.busOrder ?? []).map((id) => song.buses?.[id]).filter((b): b is Bus => !!b);
}

/** The bus with that id, or the one with that name (case and accents aside). */
export function findBus(song: Song, idOrName: string): Bus | undefined {
  const byId = song.buses?.[idOrName];
  if (byId) return byId;
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  return busList(song).find((b) => norm(b.name) === norm(idOrName));
}

/**
 * The bus that holds the song's reverb: the first one with Four Hands' reverb in it, else the
 * first called «Reverb». What a track's «reverb» means (H4): its send there.
 */
export function reverbBus(song: Song): Bus | undefined {
  const buses = busList(song);
  return buses.find((b) => (b.inserts ?? []).some((x) => x.kind === "reverb")) ?? buses.find((b) => b.name.trim().toLowerCase() === REVERB_BUS_NAME.toLowerCase());
}

/** A track's (or bus's) send to the reverb bus, 0–1: its «reverb» as H4 knew it. */
export function reverbLevel(song: Song, source: Pick<Track, "sends">): number {
  const bus = reverbBus(song);
  return (bus && source.sends?.find((s) => s.bus === bus.id)?.level) ?? 0;
}

/**
 * Gives a song that has no buses the «Reverb» bus, with Four Hands' reverb (a file from before
 * parte D whose tracks had reverb). In place, outside the history.
 */
export function withDefaultBuses(song: Song): Song {
  if (song.buses) return song;
  song.counters.b ??= 1;
  song.counters.x ??= 1;
  const id = `b${song.counters.b++}`;
  const reverb = `x${song.counters.x++}`;
  song.buses = { [id]: { id, name: REVERB_BUS_NAME, color: REVERB_BUS_COLOR, volume: 1, pan: 0, inserts: [{ id: reverb, kind: "reverb", params: defaultParams("reverb") }] } };
  song.busOrder = [id];
  return song;
}

/** Where a track or bus is, for the commands. */
function source(song: Song, id: string): { kind: "track"; item: Track } | { kind: "bus"; item: Bus } {
  if (isBusId(id)) {
    const bus = song.buses?.[id];
    check(!!bus, `Unknown bus: ${id}`);
    return { kind: "bus", item: bus };
  }
  const track = song.tracks[id];
  check(!!track, `Unknown track: ${id}`);
  return { kind: "track", item: track };
}

const pathOf = (id: string) => (isBusId(id) ? ["buses", id] : ["tracks", id]);

function getBus(song: Song, id: string): Bus {
  const bus = song.buses?.[id];
  check(!!bus, `Unknown bus: ${id}`);
  return bus;
}

/** Buses a bus sends its sound to: its output and its sends. */
function next(bus: Bus): string[] {
  return [...(bus.bus ? [bus.bus] : []), ...(bus.sends ?? []).map((s) => s.bus)];
}

/** Does sound from bus `from` reach bus `to` (through outputs and sends)? */
export function reaches(song: Song, from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const bus = song.buses?.[id];
    if (bus) stack.push(...next(bus));
  }
  return false;
}

/** Would sending from `from` (a track or bus) to bus `to` make a loop? */
function loops(song: Song, from: string, to: string): boolean {
  return isBusId(from) && (from === to || reaches(song, to, from));
}

/**
 * The buses in the order the engine processes them: every bus after all that feed it. (No loops
 * can be written; a damaged file is refused when opened.)
 */
export function processingOrder(song: Song): string[] {
  const buses = busList(song);
  const incoming = new Map<string, number>(buses.map((b) => [b.id, 0]));
  for (const b of buses) for (const n of new Set(next(b))) if (incoming.has(n)) incoming.set(n, incoming.get(n)! + 1);
  const ready = buses.filter((b) => incoming.get(b.id) === 0).map((b) => b.id);
  const out: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    out.push(id);
    for (const n of new Set(next(song.buses![id]!))) {
      if (!incoming.has(n)) continue;
      incoming.set(n, incoming.get(n)! - 1);
      if (incoming.get(n) === 0) ready.push(n);
    }
  }
  return out;
}

function freeBusColor(song: Song): number {
  const count = new Array<number>(TRACK_COLOR_COUNT).fill(0);
  for (const b of busList(song)) if (b.color >= 0 && b.color < TRACK_COLOR_COUNT) count[b.color]!++;
  let best = 0;
  for (let i = 1; i < TRACK_COLOR_COUNT; i++) if (count[i]! < count[best]!) best = i;
  return best;
}

function checkName(name: string): string {
  const n = name.trim();
  check(n.length > 0, "A bus needs a name");
  check(n.length <= BUS_NAME_MAX, `A bus's name has at most ${BUS_NAME_MAX} characters`);
  return n;
}

export interface BusSpec {
  name: string;
  color?: number;
  /** Where it goes: another bus. Absent: the Master. */
  bus?: string;
  /** Place in the console (the end if left out). */
  index?: number;
}

export function addBus(tx: Transaction, spec: BusSpec): string {
  const song = tx.song;
  check((song.busOrder ?? []).length < MAX_BUSES, `A song holds at most ${MAX_BUSES} buses`);
  const name = checkName(spec.name);
  if (spec.color !== undefined) check(Number.isInteger(spec.color) && spec.color >= 0 && spec.color < TRACK_COLOR_COUNT, `Invalid colour: ${spec.color}`);
  if (spec.bus !== undefined) getBus(song, spec.bus);
  song.counters.b ??= 1;
  const id = tx.nextId("b");
  const bus: Bus = { id, name, color: spec.color ?? freeBusColor(song), volume: 1, pan: 0 };
  if (spec.bus) bus.bus = spec.bus;
  if (!song.buses) tx.set(["buses"], {});
  tx.set(["buses", id], bus);
  const order = [...(song.busOrder ?? [])];
  order.splice(spec.index === undefined ? order.length : Math.max(0, Math.min(order.length, Math.round(spec.index))), 0, id);
  tx.set(["busOrder"], order);
  return id;
}

/** What deleting a bus did to the rest: who now goes elsewhere, and whose sends were dropped. */
export interface BusRemoval {
  /** Tracks and buses that went through it, now going to `to` (a bus id, or "master"). */
  rerouted: string[];
  to: string;
  /** Tracks and buses that had a send to it. */
  sendsDropped: string[];
}

/** Deletes a bus: what went through it goes on to its own output; sends to it go away. */
export function removeBus(tx: Transaction, id: string): BusRemoval {
  const song = tx.song;
  const bus = getBus(song, id);
  const to = bus.bus;
  const result: BusRemoval = { rerouted: [], to: to ?? "master", sendsDropped: [] };
  const sources: Array<Track | Bus> = [...song.trackOrder.map((t) => song.tracks[t]!).filter(Boolean), ...busList(song).filter((b) => b.id !== id)];
  for (const s of sources) {
    if (s.bus === id) {
      result.rerouted.push(s.id);
      if (to) tx.set([...pathOf(s.id), "bus"], to);
      else tx.remove([...pathOf(s.id), "bus"]);
    }
    if (s.sends?.some((x) => x.bus === id)) {
      result.sendsDropped.push(s.id);
      writeSends(tx, s.id, s.sends.filter((x) => x.bus !== id));
    }
  }
  tx.set(["busOrder"], (song.busOrder ?? []).filter((b) => b !== id));
  tx.remove(["buses", id]);
  return result;
}

export interface BusChanges {
  name?: string;
  color?: number;
  volume?: number;
  pan?: number;
  mute?: boolean;
  solo?: boolean;
}

export function updateBus(tx: Transaction, id: string, changes: BusChanges): void {
  const bus = getBus(tx.song, id);
  const next: Bus = { ...bus };
  if (changes.name !== undefined) next.name = checkName(changes.name);
  if (changes.color !== undefined) {
    check(Number.isInteger(changes.color) && changes.color >= 0 && changes.color < TRACK_COLOR_COUNT, `Invalid colour: ${changes.color}`);
    next.color = changes.color;
  }
  if (changes.volume !== undefined) {
    check(changes.volume >= 0 && changes.volume <= 1, "Volume must be between 0 and 1");
    next.volume = changes.volume;
  }
  if (changes.pan !== undefined) {
    check(changes.pan >= -1 && changes.pan <= 1, "Pan must be between -1 and 1");
    next.pan = changes.pan;
  }
  for (const flag of ["mute", "solo"] as const) {
    if (changes[flag] === undefined) continue;
    if (changes[flag]) next[flag] = true;
    else delete next[flag];
  }
  if (JSON.stringify(next) !== JSON.stringify(bus)) tx.set(["buses", id], next);
}

export function moveBus(tx: Transaction, id: string, index: number): void {
  getBus(tx.song, id);
  const order = (tx.song.busOrder ?? []).filter((b) => b !== id);
  order.splice(Math.max(0, Math.min(order.length, Math.round(index))), 0, id);
  if (order.join() !== (tx.song.busOrder ?? []).join()) tx.set(["busOrder"], order);
}

/** Where a track's or bus's sound goes after its fader: a bus, or the Master (null). */
export function setOutput(tx: Transaction, sourceId: string, busId: string | null): void {
  const { item } = source(tx.song, sourceId);
  if (busId !== null) {
    getBus(tx.song, busId);
    check(!loops(tx.song, sourceId, busId), sourceId === busId ? "A bus cannot go into itself" : `That would make a loop: ${getBus(tx.song, busId).name} already goes into ${(item as Bus).name}`);
  }
  if ((item.bus ?? null) === busId) return;
  if (busId === null) tx.remove([...pathOf(sourceId), "bus"]);
  else tx.set([...pathOf(sourceId), "bus"], busId);
}

function writeSends(tx: Transaction, sourceId: string, sends: Send[]): void {
  const path = [...pathOf(sourceId), "sends"];
  if (sends.length) tx.set(path, sends);
  else tx.remove(path);
}

export interface SendChanges {
  /** 0–1, linear. */
  level?: number;
  /** Before the fader. */
  pre?: boolean;
}

/** Adds a send from a track or bus to a bus, or changes the one it has. */
export function setSend(tx: Transaction, sourceId: string, busId: string, changes: SendChanges): void {
  const { item } = source(tx.song, sourceId);
  getBus(tx.song, busId);
  check(!loops(tx.song, sourceId, busId), sourceId === busId ? "A bus cannot send to itself" : `That would make a loop: ${getBus(tx.song, busId).name} already goes into ${(item as Bus).name}`);
  if (changes.level !== undefined) check(Number.isFinite(changes.level) && changes.level >= 0 && changes.level <= 1, "A send's level goes from 0 to 1");
  const sends = [...(item.sends ?? [])];
  const at = sends.findIndex((s) => s.bus === busId);
  if (at < 0) check(sends.length < MAX_SENDS, `At most ${MAX_SENDS} sends per channel`);
  const before = at >= 0 ? sends[at]! : undefined;
  const send: Send = { bus: busId, level: changes.level ?? before?.level ?? 0 };
  if (changes.pre ?? before?.pre) send.pre = true;
  if (JSON.stringify(send) === JSON.stringify(before)) return;
  if (at >= 0) sends[at] = send;
  else sends.push(send);
  writeSends(tx, sourceId, sends);
}

export function removeSend(tx: Transaction, sourceId: string, busId: string): void {
  const { item } = source(tx.song, sourceId);
  check(!!item.sends?.some((s) => s.bus === busId), `${item.name} has no send to ${tx.song.buses?.[busId]?.name ?? busId}`);
  writeSends(tx, sourceId, item.sends!.filter((s) => s.bus !== busId));
}

/**
 * Which tracks and buses sound now (mute and solo, Studio One's way): with a solo anywhere, a
 * channel sounds if it is soloed, if its sound reaches a soloed bus, or if a soloed channel's
 * sound goes through it (its output chain and the buses its sends reach).
 */
export function audible(song: Song): Set<string> {
  const tracks = song.trackOrder.map((t) => song.tracks[t]!).filter(Boolean);
  const buses = busList(song);
  const soloed = [...tracks.filter((t) => t.solo).map((t) => t.id), ...buses.filter((b) => b.solo).map((b) => b.id)];
  const out = new Set<string>();
  const targets = (s: Track | Bus) => [...(s.bus ? [s.bus] : []), ...(s.sends ?? []).map((x) => x.bus)];
  if (soloed.length === 0) {
    for (const s of [...tracks, ...buses]) if (!s.mute) out.add(s.id);
    return out;
  }
  const soloedBuses = soloed.filter(isBusId);
  // Downstream of a soloed channel: every bus its sound reaches.
  const downstream = new Set<string>();
  const stack = soloed.flatMap((id) => targets(isBusId(id) ? song.buses![id]! : song.tracks[id]!));
  while (stack.length) {
    const id = stack.pop()!;
    if (downstream.has(id) || !song.buses?.[id]) continue;
    downstream.add(id);
    stack.push(...targets(song.buses[id]!));
  }
  const feedsSoloed = (s: Track | Bus) => targets(s).some((b) => soloedBuses.some((sb) => b === sb || reaches(song, b, sb)));
  for (const s of [...tracks, ...buses]) {
    if (s.mute) continue;
    if (s.solo || downstream.has(s.id) || feedsSoloed(s)) out.add(s.id);
  }
  return out;
}
