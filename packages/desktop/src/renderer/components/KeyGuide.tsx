/**
 * Guide of the computer keyboard as a piano (ESPEC_PIANO_ROLL.md, 8.2): a translucent card over the
 * piano roll with the keys, their letters and notes, the octave and the velocity. It lights the
 * keys being held. Shown while piano mode is on; it can be hidden and shown again (the choice is
 * remembered). Clicking a key sounds it.
 */
import { useSyncExternalStore } from "react";
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

export function KeyGuide({ audio }: { audio: AudioLayer }) {
  const { t } = useApp();
  const v = useView();
  useSyncExternalStore(audio.subscribe, audio.getVersion);
  if (!audio.pianoMode || !audio.keyGuide) return null;
  const held = audio.heldKeys();
  const { base, velocity } = audio.keyboard;
  const name = (code: string) => noteName(base + NOTE_KEYS[code]!, v.noteNames);
  const sound = (code: string) => audio.audition(base + NOTE_KEYS[code]!, velocity);
  return (
    <div className="kguide" role="region" aria-label={t("keyGuideTitle")}>
      <div className="kghead">
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
