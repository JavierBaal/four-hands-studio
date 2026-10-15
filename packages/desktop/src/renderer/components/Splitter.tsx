/**
 * A divider between two parts of the window that can be dragged to give one of them more room
 * (Fran, 15/10/2026): arrangement / piano roll, track headers / lanes, piano roll / activity panel.
 * The sizes of DIRECCION_ARTISTICA.md are the starting values; double click goes back to them.
 *
 * Invisible 6 px grip over the existing 1 px border; on hover or while dragging the border lights
 * up in `--line-on`. The new size follows the mouse (nothing jumps).
 */
import { useRef, useState } from "react";

export interface SplitterProps {
  /** "row": a horizontal line dragged up and down; "col": a vertical line dragged sideways. */
  dir: "row" | "col";
  /** The size when the drag starts. */
  value: number;
  min: number;
  max: number;
  /** +1 if dragging right/down makes the size bigger, -1 if it makes it smaller. */
  sign: 1 | -1;
  label: string;
  className?: string;
  onChange(size: number): void;
  onReset(): void;
}

export function Splitter({ dir, value, min, max, sign, label, className, onChange, onReset }: SplitterProps) {
  const start = useRef<{ pos: number; size: number } | null>(null);
  const [active, setActive] = useState(false);
  const clamp = (v: number) => Math.round(Math.max(min, Math.min(max, v)));
  return (
    <div
      className={`split ${dir}${active ? " on" : ""}${className ? ` ${className}` : ""}`}
      role="separator"
      aria-orientation={dir === "row" ? "horizontal" : "vertical"}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={label}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { pos: dir === "row" ? e.clientY : e.clientX, size: value };
        setActive(true);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const d = (dir === "row" ? e.clientY : e.clientX) - s.pos;
        onChange(clamp(s.size + sign * d));
      }}
      onPointerUp={() => {
        start.current = null;
        setActive(false);
      }}
      onPointerCancel={() => {
        start.current = null;
        setActive(false);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onReset();
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        const less = dir === "row" ? "ArrowUp" : "ArrowLeft";
        const more = dir === "row" ? "ArrowDown" : "ArrowRight";
        if (e.key !== less && e.key !== more) return;
        e.preventDefault();
        e.stopPropagation();
        onChange(clamp(value + sign * (e.key === more ? step : -step)));
      }}
    />
  );
}
