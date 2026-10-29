/**
 * Ajustes › Sonido (ESTUDIO_INTERFAZ_2.md): the built-in sound, the banks installed and "Get more
 * sounds" (Fran, 14/10/2026): which formats work, three steps to install a bank and where to find
 * free ones.
 * Plus the short notice that confirms banks dropped onto the window.
 */
import { useSyncExternalStore } from "react";
import type { AudioLayer } from "../audio-layer.js";
import { useActions, useApp } from "../context.js";

const LINKS = [
  { key: "soundsHelpFreepats", url: "https://freepats.zenvoid.org/" },
  { key: "soundsHelpFluid", url: "https://ftp.osuosl.org/pub/musescore/soundfont/" },
  { key: "soundsHelpList", url: "https://musescore.org/en/handbook/3/soundfonts-and-sfz-files#list" },
] as const;

export function SoundSettings({ audio }: { audio: AudioLayer }) {
  const { t } = useApp();
  useSyncExternalStore(audio.subscribe, audio.getVersion);
  const status = audio.status === "ready" ? t("setSoundReady") : audio.status === "loading" ? t("soundLoading") : audio.status === "none" ? t("soundMissing") : t("soundFailed");
  return (
    <div className="soundshelp">
      <p className="setstatus" role="status">
        <span className={audio.status === "ready" ? "dot ok" : "dot off"} />
        {status}
      </p>
      <div className="mhead">{t("setBanks")}</div>
      {audio.banks.length === 0 ? (
        <p className="hint">{t("soundsNone")}</p>
      ) : (
        <ul className="setlist">
          {audio.banks.map((b) => (
            <li key={b.id}>
              <span className="setname">{b.name}</span>
              <span className="setmeta mono">{t("setBankMeta", { presets: b.presets.length, mb: Math.round(b.bytes / 1048576) })}</span>
            </li>
          ))}
        </ul>
      )}
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
