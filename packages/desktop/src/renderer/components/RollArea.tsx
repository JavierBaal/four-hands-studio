/**
 * The piano roll proper: rulers, keyboard, notes and velocity lane (DIRECCION_ARTISTICA.md, 6.1
 * items 4–6). Draws, and passes the pointer to the Editor (editor.ts).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { type Note, barAt } from "@fourhands/core";
import { activeTrack, notesByTrack, trackColors, useApp, useSize, useSong, useView } from "../context.js";
import { scalePitchClasses } from "../music.js";
import { drawGrid, drawKeyboard, drawNotes, drawPedal, drawStroke, drawVelocity, prepare } from "../roll/draw.js";
import { T } from "../theme.js";
import { type RollView, yToPitch } from "../roll/geometry.js";
import { type Editor, modKey } from "../editor.js";
import type { AudioLayer } from "../audio-layer.js";
import { BarRuler, FormRuler, HarmonyRuler } from "./Rulers.js";

export interface RollAreaProps {
  v: RollView;
  editor: Editor;
  audio: AudioLayer;
  playhead: number | null;
  onResize(size: { width: number; height: number }): void;
  onWheel(e: WheelEvent): void;
  onKeyPress(pitch: number): void;
}

type PointerHandler = (e: React.PointerEvent<HTMLElement>) => void;

function local(e: { clientX: number; clientY: number; currentTarget: Element }): { x: number; y: number } {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

const mods = (e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }) => ({ shift: e.shiftKey, alt: e.altKey, mod: modKey(e) });

export function RollArea({ v, editor, audio, playhead, onResize, onWheel, onKeyPress }: RollAreaProps) {
  const { t, replica } = useApp();
  const song = useSong();
  const view = useView();
  const track = activeTrack(song);
  const [gridRef, size] = useSize<HTMLDivElement>();
  const keysRef = useRef<HTMLCanvasElement>(null);
  const notesRef = useRef<HTMLCanvasElement>(null);
  const velRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLCanvasElement>(null);
  const { view: viewStore } = useApp();
  useSyncExternalStore(audio.subscribe, audio.getVersion);
  const playing = audio.player.playing;

  // Playhead on its own layer while playing, so the notes are not redrawn every frame.
  // The view turns the page when the playhead leaves it.
  useEffect(() => {
    const canvas = headRef.current;
    if (!canvas) return;
    let frame = 0;
    const draw = () => {
      const s = prepare(canvas);
      const pos = audio.player.position();
      if (s && pos !== null) {
        const vs = viewStore.state;
        const span = s.width / vs.pxPerTick;
        // Turning the page slides (a short glide), so the eye can follow the music.
        if (!audio.player.countingIn() && !viewStore.moving && (pos < vs.startTick || pos > vs.startTick + span * 0.97)) {
          viewStore.animate({ startTick: Math.max(0, pos - span * 0.03) }, 220);
        }
        const x = (pos - viewStore.state.startTick) * vs.pxPerTick;
        s.ctx.globalAlpha = 0.85;
        s.ctx.fillStyle = T.playhead;
        s.ctx.fillRect(Math.round(x) - 1, 0, 2, s.height);
      }
      if (audio.player.playing) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  const byTrack = useMemo(() => notesByTrack(song), [replica.version]);
  const colors = useMemo(() => trackColors(song), [replica.version]);
  useSyncExternalStore(editor.subscribe, editor.getVersion);
  const overlay = editor.overlay;
  editor.v = v;

  useLayoutEffect(() => {
    if (size.width > 0) onResize(size);
  }, [size.width, size.height]);

  // Wheel: native listener, because React's is passive and cannot prevent the page from scrolling.
  useEffect(() => {
    const el = notesRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  const own = useMemo(() => {
    const list = track ? (byTrack.get(track.id) ?? []) : [];
    if (!overlay.preview && !overlay.creating.length && !overlay.hidden) return list;
    const out = list.filter((n) => !overlay.hidden?.has(n.id)).map((n) => overlay.preview?.get(n.id) ?? n);
    return overlay.creating.length ? [...out, ...overlay.creating] : out;
  }, [byTrack, track?.id, overlay.preview, overlay.creating, overlay.hidden]);

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
          playhead,
          fresh,
          drift: overlay.drift,
        });
        if (overlay.marquee) {
          // Rubber band: dashed, neutral (no token of its own; uses the selected-note ring colour).
          const m = overlay.marquee;
          notes.ctx.strokeStyle = T.selectNote;
          notes.ctx.globalAlpha = 0.6;
          notes.ctx.setLineDash([3, 3]);
          notes.ctx.strokeRect(Math.min(m.x0, m.x1) + 0.5, Math.min(m.y0, m.y1) + 0.5, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
          notes.ctx.setLineDash([]);
          notes.ctx.globalAlpha = 1;
        }
      }
      const vel = velRef.current && prepare(velRef.current);
      if (vel && view.lane === "velocity") drawVelocity(vel, v, own, selected, view.authorship);
      if (vel && view.lane === "pedal") drawPedal(vel, v, overlay.pedalPreview ?? track?.pedal ?? []);
      if (vel && overlay.stroke) drawStroke(vel, overlay.stroke);
      if (fresh.size > 0 && !matchMedia("(prefers-reduced-motion: reduce)").matches) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  });

  const notesDown: PointerHandler = (e) => {
    if (e.button === 0) e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    editor.pointerDown(p.x, p.y, e.button, mods(e));
  };

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
      <div className="rrow form" style={{ height: "auto" }}>
        <FormRuler song={song} v={v} t={t} />
      </div>
      <div className="rlab" style={{ height: "auto" }}>
        {t("harmony")}
      </div>
      <div className="rrow harmony" style={{ height: "auto" }}>
        <HarmonyRuler song={song} v={v} t={t} />
      </div>
      <div className="rlab">{t("bar")}</div>
      <div
        className="rrow bars"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          editor.rulerDown(local(e).x);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && editor.rulerMove(local(e).x)}
        onPointerUp={(e) => editor.rulerUp(local(e).x)}
        onDoubleClick={() => editor.clearLoop()}
      >
        <BarRuler song={song} v={v} />
      </div>
      <div className="keys">
        <canvas ref={keysRef} onPointerDown={(e) => onKeyPress(yToPitch(v, local(e).y))} />
      </div>
      <div className="pgrid" ref={gridRef} aria-label={t("notesOf", { track: track?.name ?? "", from, to })} role="img">
        <canvas
          ref={notesRef}
          style={{ cursor: overlay.cursor }}
          onPointerDown={notesDown}
          onPointerMove={(e) => {
            const p = local(e);
            editor.pointerMove(p.x, p.y, mods(e));
          }}
          onPointerUp={(e) => {
            const p = local(e);
            editor.pointerUp(p.x, p.y);
          }}
          onPointerCancel={() => editor.escape()}
          onDoubleClick={(e) => {
            const p = local(e);
            editor.doubleClick(p.x, p.y);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            const p = local(e);
            editor.contextMenu(p.x, p.y, e.clientX, e.clientY);
          }}
        />
        <canvas ref={headRef} className="playhead-layer" />
      </div>
      <div className="vtab" role="tablist">
        <button role="tab" className={view.lane === "velocity" ? "vtabb on" : "vtabb"} aria-selected={view.lane === "velocity"} onClick={() => viewStore.set({ lane: "velocity" })}>
          {t("velocity")}
        </button>
        <button role="tab" className={view.lane === "pedal" ? "vtabb on" : "vtabb"} aria-selected={view.lane === "pedal"} onClick={() => viewStore.set({ lane: "pedal" })}>
          {t("pedal")}
        </button>
      </div>
      <div className="vlane">
        <canvas
          ref={velRef}
          style={{ cursor: view.lane === "pedal" ? overlay.cursor : "crosshair" }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = local(e);
            if (view.lane === "pedal") editor.pedalDown(p.x);
            else editor.velocityDown(p.x, p.y, e.currentTarget.clientHeight, mods(e));
          }}
          onPointerMove={(e) => {
            const p = local(e);
            if (view.lane === "pedal") {
              editor.pedalMove(p.x);
              return;
            }
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            editor.velocityMove(p.x, p.y, mods(e));
          }}
          onPointerUp={(e) => {
            const p = local(e);
            editor.pointerUp(p.x, p.y);
          }}
          onDoubleClick={(e) => view.lane === "pedal" && editor.pedalDoubleClick(local(e).x)}
        />
      </div>
    </div>
  );
}
