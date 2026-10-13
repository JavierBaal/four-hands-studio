/**
 * Arrangement (DIRECCION_ARTISTICA.md, 6.1 item 2): track headers, sections strip, one lane per
 * track with its notes in miniature, and the rectangle of what the piano roll shows.
 * Clicking a lane makes its track the active one and moves the piano roll there.
 */
import { useEffect, useMemo, useRef } from "react";
import { barStart, orderedSections, orderedTracks } from "@fourhands/core";
import { activeTrack, notesByTrack, trackColors, useApp, useSize, useSong, useView } from "../context.js";
import { arrangementTotal, drawArrangement, prepare } from "../roll/draw.js";
import { SIZE } from "../theme.js";

export interface ArrangementProps {
  compact: boolean;
  /** Ticks currently visible in the piano roll. */
  visible: { start: number; end: number } | null;
  onSelectTrack(id: string): void;
  onJump(tick: number): void;
  onToggle(id: string, field: "mute" | "solo"): void;
}

export function Arrangement({ compact, visible, onSelectTrack, onJump, onToggle }: ArrangementProps) {
  const { t, replica } = useApp();
  const song = useSong();
  const view = useView();
  const tracks = orderedTracks(song);
  const active = activeTrack(song);
  const laneHeight = compact ? SIZE.arrangeLaneCompact : SIZE.arrangeLane;
  const [boxRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colors = useMemo(() => trackColors(song), [replica.version]);
  const byTrack = useMemo(() => notesByTrack(song), [replica.version]);
  const total = arrangementTotal(song);

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

  const onPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const tick = (x / rect.width) * total;
    const lane = Math.floor((y - SIZE.arrangeStrip) / laneHeight);
    const track = tracks[lane];
    if (track && track.id !== active?.id) onSelectTrack(track.id);
    onJump(tick);
  };

  void view;
  return (
    <section className="arr" aria-label={t("arrangement")}>
      <div className="thdrs">
        <div className="strip" />
        {tracks.map((tr) => (
          <div key={tr.id} className="lh thdr" onClick={() => onSelectTrack(tr.id)} title={tr.name}>
            <span className="tchip" style={{ background: colors.get(tr.id) }} />
            <span className={tr.id === active?.id ? "tname on" : "tname"}>{tr.name}</span>
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
        ))}
      </div>
      <div className="lanes" ref={boxRef}>
        <canvas ref={canvasRef} onPointerDown={onPointer} data-width={size.width} />
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
