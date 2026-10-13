/**
 * Context menu (capture 07: 280 px, radius 10, 32 px rows, shortcuts in mono on the right) and
 * the quantize dialog, built with the same tokens.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useApp } from "../context.js";
import type { Editor, MenuItem, QuantizeSettings } from "../editor.js";
import type { GridValue } from "../roll/geometry.js";

function useFit(x: number, y: number): [React.RefObject<HTMLDivElement>, { left: number; top: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(x, innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, innerHeight - r.height - 8)) });
  }, [x, y]);
  return [ref, pos];
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose(): void }) {
  const [ref, pos] = useFit(x, y);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, []);
  return (
    <div className="menu" ref={ref} role="menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="msep" role="separator" />
        ) : it.header ? (
          <div key={i} className="mhead">
            {it.label}
          </div>
        ) : (
          <button key={i} role="menuitem" className={it.active ? "mitem on" : "mitem"} disabled={it.disabled} onClick={it.run}>
            <span>{it.label}</span>
            {it.shortcut && <span className="mkey">{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}

const VALUES: GridValue[] = ["1/4", "1/8", "1/16", "1/4t", "1/8t", "1/16t"];

export function QuantizeDialog({ editor, x, y }: { editor: Editor; x: number; y: number }) {
  const { t } = useApp();
  const [s, setS] = useState<QuantizeSettings>(editor.quantizeSettings);
  const [ref, pos] = useFit(x, y);
  const apply = () => {
    editor.setQuantizeSettings(s);
    editor.closeMenus();
    editor.quantizeSelection(s);
  };
  return (
    <div className="menu qdialog" ref={ref} role="dialog" aria-label={t("quantizeTitle")} style={pos}>
      <div className="mhead">{t("quantizeTitle")}</div>
      <label className="qrow">
        <span>{t("quantizeValue")}</span>
        <select value={s.grid} onChange={(e) => setS({ ...s, grid: e.target.value as GridValue })}>
          {VALUES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="qrow">
        <span>{t("quantizeStrength")}</span>
        <input type="range" min={0} max={100} step={5} value={Math.round(s.strength * 100)} onChange={(e) => setS({ ...s, strength: Number(e.target.value) / 100 })} />
        <span className="mono qval">{Math.round(s.strength * 100)} %</span>
      </label>
      <label className="qrow">
        <input type="checkbox" checked={s.ends} onChange={(e) => setS({ ...s, ends: e.target.checked })} />
        <span>{t("quantizeEnds")}</span>
      </label>
      <div className="qbtns">
        <button className="btn" onClick={() => editor.closeMenus()}>
          {t("cancel")}
        </button>
        <button className="btn pri" onClick={apply}>
          {t("quantizeApply")}
        </button>
      </div>
    </div>
  );
}
