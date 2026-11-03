/**
 * Top bar (DIRECCION_ARTISTICA.md, 6.1 item 1): transport, position, tempo, meter, key, title,
 * save state, AI. Plus, with the same tokens: the computer keyboard as a piano (ESPEC_PIANO_ROLL.md,
 * 8.2) and the recording chip of capture 07.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { AudioLayer } from "../audio-layer.js";
import type { FileState } from "../../shared/protocol.js";
import { activeTrack, useActions, useApp, useClock, useSong } from "../context.js";
import { AiChip } from "./AiPresence.js";
import { InlineEdit } from "./InlineEdit.js";
import { modLabel } from "../editor.js";
import { keyName, noteName, transportPosition } from "../music.js";
import { GearIcon, KeyboardIcon, LoopIcon, PlayIcon, RecordIcon, StopIcon, ToStartIcon } from "./Icons.js";

/**
 * The state of the file, not a clock (Fran, 15/10/2026: "Guardado hace 12 min" read as "not saved
 * for 12 minutes", when it meant "nothing changed for 12 minutes"). The time goes in the tooltip.
 */
function savedText(t: ReturnType<typeof useApp>["t"], file: FileState, now: number): string {
  if (file.dirty || file.savedAt === null) return t("saving");
  return now - file.savedAt < 2500 ? t("savedJust") : t("savedAll");
}

/** How long «Audio cortado» stays after a cut. */
const CUT_SHOWN_MS = 4000;

/**
 * F2.2 parte B: the engine's load (DIRECCION_ARTISTICA.md, 13, 03/11/2026). Discreet, by «Guardado…»;
 * amber from 70 %; «Audio cortado» for a few seconds when the audio was cut; only the bar at 880 px.
 * Only while the engine runs (its load is read every second).
 */
function LoadIndicator({ audio }: { audio: AudioLayer }) {
  const { t } = useApp();
  useSyncExternalStore(audio.subscribe, audio.getVersion);
  const [now, setNow] = useState(() => Date.now());
  const load = audio.engineLoad;
  const cutAt = audio.lastDropoutAt;
  useEffect(() => {
    if (!cutAt) return;
    const left = cutAt + CUT_SHOWN_MS - Date.now();
    if (left <= 0) return;
    const id = setTimeout(() => setNow(Date.now()), left + 50);
    return () => clearTimeout(id);
  }, [cutAt]);
  if (!load) return null;
  const avg = Math.min(100, Math.round(load.avgLoad * 100));
  const cut = cutAt > 0 && Math.max(now, Date.now()) - cutAt < CUT_SHOWN_MS;
  const hot = avg >= 70;
  const title = cut ? t("loadCutTitle") : t("loadTitle", { avg, max: Math.min(999, Math.round(load.maxLoad * 100)) });
  return (
    <span className={`load${hot ? " hot" : ""}${cut ? " cut" : ""}`} title={title} role="status">
      <span className="loadtxt">{cut ? t("loadCut") : t("loadLabel")}</span>
      <span className="loadbar" aria-hidden="true">
        <span style={{ width: `${Math.max(2, avg)}%` }} />
      </span>
      {!cut && <span className="loadtxt">{avg} %</span>}
    </span>
  );
}

/** Where the user is: the playhead while playing (~15 times a second), else the cursor. */
function usePlace(audio: AudioLayer): number {
  const song = useSong();
  const [tick, setTick] = useState<number | null>(null);
  useSyncExternalStore(audio.subscribe, audio.getVersion);
  useEffect(() => {
    if (!audio.player.playing) {
      setTick(null);
      return;
    }
    const id = setInterval(() => setTick(audio.player.position()), 66);
    return () => clearInterval(id);
  }, [audio.player.playing]);
  return tick ?? song.context.cursor;
}

/** The position field follows the playhead. */
function Position({ audio }: { audio: AudioLayer }) {
  const song = useSong();
  return <span className="fval mono">{transportPosition(song.meter, usePlace(audio))}</span>;
}

/** Tempo and key where the user is (H4): with changes along the song, they follow the playhead. */
function TempoField({ audio }: { audio: AudioLayer }) {
  const { t } = useApp();
  const actions = useActions();
  const song = useSong();
  const place = usePlace(audio);
  const bpm = Math.round(actions.tempoAt(place));
  const steady = (song.tempoChanges ?? []).length === 0;
  const hint = steady ? t("tempo") : t("tempoAtHint", { bpm: Math.round(60_000_000 / song.tempo) });
  return actions.typing?.kind === "tempo" ? (
    <InlineEdit
      className="field"
      value={String(bpm)}
      inputMode="numeric"
      maxLength={3}
      title={hint}
      onCommit={(v) => (actions.setTempoAt(place, Number(v.replace(",", "."))), actions.type(null))}
      onCancel={() => actions.type(null)}
    />
  ) : (
    <button className="fbtn" title={hint} onClick={() => actions.type({ kind: "tempo" })}>
      <span className="fval mono">{bpm}</span>
    </button>
  );
}

function KeyField({ audio }: { audio: AudioLayer }) {
  const { t, lang } = useApp();
  const actions = useActions();
  const song = useSong();
  const place = usePlace(audio);
  const hint = (song.keyChanges ?? []).length === 0 ? t("key") : t("keyAtHint");
  return (
    <button
      className="fbtn"
      title={hint}
      aria-haspopup="menu"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        actions.keyMenu(r.left, r.bottom + 4, place);
      }}
    >
      <span className="fval">{keyName(actions.keyAt(place), lang)}</span>
    </button>
  );
}

