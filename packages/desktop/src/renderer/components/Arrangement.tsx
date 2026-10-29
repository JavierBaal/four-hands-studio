/**
 * Arrangement (DIRECCION_ARTISTICA.md, 6.1 item 2): track headers, sections strip, one lane per
 * track with its notes in miniature, and the rectangle of what the piano roll shows.
 *
 * - Lanes: clicking makes that track the active one; dragging the rectangle (or anywhere) pans the
 *   piano roll continuously, following the mouse.
 * - Headers: double click renames, right click opens the track menu, dragging reorders.
 * - "Añadir pista" under the headers opens the instrument palette.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { type Song, barStart, barTicks, orderedSections, orderedTracks } from "@fourhands/core";
import { activeTrack, notesByTrack, trackColors, useActions, useApp, useSize, useSong, useView } from "../context.js";
import { arrangementTotal, drawArrangement, prepare } from "../roll/draw.js";
import { SIZE, T } from "../theme.js";
import type { AudioLayer } from "../audio-layer.js";
import { InlineEdit } from "./InlineEdit.js";
import { Fader } from "./Fader.js";
import { Splitter } from "./Splitter.js";
import { SoundOriginIcon } from "./SidePanel.js";
import { SOUND_DRAG } from "./SoundsBrowser.js";
import { LAYOUT_DEFAULTS } from "../view.js";
import { formatDb, formatPan } from "../../shared/mix.js";
import type { Track } from "@fourhands/core";

export interface ArrangementProps {
  compact: boolean;
  /** Ticks currently visible in the piano roll. */
  visible: { start: number; end: number } | null;
  onSelectTrack(id: string): void;
  /** Puts the left edge of the piano roll at a tick; `animate` for jumps, not for drags. */
  onPan(startTick: number, animate: boolean): void;
  onToggle(id: string, field: "mute" | "solo"): void;
  /** Height the user dragged (splitter), or null for as tall as the tracks need. */
  height?: number | null;
  /** The player: its position draws the playhead over the lanes while playing (Fran, 19/10/2026). */
  audio?: AudioLayer;
}

interface HeaderDrag {
  id: string;
  y0: number;
  dy: number;
  moved: boolean;
}

