/**
 * Exportar audio (F2.4, approved sketch bocetos/propuestas/exportar_audio.png, 24/11/2026): what to
 * export and how, then the progress, then the files with their loudness and true peak. File ›
 * Exportar audio… or Ctrl+E open it; Esc, the cross or a click outside close it (not while
 * exporting: the export goes on, and closing the window does not stop it).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { barAt, secondsBetween } from "@fourhands/core";
import { type ExportDefaults, type ExportProgress, type ExportRangeKind, type ExportResult, type WavQuality, WAV_QUALITIES, exportBaseName } from "../../shared/export.js";
import type { Translate } from "../../shared/i18n.js";
import { exportRange } from "../../audio/export-plan.js";
import type { AudioLayer } from "../audio-layer.js";
import { useActions, useApp, useSong } from "../context.js";
import { CloseIcon } from "./Icons.js";

type Stage = { kind: "choose"; problem?: string } | { kind: "running"; progress: ExportProgress | null; mp3: boolean; title: string } | { kind: "done"; result: ExportResult } | { kind: "failed"; cancelled: boolean; error?: string };

/** 72 s → "1:12". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 21 700 000 → "21 MB"; under 10 MB with one decimal. */
export function megabytes(bytes: number, lang: string): string {
  const mb = bytes / 1_000_000;
  return `${mb < 10 ? mb.toLocaleString(lang, { maximumFractionDigits: 1 }) : Math.round(mb).toLocaleString(lang)} MB`;
}

const qualityLabel = (t: Translate, q: WavQuality, lang: string) => t("expQuality", { khz: (q.rate / 1000).toLocaleString(lang), bits: q.bits });

/** "Documentos › Four Hands › Exportaciones": the last three folders of a path. */
function folderLabel(folder: string): string {
  return folder.split(/[\\/]+/).filter(Boolean).slice(-3).join(" › ");
}

const Check = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <path d="M2.5 6.2l2.3 2.3 4.7-5" />
  </svg>
);

