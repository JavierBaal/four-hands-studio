/**
 * Top bar (DIRECCION_ARTISTICA.md, 6.1 item 1): transport, position, tempo, meter, key, title,
 * save state, AI. Plus, with the same tokens: the computer keyboard as a piano (ESPEC_PIANO_ROLL.md,
 * 8.2) and the recording chip of capture 07.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { AudioLayer } from "../audio-layer.js";
import { activeTrack, useActions, useApp, useClock, useSong } from "../context.js";
import { InlineEdit } from "./InlineEdit.js";
import { modLabel } from "../editor.js";
import { keyName, noteName, transportPosition } from "../music.js";
import { KeyboardIcon, LoopIcon, PlayIcon, RecordIcon, StopIcon } from "./Icons.js";

function savedText(t: ReturnType<typeof useApp>["t"], savedAt: number | null, now: number): string {
  if (savedAt === null) return t("saving");
  const s = Math.max(0, Math.round((now - savedAt) / 1000));
  if (s < 2) return t("savedNow");
  if (s < 60) return t("savedSeconds", { n: s });
  if (s < 3600) return t("savedMinutes", { n: Math.floor(s / 60) });
  return t("savedHours", { n: Math.floor(s / 3600) });
}

/** The position field follows the playhead at ~15 frames per second while playing. */
function Position({ audio }: { audio: AudioLayer }) {
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
  return <span className="fval mono">{transportPosition(song.meter, tick ?? song.context.cursor)}</span>;
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
  const bpm = Math.round(60_000_000 / song.tempo);
  const recording = audio.take !== null;
  const sound =
    audio.status === "loading" ? t("soundLoading") : audio.status === "none" ? t("soundMissing") : audio.status === "error" ? t("soundFailed") : null;
  const saved = sound ?? (file.error ? t("saveFailed") : savedText(t, file.savedAt, now));
  const track = activeTrack(song);
  return (
    <header className="topbar">
      <div className="tgroup">
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
        {actions.typing?.kind === "tempo" ? (
          <InlineEdit
            className="field"
            value={String(bpm)}
            inputMode="numeric"
            maxLength={3}
            title={t("tempo")}
            onCommit={(v) => (actions.setTempo(Number(v.replace(",", "."))), actions.type(null))}
            onCancel={() => actions.type(null)}
          />
        ) : (
          <button className="fbtn" title={t("tempo")} onClick={() => actions.type({ kind: "tempo" })}>
            <span className="fval mono">{bpm}</span>
          </button>
        )}
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
        <button
          className="fbtn"
          title={t("key")}
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            actions.keyMenu(r.left, r.bottom + 4);
          }}
        >
          <span className="fval">{keyName(song.key, lang)}</span>
        </button>
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
      <span className={file.error || audio.status === "error" ? "saved err" : "saved"} title={file.error ?? file.path}>
        {saved}
      </span>
      <span className="chip">
        <span className="dot off" />
        {t("aiOff")}
      </span>
    </header>
  );
}