export function Arrangement({ compact, visible, onSelectTrack, onPan, onToggle, height = null, audio }: ArrangementProps) {
  const { t, replica, view, lang } = useApp();
  useView();
  const actions = useActions();
  // Sounds dragged from the Sonidos browser (ESTUDIO_INTERFAZ_2.md, 5.3): onto a track, or under the tracks.
  const [soundOver, setSoundOver] = useState<string | null>(null);
  const soundFrom = (e: React.DragEvent) => {
    const key = e.dataTransfer.getData(SOUND_DRAG);
    return key ? (audio?.soundCatalog(lang, t("sndBuiltIn")).find((i) => i.key === key) ?? null) : null;
  };
  const laneTrack = (e: React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return tracks[Math.floor((e.clientY - rect.top - SIZE.arrangeStrip) / laneHeight)] ?? null;
  };
  const dragsSound = (e: React.DragEvent) => e.dataTransfer.types.includes(SOUND_DRAG);
  const soundDrop = (trackId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragsSound(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      if (soundOver !== (trackId ?? "new")) setSoundOver(trackId ?? "new");
    },
    onDragLeave: () => setSoundOver(null),
    onDrop: (e: React.DragEvent) => {
      if (!dragsSound(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setSoundOver(null);
      const item = soundFrom(e);
      if (!item) return;
      if (trackId) actions.applySound(trackId, item);
      else void actions.addTrackWithSound(item);
    },
  });
  const song = useSong();
  const tracks = orderedTracks(song);
  const active = activeTrack(song);
  const laneHeight = compact ? SIZE.arrangeLaneCompact : SIZE.arrangeLane;
  const [boxRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colors = useMemo(() => trackColors(song), [replica.version]);
  const byTrack = useMemo(() => notesByTrack(song), [replica.version]);
  const full = arrangementTotal(song);
  // Zoomed arrangement (Fran, 15/10/2026): a window over the song; null shows all of it.
  const z = useView().arrZoom;
  const total = z ? Math.min(z.span, full) : full;
  const t0 = z ? Math.max(0, Math.min(z.start, full - total)) : 0;
  const tool = useView().tool;
  const [zoomBox, setZoomBox] = useState<{ x0: number; x1: number; out: boolean } | null>(null);
  const setZoom = (start: number, span: number) => {
    const s2 = Math.max(barTicksOf(song), Math.min(full, span));
    if (s2 >= full - 1) view.set({ arrZoom: null });
    else view.set({ arrZoom: { start: Math.max(0, Math.min(start, full - s2)), span: s2 } });
  };
  const [drag, setDrag] = useState<HeaderDrag | null>(null);
  const pan = useRef<{ grabTick: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = prepare(canvas);
    if (!s) return;
    drawArrangement(s, song, tracks, byTrack, {
      stripHeight: SIZE.arrangeStrip,
      laneHeight,
      totalTicks: total,
      startTick: t0,
      activeTrackId: active?.id ?? null,
      viewport: visible,
      colors,
    });
  });

  // Playhead over the lanes (Fran, 19/10/2026): the same line as in the piano roll, on its own
  // layer so the lanes are not redrawn every frame. Stopped, it marks the cursor, like the roll.
  const headRef = useRef<HTMLCanvasElement>(null);
  const playing = audio?.player.playing ?? false;
  const cursor = song.context.cursor;
  useEffect(() => {
    const canvas = headRef.current;
    if (!canvas) return;
    let frame = 0;
    const draw = () => {
      const s = prepare(canvas);
      const pos = playing ? audio!.player.position() : cursor;
      if (s && pos !== null && pos >= t0 && pos <= t0 + total) {
        const x = Math.round(((pos - t0) / total) * s.width);
        s.ctx.globalAlpha = playing ? 0.85 : 0.6;
        s.ctx.fillStyle = T.playhead;
        s.ctx.fillRect(x - 1, 0, 2, s.height);
      }
      if (playing && audio!.player.playing) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [playing, cursor, t0, total, size.width, size.height]);

  // Lanes: press inside the rectangle to drag it; press elsewhere to jump there (and keep dragging).
  const tickAt = (e: { clientX: number; currentTarget: Element }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return t0 + ((e.clientX - rect.left) / rect.width) * total;
  };
  const lanesDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "zoom") {
      const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
      setZoomBox({ x0: x, x1: x, out: e.altKey });
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const tick = tickAt(e);
    const lane = Math.floor((e.clientY - rect.top - SIZE.arrangeStrip) / laneHeight);
    const track = tracks[lane];
    if (track && track.id !== active?.id) onSelectTrack(track.id);
    if (!visible) return;
    const span = visible.end - visible.start;
    if (tick >= visible.start && tick <= visible.end) {
      pan.current = { grabTick: tick - visible.start };
    } else {
      pan.current = { grabTick: span / 2 };
      onPan(Math.max(0, tick - span / 2), true);
    }
  };
  const lanesMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (zoomBox && e.currentTarget.hasPointerCapture(e.pointerId)) {
      setZoomBox({ ...zoomBox, x1: e.clientX - e.currentTarget.getBoundingClientRect().left });
      return;
    }
    if (!pan.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    onPan(Math.max(0, tickAt(e) - pan.current.grabTick), false);
  };
  const lanesUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pan.current = null;
    if (!zoomBox) return;
    const w = e.currentTarget.getBoundingClientRect().width;
    const at = (x: number) => t0 + (x / w) * total;
    if (Math.abs(zoomBox.x1 - zoomBox.x0) > 8) {
      const a = at(Math.min(zoomBox.x0, zoomBox.x1));
      setZoom(a, at(Math.max(zoomBox.x0, zoomBox.x1)) - a);
    } else {
      // A click: twice as close (Alt: twice as far) around that point.
      const tick = at(zoomBox.x0);
      const span = zoomBox.out ? total * 2 : total / 2;
      setZoom(tick - (zoomBox.x0 / w) * span, span);
    }
    setZoomBox(null);
  };
  // Over the lanes: Ctrl + wheel zooms around the mouse; Shift + wheel (or sideways) moves in time.
  const lanesWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    if (e.ctrlKey || e.metaKey) {
      const span = total * Math.exp(e.deltaY * 0.002);
      const tick = t0 + frac * total;
      setZoom(tick - frac * span, span);
    } else if (z && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
      const d = e.shiftKey ? e.deltaY || e.deltaX : e.deltaX;
      setZoom(t0 + (d / rect.width) * total, total);
    }
  };

  // Headers: drag to reorder (the header follows the mouse; the line shows where it will land).
  const targetIndex = (d: HeaderDrag) => {
    const from = tracks.findIndex((tr) => tr.id === d.id);
    return Math.max(0, Math.min(tracks.length - 1, from + Math.round(d.dy / laneHeight)));
  };
  const headerDown = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, input, .fader, .mixval")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id, y0: e.clientY, dy: 0, moved: false });
  };
  const headerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dy) <= 3) return;
    setDrag({ ...drag, dy, moved: true });
  };
  const headerUp = (id: string) => {
    if (!drag) return;
    if (drag.moved) actions.moveTrack(id, targetIndex(drag));
    else onSelectTrack(id);
    setDrag(null);
  };

  const dropAt = drag?.moved ? targetIndex(drag) : null;
  const dragFrom = drag ? tracks.findIndex((tr) => tr.id === drag.id) : -1;

  return (
    <section className="arr" aria-label={t("arrangement")} style={height !== null ? { height, overflowY: "auto" } : undefined}>
      <div className={soundOver === "new" ? "thdrs dropnew" : "thdrs"} {...soundDrop(null)}>
        {!compact && (
          <Splitter
            dir="col"
            className="hdrsplit"
            value={view.state.headerWidth}
            min={140}
            max={480}
            sign={1}
            label={t("splitHeaders")}
            onChange={(w) => view.set({ headerWidth: w })}
            onReset={() => view.set({ headerWidth: LAYOUT_DEFAULTS.headerWidth })}
          />
        )}
        <div className="strip" />
        {tracks.map((tr, i) => {
          const dragging = drag?.moved && drag.id === tr.id;
          const typing = actions.typing?.kind === "trackName" && actions.typing.id === tr.id;
          return (
            <div key={tr.id}>
              {dropAt === i && dropAt < dragFrom && <div className="dropline" />}
              <div
                className={(dragging ? "lh thdr dragging" : "lh thdr") + (soundOver === tr.id ? " dropsnd" : "")}
                {...soundDrop(tr.id)}
                style={dragging ? { transform: `translateY(${drag!.dy}px)` } : undefined}
                title={tr.name}
                onPointerDown={(e) => headerDown(e, tr.id)}
                onPointerMove={headerMove}
                onPointerUp={() => headerUp(tr.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  actions.trackMenu(tr.id, e.clientX, e.clientY);
                }}
                onDoubleClick={(e) => !(e.target as HTMLElement).closest("button, .tmix") && actions.type({ kind: "trackName", id: tr.id })}
              >
                <div className="trow">
                  <span className="tchip" style={{ background: colors.get(tr.id) }} />
                  {typing ? (
                    <InlineEdit className="track" value={tr.name} onCommit={(v) => (actions.renameTrack(tr.id, v), actions.type(null))} onCancel={() => actions.type(null)} />
                  ) : (
                    <span className={tr.id === active?.id ? "tname on" : "tname"}>{tr.name}</span>
                  )}
                  <span className="ms">
                    <button
                      className={tr.mute ? "msb on" : "msb"}
                      aria-label={t("mute")}
                      title={t("mute")}
                      aria-pressed={tr.mute}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle(tr.id, "mute");
                      }}
                    >
                      M
                    </button>
                    <button
                      className={tr.solo ? "msb on" : "msb"}
                      aria-label={t("solo")}
                      title={t("solo")}
                      aria-pressed={tr.solo}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle(tr.id, "solo");
                      }}
                    >
                      S
                    </button>
                  </span>
                </div>
                {!compact && (
                  <button
                    className="tsnd"
                    title={t("changeSound")}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      actions.openSounds(tr.id);
                    }}
                  >
                    <SoundOriginIcon origin={actions.soundOrigin(tr)} />
                    <span>{tr.output === "external" ? t("outputDawChannel", { ch: tr.channel + 1 }) : actions.soundLabel(tr)}</span>
                  </button>
                )}
                {!compact && <TrackMix track={tr} />}
              </div>
              {dropAt === i && dropAt > dragFrom && <div className="dropline" />}
            </div>
          );
        })}
        <div className="addtrack">
          <button
            disabled={!actions.canAddTrack()}
            title={actions.canAddTrack() ? t("addTrack") : t("tracksFull")}
            aria-label={t("addTrack")}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              actions.paletteMenu(r.left, r.bottom + 4, (choice) => void actions.addTrack(choice));
            }}
          >
            {t("addTrack")}
          </button>
        </div>
      </div>
      <div
        className="lanes"
        ref={boxRef}
        onWheel={lanesWheel}
        onDragOver={(e) => {
          if (!dragsSound(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          const id = laneTrack(e)?.id ?? "new";
          if (soundOver !== id) setSoundOver(id);
        }}
        onDragLeave={() => setSoundOver(null)}
        onDrop={(e) => {
          if (!dragsSound(e)) return;
          e.preventDefault();
          setSoundOver(null);
          const item = soundFrom(e);
          const track = laneTrack(e);
          if (!item) return;
          if (track) actions.applySound(track.id, item);
          else void actions.addTrackWithSound(item);
        }}
      >
        {zoomBox && Math.abs(zoomBox.x1 - zoomBox.x0) > 2 && (
          <div className="zoombox" style={{ left: Math.min(zoomBox.x0, zoomBox.x1), width: Math.abs(zoomBox.x1 - zoomBox.x0) }} />
        )}
        <canvas ref={canvasRef} style={tool === "zoom" ? { cursor: zoomBox?.out ? "zoom-out" : "zoom-in" } : undefined} onPointerDown={lanesDown} onPointerMove={lanesMove} onPointerUp={lanesUp} data-width={size.width} />
        <canvas ref={headRef} className="playhead-layer arrhead" aria-hidden="true" />
        <div className="strip">
          {orderedSections(song).map((s) => {
            const left = ((barStart(song.meter, s.startBar) - t0) / total) * 100;
            const width = ((barStart(song.meter, s.endBar + 1) - barStart(song.meter, s.startBar)) / total) * 100;
            return (
              <span key={s.id} className="secmini" style={{ left: `${left}%`, width: `${width}%` }}>
                {s.name}
              </span>
            );
          })}
        </div>
        <div style={{ height: tracks.length * laneHeight }} />
      </div>
    </section>
  );
}