export function ExportDialog({ audio }: { audio: AudioLayer }) {
  const { t, bridge, lang } = useApp();
  const actions = useActions();
  const song = useSong();
  useSyncExternalStore(audio.subscribe, audio.getVersion);
  const open = actions.exportOpen;
  const [defaults, setDefaults] = useState<ExportDefaults | null>(null);
  const [range, setRange] = useState<ExportRangeKind>("song");
  const [wav, setWav] = useState<WavQuality>(WAV_QUALITIES[0]!);
  const [wavOn, setWavOn] = useState(true);
  const [mp3, setMp3] = useState(true);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [folder, setFolder] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "choose" });
  const running = stage.kind === "running";
  const first = useRef<HTMLButtonElement>(null);

  // Opening: as it was left, with the song's title.
  useEffect(() => {
    if (!open || running) return;
    setStage({ kind: "choose" });
    setTitle(song.title || t("untitled"));
    if (!song.context.loop) setRange("song");
    void bridge.exportDefaults().then((d) => {
      setDefaults(d);
      setWavOn(d.wav !== null);
      if (d.wav) setWav(d.wav);
      setMp3(d.mp3);
      setArtist(d.artist);
      setFolder(d.folder);
    });
  }, [open]);
  useEffect(() => bridge.onExportProgress((p) => setStage((s) => (s.kind === "running" ? { ...s, progress: p } : s))), []);
  // The AI's export_audio (F2.4, E3): the main process asks for what the engine plays.
  useEffect(
    () =>
      bridge.onExportPlanRequest(({ id, range }) => {
        const made = audio.exportPlan(range);
        bridge.exportPlanReply("plan" in made ? { id, plan: made.plan } : { id, plan: null, error: made.error === "plugins" ? `plugins still loading: ${(made.tracks ?? []).join(", ")}` : made.error });
      }),
    [],
  );
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open, stage.kind]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      actions.openExport(false);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [open]);
  if (!open) return null;

  const close = () => actions.openExport(false);
  const lengthOf = (kind: ExportRangeKind) => {
    const r = exportRange(song, kind);
    return r ? { bars: t("expBars", { from: barAt(song.meter, r.from), to: barAt(song.meter, Math.max(r.from, r.to - 1)) }), seconds: secondsBetween(song, r.from, r.to) } : null;
  };
  const whole = lengthOf("song");
  const loop = lengthOf("loop");
  const engine = audio.engineStatus.state;
  const base = exportBaseName(title);
  const names = [...(wavOn ? [`${base}.wav`] : []), ...(mp3 ? [`${base}.mp3`] : [])];

  const start = async () => {
    if (!wavOn && !mp3) return setStage({ kind: "choose", problem: t("expNeedFormat") });
    const made = audio.exportPlan(range);
    if ("error" in made) {
      const problem = made.error === "plugins" ? t("expWaitPlugins", { tracks: (made.tracks ?? []).join(", ") }) : made.error === "sounds" ? t("expWaitSounds") : made.error === "empty" ? t("expEmpty") : t("expEngineOff");
      return setStage({ kind: "choose", problem });
    }
    setStage({ kind: "running", progress: null, mp3, title: title.trim() || base });
    const result = await bridge.exportAudio({
      range,
      wav: wavOn ? wav : null,
      mp3,
      title: title.trim(),
      artist: artist.trim(),
      folder: defaults && folder === defaults.defaultFolder ? undefined : folder,
      plan: made.plan,
    });
    const error = result.error === "An export is already under way" ? t("expBusy") : /engine (stopped|is not running)/i.test(result.error ?? "") ? t("expEngineFailed") : result.error;
    setStage(result.ok ? { kind: "done", result } : { kind: "failed", cancelled: !!result.cancelled, ...(error ? { error } : {}) });
  };

  return (
    <div className="setveil" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="expdlg" role="dialog" aria-label={t("expTitle")} data-stage={stage.kind}>
        <div className="exphead">
          <h2>{stage.kind === "running" ? t("expRunning", { title: stage.title }) : stage.kind === "done" ? t("expDone") : t("expTitle")}</h2>
          <button className="ibtn" aria-label={t("close")} title={`${t("close")} (Esc)`} onClick={close}>
            <CloseIcon />
          </button>
        </div>

        {stage.kind === "choose" && (
          <>
            <div className="expbody">
              <div className="expsec" role="radiogroup" aria-label={t("expWhat")}>
                <div className="exph">{t("expWhat")}</div>
                <button className={range === "song" ? "expopt on" : "expopt"} role="radio" aria-checked={range === "song"} onClick={() => setRange("song")} ref={first}>
                  <span className="expradio" />
                  <span className="expt">{t("expSong")}</span>
                  {whole && <span className="expm mono">{`${whole.bars} · ${clock(whole.seconds)}`}</span>}
                </button>
                <button className={range === "loop" ? "expopt on" : "expopt"} role="radio" aria-checked={range === "loop"} disabled={!loop} onClick={() => setRange("loop")}>
                  <span className="expradio" />
                  <span className="expt">{t("expLoop")}</span>
                  <span className={loop ? "expm mono" : "expm"}>{loop ? `${loop.bars} · ${clock(loop.seconds)}` : t("expNoLoop")}</span>
                </button>
              </div>

              <div className="expsec">
                <div className="exph">{t("expFormat")}</div>
                <div className={wavOn ? "expcol on" : "expcol"}>
                  <button className="exptop" role="checkbox" aria-checked={wavOn} onClick={() => setWavOn(!wavOn)}>
                    <span className="expcheck">{wavOn && <Check />}</span>
                    <span className="expt">WAV</span>
                  </button>
                  {wavOn && (
                    <>
                      <div className="expseg" role="radiogroup" aria-label="WAV">
                        {WAV_QUALITIES.map((q) => (
                          <button key={q.rate} role="radio" aria-checked={q.rate === wav.rate} className={q.rate === wav.rate ? "expsegb on" : "expsegb"} onClick={() => setWav(q)}>
                            {qualityLabel(t, q, lang)}
                          </button>
                        ))}
                      </div>
                      <p className="exphint">{t("expWavHint")}</p>
                    </>
                  )}
                </div>
                <button className={mp3 ? "expopt on" : "expopt"} role="checkbox" aria-checked={mp3} onClick={() => setMp3(!mp3)}>
                  <span className="expcheck">{mp3 && <Check />}</span>
                  <span className="expt">MP3</span>
                  <span className="expm">320 kbps</span>
                </button>
              </div>

              <div className="expsec">
                <div className="exptwo">
                  <label className="expsec">
                    <span className="exph">{t("expTitleField")}</span>
                    <input className="expinput" value={title} onChange={(e) => setTitle(e.target.value)} spellCheck={false} />
                  </label>
                  <label className="expsec">
                    <span className="exph">{t("expArtist")}</span>
                    <input className="expinput" value={artist} placeholder={t("expArtistPlaceholder")} onChange={(e) => setArtist(e.target.value)} spellCheck={false} />
                  </label>
                </div>
                <p className="exphint">{t("expMetaHint")}</p>
              </div>

              <div className="expsec">
                <div className="exph">{t("expWhere")}</div>
                <div className="expwhere">
                  <span className="exppath" title={folder}>
                    {folderLabel(folder)}
                  </span>
                  <button className="btn" onClick={() => void bridge.exportPickFolder(folder).then((f) => f && setFolder(f))}>
                    {t("expChange")}
                  </button>
                </div>
                {names.length > 0 && <p className="exphint">{t("expSaveAs", { files: names.length === 2 ? t("expAnd", { a: names[0]!, b: names[1]! }) : names[0]! })}</p>}
              </div>

              {engine !== "ready" ? (
                <div className="expnote warn">
                  <span className="dot" />
                  <span>{engine === "missing" ? t("expEngineMissing") : engine === "starting" ? t("expEngineStarting") : engine === "failed" ? t("expEngineFailed") : t("expEngineOff")}</span>
                </div>
              ) : stage.problem ? (
                <div className="expnote warn">
                  <span className="dot" />
                  <span>{stage.problem}</span>
                </div>
              ) : (
                <div className="expnote">
                  <span className="dot" />
                  <span>{t("expNote")}</span>
                </div>
              )}
            </div>
            <div className="expfoot">
              <button className="btn" onClick={close}>
                {t("cancel")}
              </button>
              {engine === "ready" ? (
                <button className="btn pri" disabled={!whole || (!wavOn && !mp3)} onClick={() => void start()}>
                  {t("expGo")}
                </button>
              ) : (
                <button className="btn pri" disabled={engine === "missing" || engine === "starting"} onClick={() => audio.startEngine()}>
                  {t("expStartEngine")}
                </button>
              )}
            </div>
          </>
        )}

        {stage.kind === "running" && (
          <>
            <div className="expbody">
              <div className="expsec">
                <div className="expprog" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(overall(stage) * 100)}>
                  <i style={{ width: `${overall(stage) * 100}%` }} />
                </div>
                <div className="exppline">
                  <span>
                    <b className="mono">{clock(stage.progress?.phase === "render" ? stage.progress.seconds : stage.progress?.total ?? 0)}</b>{" "}
                    <span>{t("expOf", { total: clock(stage.progress?.total ?? whole?.seconds ?? 0) })}</span>
                  </span>
                  {stage.mp3 && wavOn && <span>{t("expThenMp3")}</span>}
                </div>
              </div>
              <ul className="expsteps">
                <li className={step(stage) === 0 ? "now" : step(stage) > 0 ? "past" : ""}>
                  <span className="exps" />
                  {t("expStepRender")}
                </li>
                <li className={step(stage) === 1 ? "now" : step(stage) > 1 ? "past" : ""}>
                  <span className="exps" />
                  {t("expStepMeasure")}
                </li>
                {stage.mp3 && (
                  <li className={step(stage) === 2 ? "now" : ""}>
                    <span className="exps" />
                    {t("expStepMp3")}
                  </li>
                )}
              </ul>
              <p className="exphint">{t("expRunningHint")}</p>
            </div>
            <div className="expfoot">
              <button className="btn" onClick={() => bridge.exportCancel()} ref={first}>
                {t("expCancel")}
              </button>
            </div>
          </>
        )}

        {stage.kind === "done" && (
          <>
            <div className="expbody">
              <ul className="expfiles">
                {stage.result.files.map((f) => (
                  <li key={f.path}>
                    <span className="expname" title={f.path}>
                      {f.path.split(/[\\/]/).pop()}
                    </span>
                    <span className="expm mono">{`${f.format === "wav" ? qualityLabel(t, wav, lang) : "320 kbps"} · ${megabytes(f.bytes, lang)}`}</span>
                  </li>
                ))}
              </ul>
              <div className="expmeas">
                <div className="expmcard">
                  <div className="expv mono">
                    {stage.result.lufs.toLocaleString(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace("-", "−")}
                    <small>LUFS</small>
                  </div>
                  <div className="expk">{t("expLoudness")}</div>
                </div>
                <div className="expmcard">
                  <div className="expv mono">
                    {stage.result.truePeak.toLocaleString(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace("-", "−")}
                    <small>dBTP</small>
                  </div>
                  <div className="expk">{t("expPeak")}</div>
                </div>
              </div>
              <p className="exphint">{t("expRefHint")}</p>
            </div>
            <div className="expfoot">
              <button className="btn" onClick={close}>
                {t("close")}
              </button>
              <button className="btn pri" ref={first} onClick={() => stage.result.files[0] && bridge.exportShow(stage.result.files[0].path)}>
                {t("expShow")}
              </button>
            </div>
          </>
        )}

        {stage.kind === "failed" && (
          <>
            <div className="expbody">
              <div className="expnote warn">
                <span className="dot" />
                <span>{stage.cancelled ? t("expCancelled") : `${t("expFailed")}${stage.error ? `: ${stage.error}` : ""}`}</span>
              </div>
            </div>
            <div className="expfoot">
              <button className="btn" onClick={close}>
                {t("close")}
              </button>
              <button className="btn pri" ref={first} onClick={() => setStage({ kind: "choose" })}>
                {t("expTryAgain")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 0: rendering, 1: measuring (the tail and the last readings), 2: the MP3. */
function step(s: Extract<Stage, { kind: "running" }>): number {
  if (s.progress?.phase === "mp3") return 2;
  return s.progress && s.progress.fraction >= 0.99 ? 1 : 0;
}

/** One bar for both phases: the render is most of it, the MP3 the last part. */
function overall(s: Extract<Stage, { kind: "running" }>): number {
  const p = s.progress;
  if (!p) return 0;
  const renderShare = s.mp3 ? 0.85 : 1;
  return p.phase === "render" ? p.fraction * renderShare : renderShare + p.fraction * (1 - renderShare);
}

