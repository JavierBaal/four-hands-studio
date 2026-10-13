/**
 * The piano roll proper: rulers, keyboard, notes and velocity lane (DIRECCION_ARTISTICA.md, 6.1
 * items 4–6). Drawing only; the gestures are plugged in through `handlers` (gestures.ts).
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { type Note, barAt } from "@fourhands/core";
import { activeTrack, notesByTrack, trackColors, useApp, useSize, useSong, useView } from "../context.js";
import { scalePitchClasses } from "../music.js";
import { drawGrid, drawKeyboard, drawNotes, drawVelocity, prepare } from "../roll/draw.js";
import type { RollView } from "../roll/geometry.js";
import { BarRuler, FormRuler, HarmonyRuler } from "./Rulers.js";

export interface RollHandlers {
  onNotesPointerDown?(e: React.PointerEvent<HTMLCanvasElement>): void;
  onNotesPointerMove?(e: React.PointerEvent<HTMLCanvasElement>): void;
  onNotesPointerUp?(e: React.PointerEvent<HTMLCanvasElement>): void;
  onNotesDoubleClick?(e: React.MouseEvent<HTMLCanvasElement>): void;
  onNotesContextMenu?(e: React.MouseEvent<HTMLCanvasElement>): void;
  onKeysPointerDown?(e: React.PointerEvent<HTMLCanvasElement>): void;
  onVelocityPointerDown?(e: React.PointerEvent<HTMLCanvasElement>): void;
  onWheel?(e: WheelEvent): void;
  cursor?: string;
}

export interface RollOverlay {
  /** Notes as the current gesture would leave them (preview before the single command is sent). */
  preview?: ReadonlyMap<string, Note> | null;
  /** Notes being created by the current gesture. */
  creating?: readonly Note[];
  /** Rubber band, in pixels. */
  marquee?: { x0: number; y0: number; x1: number; y1: number } | null;
  playhead: number | null;
}

export interface RollAreaProps {
  v: RollView;
  overlay: RollOverlay;
  handlers: RollHandlers;
  onResize(size: { width: number; height: number }): void;
}

export function RollArea({ v, overlay, handlers, onResize }: RollAreaProps) {
  const { t, replica } = useApp();
  const song = useSong();
  const view = useView();
  const track = activeTrack(song);
  const [gridRef, size] = useSize<HTMLDivElement>();
  const keysRef = useRef<HTMLCanvasElement>(null);
  const notesRef = useRef<HTMLCanvasElement>(null);
  const velRef = useRef<HTMLCanvasElement>(null);
  const byTrack = useMemo(() => notesByTrack(song), [replica.version]);
  const colors = useMemo(() => trackColors(song), [replica.version]);

  useLayoutEffect(() => {
    if (size.width > 0) onResize(size);
  }, [size.width, size.height]);

  // Wheel: native listener, because React's is passive and cannot prevent the page from scrolling.
  useEffect(() => {
    const el = notesRef.current;
    if (!el || !handlers.onWheel) return;
    const fn = (e: WheelEvent) => handlers.onWheel!(e);
    el.addEventListener("wheel", fn, { passive: false });
    return () => el.removeEventListener("wheel", fn);
  }, [handlers.onWheel]);

  const own = useMemo(() => {
    const list = track ? (byTrack.get(track.id) ?? []) : [];
    if (!overlay.preview && !overlay.creating?.length) return list;
    const out = list.map((n) => overlay.preview?.get(n.id) ?? n);
    return overlay.creating?.length ? [...out, ...overlay.creating] : out;
  }, [byTrack, track?.id, overlay.preview, overlay.creating]);

  const ghosts = useMemo(() => {
    const list: { note: Note; color: string }[] = [];
    for (const id of song.trackOrder) {
      if (id === track?.id || song.tracks[id]?.mute) continue;
      const color = colors.get(id)!;
      for (const note of byTrack.get(id) ?? []) list.push({ note, color });
    }
    return list;
  }, [byTrack, colors, track?.id]);

  const selected = useMemo(() => new Set(song.context.selection), [replica.version]);

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const keys = keysRef.current && prepare(keysRef.current);
      if (keys) drawKeyboard(keys, v, view.noteNames);
      const notes = notesRef.current && prepare(notesRef.current);
      const now = performance.now();
      const fresh = new Map<string, number>();
      for (const [id, at] of replica.fresh) {
        const age = (now - at) / 250;
        if (age >= 1) replica.fresh.delete(id);
        else if (song.notes[id]?.shapedBy.by === "ai") fresh.set(id, age);
      }
      if (notes) {
        drawGrid(notes, v, song.meter, view.scale ? scalePitchClasses(song.key) : null);
        drawNotes(notes, v, {
          notes: own,
          ghosts,
          selected,
          authorship: view.authorship,
          scale: null,
          names: view.noteNames,
          song,
          band: null,
          playhead: overlay.playhead,
          fresh,
        });
        if (overlay.marquee) {
          const m = overlay.marquee;
          notes.ctx.strokeStyle = "#ece6dc";
          notes.ctx.globalAlpha = 0.6;
          notes.ctx.setLineDash([3, 3]);
          notes.ctx.strokeRect(Math.min(m.x0, m.x1) + 0.5, Math.min(m.y0, m.y1) + 0.5, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
          notes.ctx.setLineDash([]);
          notes.ctx.globalAlpha = 1;
        }
      }
      const vel = velRef.current && prepare(velRef.current);
      if (vel) drawVelocity(vel, v, own, selected, view.authorship);
      if (fresh.size > 0 && !matchMedia("(prefers-reduced-motion: reduce)").matches) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  });

  const formEmpty = Object.keys(song.sections).length === 0;
  const harmonyEmpty = Object.keys(song.harmony).length === 0;
  const rows = `${formEmpty ? 30 : 24}px ${harmonyEmpty ? 30 : 24}px 24px minmax(0, 1fr) 64px`;
  const from = barAt(song.meter, v.startTick);
  const to = barAt(song.meter, v.startTick + v.width / v.pxPerTick);

  return (
    <div className="grid2" style={{ gridTemplateRows: rows }}>
      <div className="rlab" style={{ height: "auto" }}>
        {t("form")}
      </div>
      <div className="rrow" style={{ height: "auto" }}>
        <FormRuler song={song} v={v} t={t} />
      </div>
      <div className="rlab" style={{ height: "auto" }}>
        {t("harmony")}
      </div>
      <div className="rrow" style={{ height: "auto" }}>
        <HarmonyRuler song={song} v={v} t={t} />
      </div>
      <div className="rlab">{t("bar")}</div>
      <div className="rrow">
        <BarRuler song={song} v={v} />
      </div>
      <div className="keys">
        <canvas ref={keysRef} onPointerDown={handlers.onKeysPointerDown} />
      </div>
      <div className="pgrid" ref={gridRef} aria-label={t("notesOf", { track: track?.name ?? "", from, to })} role="img">
        <canvas
          ref={notesRef}
          style={{ cursor: handlers.cursor ?? "default" }}
          onPointerDown={handlers.onNotesPointerDown}
          onPointerMove={handlers.onNotesPointerMove}
          onPointerUp={handlers.onNotesPointerUp}
          onDoubleClick={handlers.onNotesDoubleClick}
          onContextMenu={handlers.onNotesContextMenu}
        />
      </div>
      <div className="vtab">
        <b>{t("velocity")}</b>
        <span>{t("pedal")}</span>
      </div>
      <div className="vlane">
        <canvas ref={velRef} onPointerDown={handlers.onVelocityPointerDown} />
      </div>
    </div>
  );
}
