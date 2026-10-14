/**
 * "Get more sounds" (Fran, 14/10/2026): which formats work, three steps to install a bank and where
 * to find free ones. Same card as the mixer and the quantize dialog; Esc or a click outside closes it.
 * Plus the short notice that confirms banks dropped onto the window.
 */
import { useEffect, useRef } from "react";
import type { AudioLayer } from "../audio-layer.js";
import { useActions, useApp } from "../context.js";

const LINKS = [
  { key: "soundsHelpFreepats", url: "https://freepats.zenvoid.org/" },
  { key: "soundsHelpFluid", url: "https://ftp.osuosl.org/pub/musescore/soundfont/" },
  { key: "soundsHelpList", url: "https://musescore.org/en/handbook/3/soundfonts-and-sfz-files#list" },
] as const;

export function SoundsHelp({ audio }: { audio: AudioLayer }) {
  const { t } = useApp();
  const actions = useActions();
  const ref = useRef<HTMLDivElement>(null);
  const open = actions.soundsHelp;
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) actions.openSoundsHelp(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      actions.openSoundsHelp(false);
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="menu qdialog soundshelp" ref={ref} role="dialog" aria-label={t("soundsHelpTitle")}>
      <div className="mhead">{t("soundsHelpTitle")}</div>
      <p>{t("soundsHelpFormat")}</p>
      <ol>
        <li>{t("soundsHelpStep1")}</li>
        <li>{t("soundsHelpStep2")}</li>
        <li>{t("soundsHelpStep3")}</li>
      </ol>
      <div className="mhead">{t("soundsHelpWhere")}</div>
      <ul>
        {LINKS.map((l) => (
          <li key={l.url}>
            <a
              href={l.url}
              onClick={(e) => {
                e.preventDefault();
                audio.openLink(l.url);
              }}
            >
              {t(l.key)}
            </a>
          </li>
        ))}
      </ul>
      <p className="hint">{t("soundsHelpLicense")}</p>
      <p className="hint">{t("soundsHelpBig")}</p>
      <div className="qbtns">
        <button className="btn" onClick={() => audio.openSoundsFolder()}>
          {t("soundsFolder")}
        </button>
        <button className="btn pri" onClick={() => actions.openSoundsHelp(false)}>
          {t("close")}
        </button>
      </div>
    </div>
  );
}

/** A short message at the bottom of the window (banks added by dropping them). */
export function Notice() {
  const actions = useActions();
  if (!actions.notice) return null;
  return (
    <div className="notice" role="status">
      {actions.notice}
    </div>
  );
}
