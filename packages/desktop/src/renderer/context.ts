/** What every component of the window can reach. */
import { type RefObject, createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { type Note, type Song, type Track, orderedTracks } from "@fourhands/core";
import type { Lang, Translate } from "../shared/i18n.js";
import type { AiStore } from "./ai.js";
import type { Bridge } from "./bridge.js";
import type { Replica } from "./replica.js";
import { trackColor } from "./theme.js";
import type { SongActions } from "./song-actions.js";
import type { ViewStore } from "./view.js";

export interface AppCtx {
  replica: Replica;
  view: ViewStore;
  bridge: Bridge;
  t: Translate;
  lang: Lang;
  ai: AiStore;
}

export const Ctx = createContext<AppCtx | null>(null);

/** Song-level actions (tracks, tempo, sections, chords…), provided by App. */
export const ActionsCtx = createContext<SongActions | null>(null);

export function useActions(): SongActions {
  const actions = useContext(ActionsCtx);
  if (!actions) throw new Error("Actions context missing");
  useSyncExternalStore(actions.subscribe, actions.getVersion);
  return actions;
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("App context missing");
  return ctx;
}

/** Re-renders on every change of the song replica. */
export function useSong(): Song {
  const { replica } = useApp();
  useSyncExternalStore(replica.subscribe, replica.getVersion);
  return replica.song;
}

/** Re-renders on every change of the AI's state. */
export function useAi() {
  const { ai } = useApp();
  useSyncExternalStore(ai.subscribe, ai.getVersion);
  return ai.state;
}

/** Re-renders on every change of the view. */
export function useView() {
  const { view } = useApp();
  useSyncExternalStore(view.subscribe, view.getVersion);
  return view.state;
}

/** The track being edited: the shared context's, or the first one. */
export function activeTrack(song: Song): Track | null {
  const id = song.context.activeTrackId;
  return (id ? song.tracks[id] : undefined) ?? orderedTracks(song)[0] ?? null;
}

export function trackColors(song: Song): Map<string, string> {
  // Each track keeps its own colour (`Track.color`), also when the tracks are reordered.
  return new Map(song.trackOrder.map((id) => [id, trackColor(song.tracks[id]?.color ?? 0)]));
}

/** Notes grouped by track, recomputed only when the song changes. */
export function notesByTrack(song: Song): Map<string, Note[]> {
  const map = new Map<string, Note[]>();
  for (const id of song.trackOrder) map.set(id, []);
  for (const n of Object.values(song.notes)) map.get(n.trackId)?.push(n);
  for (const list of map.values()) list.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return map;
}

/** Size of an element's content box, kept up to date. */
export function useSize<T extends HTMLElement>(): [RefObject<T>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** A value that changes every `ms` milliseconds, for "Guardado hace 3 s" and the history times. */
export function useClock(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
