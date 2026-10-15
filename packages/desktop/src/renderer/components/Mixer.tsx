/**
 * Volume and pan of a track, in a small floating card (same look as the quantize dialog).
 * Changes apply on release; Esc or a click outside closes it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Track } from "@fourhands/core";
import { useActions, useApp, useSong } from "../context.js";
import { formatDb, formatPan, parseDb, parsePan } from "../../shared/mix.js";
import { InlineEdit } from "./InlineEdit.js";

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
  const { t, lang } = useApp();
  const [typing, setTyping] = useState<"volume" | "pan" | null>(null);
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
  const panText = formatPan(pan);
  const volText = formatDb(volume, lang);
  // H3.2: the value can be typed, like the tempo (volume in dB, pan as C, L30 or R25).
  const typed = (field: "volume" | "pan", text: string) => {
    const v = field === "volume" ? parseDb(text) : parsePan(text);
    if (v === null) return;
    const next = field === "volume" ? { volume: v, pan } : { volume, pan: v };
    if (field === "volume") setVolume(v);
    else setPan(v);
    actions.setMix(track.id, next.volume, next.pan);
    setTyping(null);
  };
  const value = (field: "volume" | "pan", text: string, hint: string) =>
    typing === field ? (
      <InlineEdit className="mixval card" value={text} maxLength={8} title={hint} onCommit={(v) => typed(field, v)} onCancel={() => setTyping(null)} />
    ) : (
      <span className="mono qval mixtype" role="button" tabIndex={0} title={hint} onClick={(e) => (e.preventDefault(), setTyping(field))} onKeyDown={(e) => e.key === "Enter" && setTyping(field)}>
        {text}
      </span>
    );
  return (
    <div className="menu qdialog" ref={ref} role="dialog" aria-label={t("mixTitle")} style={pos}>
      <div className="mhead">
        {t("mixTitle")} · {track.name}
      </div>
      <label className="qrow">
        <span>{t("volume")}</span>
        <input type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(e) => (setVolume(Number(e.target.value) / 100), actions.previewMix(track.id, Number(e.target.value) / 100, pan))} onPointerUp={commit} onKeyUp={commit} />
        {value("volume", `${volText} dB`, t("volumeTypeHint"))}
      </label>
      <label className="qrow">
        <span>{t("pan")}</span>
        <input type="range" min={-100} max={100} value={Math.round(pan * 100)} onChange={(e) => (setPan(Number(e.target.value) / 100), actions.previewMix(track.id, volume, Number(e.target.value) / 100))} onPointerUp={commit} onKeyUp={commit} onDoubleClick={() => (setPan(0), actions.setMix(track.id, volume, 0))} />
        {value("pan", panText, t("panTypeHint"))}
      </label>
      <div className="qbtns">
        <button className="btn" onClick={() => (commit(), actions.closeMixer())}>
          {t("close")}
        </button>
      </div>
    </div>
  );
}