/** "Grabando en Piano · entrada 2… 1…" (capture 07), refreshed while it counts in. */
function RecordingChip({ audio, track }: { audio: AudioLayer; track: string }) {
  const { t } = useApp();
  const [left, setLeft] = useState(audio.player.countInBeatsLeft());
  useEffect(() => {
    const id = setInterval(() => setLeft(audio.player.countInBeatsLeft()), 50);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="chip">
      <span className="dot" style={{ background: "var(--rec)" }} />
      {t("recordingIn", { track })}
      {left > 0 && <> · {t("countIn", { n: left })}</>}
    </span>
  );
}

export function TopBar({ audio }: { audio: AudioLayer }) {
  const { t, lang, replica, view } = useApp();
  const actions = useActions();
  const song = useSong();
  const now = useClock(1000);
  useSyncExternalStore(audio.subscribe, audio.getVersion);
  const p = audio.player;
  const file = replica.file;
  const recording = audio.take !== null;
  const sound =
    audio.status === "loading" ? t("soundLoading") : audio.status === "none" ? t("soundMissing") : audio.status === "error" ? t("soundFailed") : null;
  const saved = sound ?? (file.error ? t("saveFailed") : savedText(t, file, now));
  const track = activeTrack(song);
  return (
    <header className="topbar">
      <div className="tgroup">
        <button className="ibtn" aria-label={t("toStart")} title={`${t("toStart")} (${t("homeKey")})`} onClick={() => audio.toStart()}>
          <ToStartIcon />
        </button>
        <button className={p.playing && !recording ? "ibtn on" : "ibtn"} aria-label={t("play")} title={t("play")} aria-pressed={p.playing} onClick={() => audio.playStop()}>
          <PlayIcon />
        </button>
        <button className="ibtn" aria-label={t("stop")} title={t("stop")} onClick={() => audio.stop()}>
          <StopIcon />
        </button>
        <button className={song.context.loop ? "ibtn on" : "ibtn"} aria-label={t("loop")} title={t("loop")} aria-pressed={!!song.context.loop} onClick={() => audio.toggleLoop()}>
          <LoopIcon />
        </button>
        <button className={recording ? "ibtn rec on" : "ibtn rec"} aria-label={t("record")} title={`${t("record")} (R)`} aria-pressed={recording} onClick={() => audio.toggleRecord()}>
          <RecordIcon />
        </button>
        <button
          className={audio.pianoMode ? "ibtn on" : "ibtn"}
          aria-label={t("pianoKeys")}
          title={t("pianoKeysHelp", { mod: modLabel })}
          aria-pressed={audio.pianoMode}
          onClick={() => audio.togglePiano()}
        >
          <KeyboardIcon />
        </button>
      </div>
      {audio.pianoMode && (
        <span className="chip" title={t("pianoKeysHelp", { mod: modLabel })}>
          <span className="dot u" />
          <span className="mono">{t("pianoKeysOn", { note: noteName(audio.keyboard.base, view.state.noteNames), vel: audio.keyboard.velocity })}</span>
        </span>
      )}
      {audio.pianoMode && (
        <button
          className={audio.keyGuide ? "chip chipbtn on" : "chip chipbtn"}
          aria-pressed={audio.keyGuide}
          title={audio.keyGuide ? t("keyGuideHide") : t("keyGuideShow")}
          onClick={() => audio.toggleGuide()}
        >
          {t("keyGuide")}
        </button>
      )}
      {recording && (
        <>
          <RecordingChip audio={audio} track={track?.name ?? ""} />
          <button className={p.metronome ? "chip chipbtn on" : "chip chipbtn"} aria-pressed={p.metronome} onClick={() => audio.toggleMetronome()}>
            {t("metronome")}
          </button>
        </>
      )}
      <div className="field">
        <span className="flabel">{t("position")}</span>
        <Position audio={audio} />
      </div>
      <div className="field">
        <span className="flabel">{t("tempo")}</span>
        <TempoField audio={audio} />
      </div>
      <div className="field">
        <span className="flabel">{t("meter")}</span>
        <button
          className="fbtn"
          title={t("meter")}
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            actions.meterMenu(r.left, r.bottom + 4);
          }}
        >
          <span className="fval mono">
            {song.meter.numerator}/{song.meter.denominator}
          </span>
        </button>
      </div>
      <div className="field fhide">
        <span className="flabel">{t("key")}</span>
        <KeyField audio={audio} />
      </div>
      {actions.typing?.kind === "title" ? (
        <div className="ttl">
          <InlineEdit className="title" value={song.title} onCommit={(v) => (actions.setTitle(v), actions.type(null))} onCancel={() => actions.type(null)} />
        </div>
      ) : (
        <div className="ttl" onDoubleClick={() => actions.type({ kind: "title" })}>
          {song.title}
        </div>
      )}
      <LoadIndicator audio={audio} />
      <span className={file.error || audio.status === "error" ? "saved err" : "saved"} title={file.error ?? (file.savedAt !== null ? t("savedTitle", { time: new Date(file.savedAt).toLocaleTimeString(lang === "es" ? "es-ES" : "en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }), path: file.path }) : file.path)}>
        {saved}
      </span>
      <button className="ibtn gear" aria-label={t("setTitle")} title={`${t("setTitle")} (${modLabel}+,)`} aria-pressed={actions.settings !== null} onClick={() => actions.openSettings(actions.settings ? null : "ai")}>
        <GearIcon />
      </button>
      <AiChip />
    </header>
  );
}
