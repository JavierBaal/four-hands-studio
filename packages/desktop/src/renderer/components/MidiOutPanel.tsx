/**
 * "Salida MIDI" (H4, Fran 20/10/2026): send some tracks to Studio One (or any DAW) so they sound
 * with the user's libraries. The port, whether it is there, which channel each track goes out on
 * (and where each one sounds, switchable here), and the steps on the other side. Same card as
 * "Get more sounds"; Esc or a click outside closes it.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { AudioLayer } from "../audio-layer.js";
import { useActions, useApp, useSong } from "../context.js";

export function MidiOutPanel({ audio }: { audio: AudioLayer }) {
  const { t, bridge } = useApp();
  const actions = useActions();
  const song = useSong();
  const ref = useRef<HTMLDivElement>(null);
  useSyncExternalStore(audio.subscribe, audio.getVersion);
  const open = actions.midiOut;
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) actions.openMidiOut(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      actions.openMidiOut(false);
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);
  if (!open) return null;
  const status = audio.outStatus;
  const ports = audio.outName && !audio.outPorts.includes(audio.outName) ? [...audio.outPorts, audio.outName] : audio.outPorts;
  const tracks = song.trackOrder.map((id) => song.tracks[id]!).filter(Boolean);
  return (
    <div className="menu qdialog midiout" ref={ref} role="dialog" aria-label={t("midiOutTitle")}>
      <div className="mhead">{t("midiOutTitle")}</div>
      <p className="mointro">{t("midiOutIntro")}</p>
      <div className="moport">
        <label htmlFor="mo-port">{t("midiOutPort")}</label>
        <select id="mo-port" value={audio.outName ?? ""} onChange={(e) => void audio.chooseOutPort(e.target.value || null)}>
          <option value="">{t("midiOutNone")}</option>
          {ports.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <p className={`mostatus ${status}`} role="status">
        <span className="dot" />
        {status === "ready" ? t("midiOutReady", { port: audio.outName! }) : status === "missing" ? t("midiOutMissing", { port: audio.outName! }) : ports.length ? t("midiOutChoose") : t("midiOutNoPorts")}
      </p>
      <div className="mhead">{t("midiOutChannels")}</div>
      <ul className="mochans">
        {tracks.map((tr) => {
          const out = tr.output === "external";
          return (
            <li key={tr.id}>
              <span className="moch">{t("midiOutChannel", { ch: tr.channel + 1 })}</span>
              <span className="moname" title={tr.name}>
                {tr.name}
              </span>
              <span className="seg small" role="radiogroup" aria-label={t("trackMenuOutput")}>
                <button role="radio" aria-checked={!out} className={out ? "segb" : "segb on"} onClick={() => actions.setOutput(tr.id, "internal")}>
                  Four Hands
                </button>
                <button role="radio" aria-checked={out} className={out ? "segb on" : "segb"} onClick={() => actions.setOutput(tr.id, "external")}>
                  {t("outputDawShort")}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mhead">{t("midiOutStepsTitle")}</div>
      <ol className="mosteps">
        <li>{t("midiOutStep1")}</li>
        <li>{t("midiOutStep2")}</li>
        <li>{t("midiOutStep3")}</li>
        <li>{t("midiOutStep4")}</li>
      </ol>
      <p className="hint">{t("midiOutHint")}</p>
      <div className="qbtns">
        <button className="btn" onClick={() => bridge.exportMidi()}>
          {t("midiOutExport")}
        </button>
        <button className="btn pri" onClick={() => actions.openMidiOut(false)}>
          {t("close")}
        </button>
      </div>
    </div>
  );
}
