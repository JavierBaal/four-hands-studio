/**
 * The side column (ESTUDIO_INTERFAZ_2.md, 5.1–5.2; sketch `interfaz2_1_pista.png`): tabs with icon
 * and name, Pista (the active track's card) and IA (the activity panel). The browser of sounds
 * arrives as a third tab in part 3. Below 1000 px it opens over the piano roll from the rail and
 * closes with Esc or its arrow.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { Track } from "@fourhands/core";
import type { AudioLayer } from "../audio-layer.js";
import { activeTrack, useActions, useApp, useSong, useView } from "../context.js";
import { TRACK_PALETTE, trackColor, trackColorIndex } from "../theme.js";
import type { PanelTab } from "../view.js";
import { ActivityContent } from "./ActivityPanel.js";
import { AiIcon, BankIcon, ChevronRight, KeysIcon, MidiIcon, PlugIcon, TrackIcon, WindowIcon } from "./Icons.js";
import { MixRows } from "./Mixer.js";

/** The icon of where a track's sound comes from (header, card, toolbar). */
export function SoundOriginIcon({ origin }: { origin: "builtin" | "bank" | "plugin" | "daw" }) {
  if (origin === "plugin") return <PlugIcon />;
  if (origin === "bank") return <BankIcon />;
  if (origin === "daw") return <MidiIcon />;
  return <KeysIcon />;
}

export function SidePanel({ audio, compact }: { audio: AudioLayer; compact: boolean }) {
  const { t, view } = useApp();
  const v = useView();
  const open = compact ? v.compactPanel : v.panelOpen;
  useEffect(() => {
    if (!compact || !v.compactPanel) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      view.set({ compactPanel: false });
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [compact, v.compactPanel]);
  if (!open) return null;
  const tab = (id: PanelTab, label: string, Icon: () => JSX.Element) => (
    <button role="tab" aria-selected={v.panelTab === id} className={v.panelTab === id ? `ptab on ${id}` : `ptab ${id}`} title={label} onClick={() => view.set({ panelTab: id })}>
      <Icon />
      <span className="plbl">{label}</span>
    </button>
  );
  return (
    <aside className={compact ? "activity side over" : "activity side"} aria-label={t("sidePanel")}>
      <div className="ptabs" role="tablist" aria-label={t("sidePanel")}>
        {tab("track", t("tabTrack"), TrackIcon)}
        {tab("ai", t("tabAi"), AiIcon)}
        <span className="grow" />
        <button className="ibtn pfold" onClick={() => view.set(compact ? { compactPanel: false } : { panelOpen: false })} aria-label={t("foldPanel")} title={t("foldPanel")}>
          <ChevronRight />
        </button>
      </div>
      <div className="pbody" role="tabpanel">
        {v.panelTab === "track" ? <TrackCard audio={audio} /> : <ActivityContent />}
      </div>
    </aside>
  );
}

/** Pista: everything about the active track in one place, a click away. */
function TrackCard({ audio }: { audio: AudioLayer }) {
  const { t, lang } = useApp();
  const actions = useActions();
  const song = useSong();
  useSyncExternalStore(audio.subscribe, audio.getVersion);
  const track = activeTrack(song);
  if (!track) return <p className="hint">{t("noTrack")}</p>;
  const order = song.trackOrder;
  const i = order.indexOf(track.id);
  const origin = actions.soundOrigin(track);
  const inFh = track.output !== "external";
  const pluginReady = track.output === "plugin" && track.plugin ? audio.pluginReady(track.channel, track.plugin.id) : false;
  return (
    <div className="tcard" data-track={track.id}>
      <div>
        <div className="tchead">
          <span className="tcbar" style={{ background: trackColor(track.color) }} />
          <span className="tcname" title={t("renameHint")} onDoubleClick={() => actions.type({ kind: "trackName", id: track.id })}>
            {track.name}
          </span>
        </div>
        <div className="tcswatches" role="radiogroup" aria-label={t("trackMenuColor")}>
          {TRACK_PALETTE.map((c, n) => (
            <button key={c.hex} role="radio" aria-checked={trackColorIndex(track.color) === n} aria-label={lang === "es" ? c.es : c.en} title={lang === "es" ? c.es : c.en} className={trackColorIndex(track.color) === n ? "sw on" : "sw"} style={{ background: c.hex }} onClick={() => actions.setColor(track.id, n)} />
          ))}
        </div>
      </div>
      <section>
        <p className="ah">{t("cardSound")}</p>
        <div className="card tcsound">
          <span className="tcicon">
            <SoundOriginIcon origin={origin} />
          </span>
          <div className="tcsoundtext">
            <div className="tcsoundname">{actions.soundLabel(track)}</div>
            <div className="hint">{soundSub(track, origin, t, pluginReady, audio)}</div>
          </div>
        </div>
        <div className="tcbtns">
          <button
            className="btn"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              actions.soundMenu(track.id, r.left, r.bottom + 4);
            }}
          >
            {t("cardChange")}
          </button>
          {track.output === "plugin" && track.plugin && (
            <button className="btn" disabled={!pluginReady} onClick={() => void audio.showPlugin(track.channel)}>
              <WindowIcon /> {t("cardOpenWindow")}
            </button>
          )}
        </div>
      </section>
      <section>
        <p className="ah">{t("trackMenuOutput")}</p>
        <div className="seg tcout" role="radiogroup" aria-label={t("trackMenuOutput")}>
          <button role="radio" aria-checked={inFh} className={inFh ? "segb on" : "segb"} onClick={() => actions.setOutput(track.id, "internal")}>
            Four Hands
          </button>
          <button role="radio" aria-checked={!inFh} className={inFh ? "segb" : "segb on"} onClick={() => actions.setOutput(track.id, "external")}>
            <MidiIcon /> {t("outputDawChannel", { ch: track.channel + 1 })}
          </button>
        </div>
        {!inFh && (
          <button className="linkbtn tcsetup" onClick={() => actions.openMidiOut(true)}>
            {t("outputSetup")}
          </button>
        )}
      </section>
      <section>
        <p className="ah">{t("mixTitle")}</p>
        <div className="tcmix">
          <MixRows key={track.id} track={track} />
        </div>
        <p className="hint">{t("cardMixLater")}</p>
      </section>
      <div className="tcfoot">
        <button className="btn" disabled={i <= 0} onClick={() => actions.moveTrack(track.id, i - 1)}>
          ↑ {t("trackMenuUp")}
        </button>
        <button className="btn" disabled={i >= order.length - 1} onClick={() => actions.moveTrack(track.id, i + 1)}>
          ↓ {t("trackMenuDown")}
        </button>
        <button className="btn del" disabled={order.length <= 1} onClick={() => actions.removeTrack(track.id)}>
          {t("trackMenuDelete")}
        </button>
      </div>
    </div>
  );
}

function soundSub(track: Track, origin: string, t: ReturnType<typeof useApp>["t"], pluginReady: boolean, audio: AudioLayer): string {
  if (origin === "daw") return t("cardSubDaw", { ch: track.channel + 1 });
  if (origin === "plugin") {
    if (audio.pluginProblem?.name === track.plugin?.name && !pluginReady) return t("pluginLoadFailed", { plugin: track.plugin!.name });
    return pluginReady ? t("cardSubPlugin") : t("cardSubPluginLoading");
  }
  if (origin === "bank") return t("cardSubBank", { bank: track.sound!.bank.replace(/\.(sf2|sf3|dls)$/i, "") });
  return t("cardSubBuiltin");
}