/**
 * Volume and pan in sight under the track name (H3.2): a fader and its value for each. The value
 * is typed with a double click (volume in dB, pan as C, L30 or R25), like the tempo.
 */
function TrackMix({ track }: { track: Track }) {
  const { t, lang } = useApp();
  const actions = useActions();
  const typing = actions.typing;
  const typingVolume = typing?.kind === "trackVolume" && typing.id === track.id;
  const typingPan = typing?.kind === "trackPan" && typing.id === track.id;
  const volText = formatDb(track.volume, lang);
  const panText = formatPan(track.pan);
  const commitTyped = (field: "volume" | "pan", text: string) => {
    if (actions.typeMix(track.id, field, text)) actions.type(null);
  };
  return (
    <div className={track.mute ? "tmix muted" : "tmix"}>
      <Fader
        className="fvol"
        value={track.volume}
        min={0}
        max={1}
        reset={0.8}
        label={t("volume")}
        valueText={`${volText} dB`}
        onInput={(v) => actions.previewMix(track.id, v, track.pan)}
        onCommit={(v) => actions.setMix(track.id, v, track.pan)}
      />
      {typingVolume ? (
        <InlineEdit className="mixval" value={volText} inputMode="numeric" maxLength={8} title={t("volumeTypeHint")} onCommit={(v) => commitTyped("volume", v)} onCancel={() => actions.type(null)} />
      ) : (
        <span className="mixval mono" title={t("volumeTypeHint")} onDoubleClick={(e) => (e.stopPropagation(), actions.type({ kind: "trackVolume", id: track.id }))}>
          {volText}
        </span>
      )}
      <Fader
        className="fpan"
        bipolar
        value={track.pan}
        min={-1}
        max={1}
        reset={0}
        label={t("pan")}
        valueText={panText}
        onInput={(v) => actions.previewMix(track.id, track.volume, v)}
        onCommit={(v) => actions.setMix(track.id, track.volume, v)}
      />
      {typingPan ? (
        <InlineEdit className="mixval pan" value={panText} maxLength={5} title={t("panTypeHint")} onCommit={(v) => commitTyped("pan", v)} onCancel={() => actions.type(null)} />
      ) : (
        <span className="mixval pan mono" title={t("panTypeHint")} onDoubleClick={(e) => (e.stopPropagation(), actions.type({ kind: "trackPan", id: track.id }))}>
          {panText}
        </span>
      )}
    </div>
  );
}

function barTicksOf(song: Song): number {
  return barTicks(song.meter);
}
