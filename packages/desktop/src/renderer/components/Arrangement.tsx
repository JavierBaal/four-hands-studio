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
import { barStart, orderedSections, orderedTracks } from "@fourhands/core";
import { activeTrack, notesByTrack, trackColors, useActions, useApp, useSize, useSong } from "../context.js";
import { arrangementTotal, drawArrangement, prepare } from "../roll/draw.js";
import { SIZE } from "../theme.js";
import { InlineEdit } from "./InlineEdit.js";

export interface ArrangementProps {
  compact: boolean;
  /** Ticks currently visible in the piano roll. */
  visible: { start: number; end: number } | null;
  onSelectTrack(id: string): void;
  /** Puts the left edge of the piano roll at a tick; `animate` for jumps, not for drags. */
  onPan(startTick: number, animate: boolean): void;
  onToggle(id: string, field: "mute" | "solo"): void;
}

interface HeaderDrag {
  id: string;
  y0: number;
  dy: number;
  moved: boolean;
}

export function Arrangement({ compact, visible, onSelectTrack, onPan, onToggle }: ArrangementProps) {
  const { t, replica } = useApp();
  const actions = useActions();
  const song = useSong();
  const tracks = orderedTracks(song);
  const active = activeTrack(song);
  const laneHeight = compact ? SIZE.arrangeLaneCompact : SIZE.arrangeLane;
  const [boxRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colors = useMemo(() => trackColors(song), [replica.version]);
  const byTrack = useMemo(() => notesByTrack(song), [replica.version]);
  const total = arrangementTotal(song);
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
      activeTrackId: active?.id ?? null,
      viewport: visible,
      colors,
    });
  });

  // Lanes: press inside the rectangle to drag it; press elsewhere to jump there (and keep dragging).
  const tickAt = (e: { clientX: number; currentTarget: Element }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return ((e.clientX - rect.left) / rect.width) * total;
  };
  const lanesDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
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
    if (!pan.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    onPan(Math.max(0, tickAt(e) - pan.current.grabTick), false);
  };
  const lanesUp = () => (pan.current = null);

  // Headers: drag to reorder (the header follows the mouse; the line shows where it will land).
  const targetIndex = (d: HeaderDrag) => {
    const from = tracks.findIndex((tr) => tr.id === d.id);
    return Math.max(0, Math.min(tracks.length - 1, from + Math.round(d.dy / laneHeight)));
  };
  const headerDown = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, input")) return;
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
    <section className="arr" aria-label={t("arrangement")}>
      <div className="thdrs">
        <div className="strip" />
        {tracks.map((tr, i) => {
          const dragging = drag?.moved && drag.id === tr.id;
          const typing = actions.typing?.kind === "trackName" && actions.typing.id === tr.id;
          return (
            <div key={tr.id}>
              {dropAt === i && dropAt < dragFrom && <div className="dropline" />}
              <div
                className={dragging ? "lh thdr dragging" : "lh thdr"}
                style={dragging ? { transform: `translateY(${drag!.dy}px)` } : undefined}
                title={tr.name}
                onPointerDown={(e) => headerDown(e, tr.id)}
                onPointerMove={headerMove}
                onPointerUp={() => headerUp(tr.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  actions.trackMenu(tr.id, e.clientX, e.clientY);
                }}
                onDoubleClick={(e) => !(e.target as HTMLElement).closest("button") && actions.type({ kind: "trackName", id: tr.id })}
              >
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
              actions.paletteMenu(r.left, r.bottom + 4, (item) => void actions.addTrack(item));
            }}
          >
            {t("addTrack")}
          </button>
        </div>
      </div>
      <div className="lanes" ref={boxRef}>
        <canvas ref={canvasRef} onPointerDown={lanesDown} onPointerMove={lanesMove} onPointerUp={lanesUp} data-width={size.width} />
        <div className="strip">
          {orderedSections(song).map((s) => {
            const left = (barStart(song.meter, s.startBar) / total) * 100;
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
