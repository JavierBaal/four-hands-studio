/**
 * Volume and pan of a track, in a small floating card (same look as the quantize dialog).
 * Changes apply on release; Esc or a click outside closes it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Track } from "@fourhands/core";
import { useActions, useApp, useSong } from "../context.js";

export function Mixer() {
  const actions = useActions();
  const song = useSong();
  const m = actions.mixer;
  const track = m ? song.tracks[m.trackId] : undefined;
  if (!m || !track) return null;
  // Keyed by track: the sliders start from that track's values each time the card opens.
  return <MixerCard key={`${track.id}:${m.x}:${m.y}`} track={track} x={m.x} y={m.y} />;
}

function MixerCard({ track, x, y }: { track: Track; x: number; y: number }) {
  const { t } = useApp();
  const actions = useActions();
  const [volume, setVolume] = useState(track.volume);
  const [pan, setPan] = useState(track.pan);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const latest = useRef({ volume, pan });
  latest.current = { volume, pan };
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: Math.max(8, Math.min(x, innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, innerHeight - r.height - 8)) });
  }, [x, y]);
  useEffect(() => {
    const close = () => {
      actions.setMix(track.id, latest.current.volume, latest.current.pan);
      actions.closeMixer();
    };
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [track.id]);
  const commit = () => actions.setMix(track.id, volume, pan);
  const panText = pan === 0 ? "C" : pan < 0 ? `L${Math.round(-pan * 100)}` : `R${Math.round(pan * 100)}`;
  return (
    <div className="menu qdialog" ref={ref} role="dialog" aria-label={t("mixTitle")} style={pos}>
      <div className="mhead">
        {t("mixTitle")} · {track.name}
      </div>
      <label className="qrow">
        <span>{t("volume")}</span>
        <input type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(e) => setVolume(Number(e.target.value) / 100)} onPointerUp={commit} onKeyUp={commit} />
        <span className="mono qval">{Math.round(volume * 100)}</span>
      </label>
      <label className="qrow">
        <span>{t("pan")}</span>
        <input type="range" min={-100} max={100} value={Math.round(pan * 100)} onChange={(e) => setPan(Number(e.target.value) / 100)} onPointerUp={commit} onKeyUp={commit} onDoubleClick={() => (setPan(0), actions.setMix(track.id, volume, 0))} />
        <span className="mono qval">{panText}</span>
      </label>
      <div className="qbtns">
        <button className="btn" onClick={() => (commit(), actions.closeMixer())}>
          {t("close")}
        </button>
      </div>
    </div>
  );
}
