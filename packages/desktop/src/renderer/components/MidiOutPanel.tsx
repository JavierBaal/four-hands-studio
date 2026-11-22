/**
 * "Salida MIDI" (H4, 20/10/2026): send some tracks to Studio One (or any DAW) so they sound
 * with the user's libraries. The port, whether it is there, which channel each track goes out on
 * (and where each one sounds, switchable here), and the steps on the other side. Same card as
 * Ajustes › MIDI.
 */
import { useSyncExternalStore } from "react";
import type { AudioLayer } from "../audio-layer.js";
import { useActions, useApp, useSong } from "../context.js";

export function MidiSettings({ audio }: { audio: AudioLayer }) {
  const { t, bridge } = useApp();
  const actions = useActions();
  const song = useSong();
  useSyncExternalStore(audio.subscribe, audio.getVersion);
  const status = audio.outStatus;
  const ports = audio.outName && !audio.outPorts.includes(audio.outName) ? [...audio.outPorts, audio.outName] : audio.outPorts;
  const tracks = song.trackOrder.map((id) => song.tracks[id]!).filter(Boolean);
  return (
    <div className="midiout">
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
      </div>
    </div>
  );
}
