/** Top bar (DIRECCION_ARTISTICA.md, 6.1 item 1): transport, position, tempo, meter, key, title, save state, AI. */
import { useApp, useClock, useSong } from "../context.js";
import { keyName, transportPosition } from "../music.js";
import { LoopIcon, PlayIcon, RecordIcon, StopIcon } from "./Icons.js";

export interface TransportProps {
  playing: boolean;
  recording: boolean;
  looping: boolean;
  /** Tick shown in "Posición": the playhead while playing, the cursor otherwise. */
  position: number;
  onPlay(): void;
  onStop(): void;
  onLoop(): void;
  onRecord(): void;
}

function savedText(t: ReturnType<typeof useApp>["t"], savedAt: number | null, now: number): string {
  if (savedAt === null) return t("saving");
  const s = Math.max(0, Math.round((now - savedAt) / 1000));
  if (s < 2) return t("savedNow");
  if (s < 60) return t("savedSeconds", { n: s });
  if (s < 3600) return t("savedMinutes", { n: Math.floor(s / 60) });
  return t("savedHours", { n: Math.floor(s / 3600) });
}

export function TopBar(props: TransportProps) {
  const { t, lang, replica } = useApp();
  const song = useSong();
  const now = useClock(1000);
  const file = replica.file;
  const bpm = Math.round(60_000_000 / song.tempo);
  const saved = file.error ? t("saveFailed") : file.dirty && file.savedAt === null ? t("saving") : savedText(t, file.savedAt, now);
  return (
    <header className="topbar">
      <div className="tgroup">
        <button className={props.playing ? "ibtn on" : "ibtn"} aria-label={t("play")} title={t("play")} aria-pressed={props.playing} onClick={props.onPlay}>
          <PlayIcon />
        </button>
        <button className="ibtn" aria-label={t("stop")} title={t("stop")} onClick={props.onStop}>
          <StopIcon />
        </button>
        <button className={props.looping ? "ibtn on" : "ibtn"} aria-label={t("loop")} title={t("loop")} aria-pressed={props.looping} onClick={props.onLoop}>
          <LoopIcon />
        </button>
        <button className={props.recording ? "ibtn rec on" : "ibtn rec"} aria-label={t("record")} title={t("record")} aria-pressed={props.recording} onClick={props.onRecord}>
          <RecordIcon />
        </button>
      </div>
      <div className="field">
        <span className="flabel">{t("position")}</span>
        <span className="fval mono">{transportPosition(song.meter, props.position)}</span>
      </div>
      <div className="field">
        <span className="flabel">{t("tempo")}</span>
        <span className="fval mono">{bpm}</span>
      </div>
      <div className="field">
        <span className="flabel">{t("meter")}</span>
        <span className="fval mono">
          {song.meter.numerator}/{song.meter.denominator}
        </span>
      </div>
      <div className="field fhide">
        <span className="flabel">{t("key")}</span>
        <span className="fval">{keyName(song.key, lang)}</span>
      </div>
      <div className="ttl">{song.title}</div>
      <span className={file.error ? "saved err" : "saved"} title={file.error ?? file.path}>
        {saved}
      </span>
      <span className="chip">
        <span className="dot off" />
        {t("aiOff")}
      </span>
    </header>
  );
}
