/**
 * Guide of the computer keyboard as a piano (docs/piano-roll.md, 8.2): a translucent card over the
 * piano roll with the keys, their letters and notes, the octave and the velocity. It lights the
 * keys being held. Shown while piano mode is on; it can be hidden and shown again (the choice is
 * remembered). Clicking a key sounds it. Its header drags it anywhere over the piano roll
 * (14/10/2026); the place is remembered and a double click puts it back.
 */
import { useRef, useState, useSyncExternalStore } from "react";
import { NOTE_KEYS } from "../../audio/keyboard.js";
import type { AudioLayer } from "../audio-layer.js";
import { modLabel } from "../editor.js";
import { noteName } from "../music.js";
import { useApp, useView } from "../context.js";

const WHITE = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL"];
/** Black keys and the white key they sit after (index in WHITE). */
const BLACK: [code: string, after: number][] = [
  ["KeyW", 0],
  ["KeyE", 1],
  ["KeyT", 3],
  ["KeyY", 4],
  ["KeyU", 5],
  ["KeyO", 7],
  ["KeyP", 8],
];

const letter = (code: string) => code.slice(3);

interface Offset {
  dx: number;
  dy: number;
}

function loadOffset(): Offset {
  try {
    const o = JSON.parse(localStorage.getItem("fh.keyGuidePos") ?? "null") as Offset | null;
    if (o && Number.isFinite(o.dx) && Number.isFinite(o.dy)) return o;
  } catch {
    /* no storage */
  }
  return { dx: 0, dy: 0 };
}

function saveOffset(o: Offset): void {
  try {
    localStorage.setItem("fh.keyGuidePos", JSON.stringify(o));
  } catch {
    /* no storage: the place lasts this session */
  }
}

export function KeyGuide({ audio }: { audio: AudioLayer }) {
  const { t } = useApp();
  const v = useView();
  useSyncExternalStore(audio.subscribe, audio.getVersion);
  const [offset, setOffset] = useState<Offset>(loadOffset);
  const drag = useRef<{ x: number; y: number; from: Offset; bounds: { minX: number; maxX: number; minY: number; maxY: number } } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  if (!audio.pianoMode || !audio.keyGuide) return null;

  // Dragging by the header: the card follows the mouse and stays inside the piano roll.
  const headDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const el = card.current;
    const area = el?.offsetParent?.getBoundingClientRect();
    if (!el || !area) return;
    const r = el.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      from: offset,
      bounds: { minX: offset.dx + area.left - r.left, maxX: offset.dx + area.right - r.right, minY: offset.dy + area.top - r.top, maxY: offset.dy + area.bottom - r.bottom },
    };
  };
  const headMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const b = d.bounds;
    setOffset({
      dx: Math.max(b.minX, Math.min(b.maxX, d.from.dx + e.clientX - d.x)),
      dy: Math.max(b.minY, Math.min(b.maxY, d.from.dy + e.clientY - d.y)),
    });
  };
  const headUp = () => {
    if (!drag.current) return;
    drag.current = null;
    saveOffset(offset);
  };
  const held = audio.heldKeys();
  const { base, velocity } = audio.keyboard;
  const name = (code: string) => noteName(base + NOTE_KEYS[code]!, v.noteNames);
  const sound = (code: string) => audio.audition(base + NOTE_KEYS[code]!, velocity);
  return (
    <div className={drag.current ? "kguide dragging" : "kguide"} ref={card} role="region" aria-label={t("keyGuideTitle")} style={{ translate: `${offset.dx}px ${offset.dy}px` }}>
      <div
        className="kghead"
        title={t("keyGuideMove")}
        onPointerDown={headDown}
        onPointerMove={headMove}
        onPointerUp={headUp}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          setOffset({ dx: 0, dy: 0 });
          saveOffset({ dx: 0, dy: 0 });
        }}
      >
        <span>{t("keyGuideTitle")}</span>
        <span className="kgexit">{t("keyGuideExit", { mod: modLabel })}</span>
        <button className="kgclose" title={t("keyGuideHide")} aria-label={t("keyGuideHide")} onClick={() => audio.toggleGuide()}>
          ×
        </button>
      </div>
      <div className="kgkeys">
        {WHITE.map((code) => (
          <button key={code} className={held.has(code) ? "kw on" : "kw"} tabIndex={-1} onPointerDown={() => sound(code)}>
            <span className="kgnote">{name(code)}</span>
            <span className="kgletter">{letter(code)}</span>
          </button>
        ))}
        {BLACK.map(([code, after]) => (
          <button key={code} className={held.has(code) ? "kb on" : "kb"} tabIndex={-1} style={{ left: `calc(${after + 1} * var(--kw) - var(--kbw) / 2)` }} onPointerDown={() => sound(code)} title={name(code)}>
            <span className="kgletter">{letter(code)}</span>
          </button>
        ))}
      </div>
      <div className="kgfoot">
        <span className="kgctl">
          <span className="kcap">Z</span>
          <span className="kcap">X</span>
          <span>{t("keyGuideOctave")}</span>
          <span className="mono kgval">
            {noteName(base, v.noteNames)}–{noteName(base + 15, v.noteNames)}
          </span>
        </span>
        <span className="kgctl">
          <span className="kcap">C</span>
          <span className="kcap">V</span>
          <span>{t("keyGuideVelocity")}</span>
          <span className="kgbar" aria-hidden>
            <span style={{ width: `${(velocity / 127) * 100}%` }} />
          </span>
          <span className="mono kgval">{velocity}</span>
        </span>
      </div>
    </div>
  );
}
