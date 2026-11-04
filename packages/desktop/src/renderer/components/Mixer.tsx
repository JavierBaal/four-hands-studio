/**
 * Volume, pan and (H4) reverb send of a track, in a small floating card (same look as the
 * quantize dialog).
 * Changes apply on release; Esc or a click outside closes it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Track, reverbBus, reverbLevel } from "@fourhands/core";
import { useActions, useApp, useSong } from "../context.js";
import { formatDb, formatPan, formatReverb, parseDb, parsePan, parseReverb } from "../../shared/mix.js";
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
  const { t } = useApp();
  const actions = useActions();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const latest = useRef<{ volume: number; pan: number; reverb: number } | null>(null);
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: Math.max(8, Math.min(x, innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, innerHeight - r.height - 8)) });
  }, [x, y]);
  useEffect(() => {
    const close = () => {
      const l = latest.current;
      if (l) actions.setMix(track.id, l.volume, l.pan, l.reverb);
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
  return (
    <div className="menu qdialog" ref={ref} role="dialog" aria-label={t("mixTitle")} style={pos}>
      <div className="mhead">
        {t("mixTitle")} · {track.name}
      </div>
      <MixRows track={track} onValues={(v) => (latest.current = v)} />
      <div className="qbtns">
        <button className="btn" onClick={() => actions.closeMixer()}>
          {t("close")}
        </button>
      </div>
    </div>
  );
}

/**
 * Volume, pan and reverb of a track, each a slider whose value can also be typed: in the mixer
 * card and in the Pista tab (ESTUDIO_INTERFAZ_2.md, 5.2). The sound follows while dragging; the
 * song gets the value on release (one undo step). Values the AI or an undo change come in.
 */
export function MixRows({ track, onValues }: { track: Track; onValues?: (v: { volume: number; pan: number; reverb: number }) => void }) {
  const { t, lang } = useApp();
  const actions = useActions();
  const song = useSong();
  const revNow = reverbLevel(song, track);
  const [typing, setTyping] = useState<"volume" | "pan" | "reverb" | null>(null);
  const [volume, setVolume] = useState(track.volume);
  const [pan, setPan] = useState(track.pan);
  const [reverb, setReverb] = useState(reverbLevel(song, track));
  useEffect(() => {
    setVolume(track.volume);
    setPan(track.pan);
    setReverb(reverbLevel(song, track));
  }, [track.id, track.volume, track.pan, revNow]);
  onValues?.({ volume, pan, reverb });
  const commit = () => actions.setMix(track.id, volume, pan, reverb);
  const panText = formatPan(pan);
  const volText = formatDb(volume, lang);
  // H3.2: the value can be typed, like the tempo (volume in dB, pan as C, L30 or R25, reverb 0–100).
  const typed = (field: "volume" | "pan" | "reverb", text: string) => {
    const v = field === "volume" ? parseDb(text) : field === "pan" ? parsePan(text) : parseReverb(text);
    if (v === null) return;
    const next = { volume, pan, reverb, [field]: v };
    if (field === "volume") setVolume(v);
    else if (field === "pan") setPan(v);
    else setReverb(v);
    actions.setMix(track.id, next.volume, next.pan, next.reverb);
    setTyping(null);
  };
  const value = (field: "volume" | "pan" | "reverb", text: string, hint: string) =>
    typing === field ? (
      <InlineEdit className="mixval card" value={text} maxLength={8} title={hint} onCommit={(v) => typed(field, v)} onCancel={() => setTyping(null)} />
    ) : (
      <span className="mono qval mixtype" role="button" tabIndex={0} title={hint} onClick={(e) => (e.preventDefault(), setTyping(field))} onKeyDown={(e) => e.key === "Enter" && setTyping(field)}>
        {text}
      </span>
    );
  return (
    <>
      <label className="qrow">
        <span>{t("volume")}</span>
        <input type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(e) => (setVolume(Number(e.target.value) / 100), actions.previewMix(track.id, Number(e.target.value) / 100, pan, reverb))} onPointerUp={commit} onKeyUp={commit} />
        {value("volume", `${volText} dB`, t("volumeTypeHint"))}
      </label>
      <label className="qrow">
        <span>{t("pan")}</span>
        <input type="range" min={-100} max={100} value={Math.round(pan * 100)} onChange={(e) => (setPan(Number(e.target.value) / 100), actions.previewMix(track.id, volume, Number(e.target.value) / 100, reverb))} onPointerUp={commit} onKeyUp={commit} onDoubleClick={() => (setPan(0), actions.setMix(track.id, volume, 0, reverb))} />
        {value("pan", panText, t("panTypeHint"))}
      </label>
      {/* The send to the «Reverb» bus (F2.2 parte D); a song whose reverb bus was deleted has none. */}
      {reverbBus(song) && (
      <label className="qrow" title={t("reverbTypeHint")}>
        <span>{t("reverb")}</span>
        <input type="range" min={0} max={100} value={Math.round(reverb * 100)} onChange={(e) => (setReverb(Number(e.target.value) / 100), actions.previewMix(track.id, volume, pan, Number(e.target.value) / 100))} onPointerUp={commit} onKeyUp={commit} onDoubleClick={() => (setReverb(0), actions.setMix(track.id, volume, pan, 0))} />
        {value("reverb", formatReverb(reverb), t("reverbTypeHint"))}
      </label>
      )}
    </>
  );
}
