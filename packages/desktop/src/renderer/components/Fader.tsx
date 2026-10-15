/**
 * A small horizontal fader for volume and pan in the track header (H3.2, after Partita's header:
 * ESTUDIO_COMPETENCIA_PARTITA.md, 4.1). Drawn with the tokens: a 3 px rail, the filled part in the
 * secondary text colour (never amber or blue: those belong to authorship) and an 10 px knob.
 *
 * - Dragging follows the mouse and is heard at once (`onInput`); the song changes on release
 *   (`onCommit`), one undo step. Shift drags finely.
 * - Double click goes back to `reset` (pan: centre; volume: the default 0.8).
 * - Keyboard: arrows (Shift: fine), Home and End; each key is one change.
 * - `bipolar` fills from the centre (pan).
 */
import { useRef, useState } from "react";

export interface FaderProps {
  value: number;
  min: number;
  max: number;
  reset: number;
  bipolar?: boolean;
  label: string;
  valueText: string;
  className?: string;
  onInput(value: number): void;
  onCommit(value: number): void;
}

export function Fader({ value, min, max, reset, bipolar, label, valueText, className, onInput, onCommit }: FaderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<number | null>(null);
  const drag = useRef<{ x0: number; v0: number; fine: boolean } | null>(null);
  const shown = live ?? value;
  const span = max - min;
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const frac = (shown - min) / span;
  const centre = (0 - min) / span;

  const valueAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return clamp(min + ((clientX - r.left) / r.width) * span);
  };
  const set = (v: number) => {
    setLive(v);
    onInput(v);
  };

  return (
    <div
      ref={ref}
      className={className ? `fader ${className}` : "fader"}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(shown * 100) / 100}
      aria-valuetext={valueText}
      title={`${label}: ${valueText}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus();
        // Pressing on the knob grabs it where it is; pressing on the rail jumps there.
        const r = e.currentTarget.getBoundingClientRect();
        const knobX = r.left + frac * r.width;
        const v0 = Math.abs(e.clientX - knobX) <= 7 ? shown : valueAt(e.clientX);
        drag.current = { x0: e.clientX, v0, fine: e.shiftKey };
        set(v0);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const r = e.currentTarget.getBoundingClientRect();
        const scale = e.shiftKey ? 0.15 : 1;
        set(clamp(d.v0 + ((e.clientX - d.x0) / r.width) * span * scale));
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        drag.current = null;
        const v = live ?? value;
        setLive(null);
        onCommit(v);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setLive(null);
        onInput(value);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setLive(null);
        onInput(reset);
        onCommit(reset);
      }}
      onKeyDown={(e) => {
        const step = (e.shiftKey ? 0.01 : 0.05) * span;
        let v: number | null = null;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") v = clamp(value + step);
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") v = clamp(value - step);
        else if (e.key === "Home") v = min;
        else if (e.key === "End") v = max;
        if (v === null) return;
        e.preventDefault();
        e.stopPropagation();
        onInput(v);
        onCommit(v);
      }}
    >
      <span className="frail" />
      {bipolar ? (
        <span className="ffill" style={{ left: `${Math.min(frac, centre) * 100}%`, width: `${Math.abs(frac - centre) * 100}%` }} />
      ) : (
        <span className="ffill" style={{ left: 0, width: `${frac * 100}%` }} />
      )}
      {bipolar && <span className="fcentre" style={{ left: `${centre * 100}%` }} />}
      <span className={live !== null ? "fknob on" : "fknob"} style={{ left: `${frac * 100}%` }} />
    </div>
  );
}
