/**
 * The window of Four Hands' own effects (F2.2 parte C2, Fran 03/11/2026: «ventana flotante»).
 *
 * One at a time, over the app; dragged by its header, it stays where it was left and stays open
 * while you work (Esc or ✕ closes it). Every control is heard while it moves and is one undo step
 * on release; what the AI changes shows here at once.
 * - EQ: its response curve with a point per band (drag: frequency and gain; wheel on a bell: Q;
 *   double click: back to zero, or a cut off), and the values of each band below, typed with a click.
 * - Compressor: its transfer curve, how much it is reducing now, and its six parameters.
 * - Limiter: its three parameters and how much it is reducing now.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type Insert, type ParamDef, findInsert, insertName, kindName, paramDefs, paramText, paramToUnit, parseParamValue, unitToParam } from "@fourhands/core";
import { compressorOut, eqResponse, logFreqs } from "../../shared/effect-curves.js";
import type { AudioLayer } from "../audio-layer.js";
import { useActions, useApp, useSong } from "../context.js";
import { T, trackColor } from "../theme.js";
import { Fader } from "./Fader.js";
import { InlineEdit } from "./InlineEdit.js";
import { CloseIcon } from "./Icons.js";

type Params = Record<string, number>;

export function EffectWindow({ audio }: { audio: AudioLayer }) {
  const actions = useActions();
  const song = useSong();
  const open = actions.effectWindow;
  const found = open ? findInsert(song, open.id) : null;
  // The effect went (removed, undone): the window goes with it.
  useEffect(() => {
    if (open && !found) actions.closeEffectWindow();
  }, [open?.id, !!found]);
  if (!open || !found || found.insert.kind === "plugin") return null;
  return <Window key={found.insert.id} audio={audio} insert={found.insert} target={found.target} />;
}

function Window({ audio, insert, target }: { audio: AudioLayer; insert: Insert; target: string }) {
  const { t, lang } = useApp();
  const actions = useActions();
  const song = useSong();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(actions.effectWindowPos ?? { left: Math.max(16, innerWidth / 2 - 300), top: Math.max(16, innerHeight / 2 - 230) });
  // The values shown: the song's, and while a control moves, the moving ones on top.
  const [live, setLive] = useState<Params | null>(null);
  const params: Params = { ...(insert.params ?? {}), ...(live ?? {}) };
  const preview = (p: Params) => {
    const next = { ...(live ?? {}), ...p };
    setLive(next);
    actions.previewEffectParams(insert.id, next);
  };
  const commit = (p: Params) => {
    setLive(null);
    actions.setEffectParams(insert.id, p);
  };

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos((p) => ({ left: Math.max(8, Math.min(p.left, innerWidth - r.width - 8)), top: Math.max(8, Math.min(p.top, innerHeight - r.height - 8)) }));
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.tagName === "INPUT";
      if (e.key === "Escape" && !typing) {
        e.stopPropagation();
        actions.closeEffectWindow();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);

  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const where = target === "master" ? t("consoleMaster") : (song.tracks[target]?.name ?? "");
  const color = target === "master" ? "var(--text)" : trackColor(song.tracks[target]?.color ?? 0);
  const name = insertName(insert, lang);
  return (
    <div className={`fxwin ${insert.kind}${insert.bypass ? " byp" : ""}`} ref={ref} role="dialog" aria-label={`${name} · ${where}`} style={pos}>
      <div
        className="fxhead"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, left: pos.left, top: pos.top };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const r = ref.current!.getBoundingClientRect();
          const next = { left: Math.max(0, Math.min(innerWidth - r.width, d.left + e.clientX - d.x)), top: Math.max(0, Math.min(innerHeight - 40, d.top + e.clientY - d.y)) };
          setPos(next);
          actions.effectWindowPos = next;
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <span className="dot sq" style={{ background: color }} />
        <span className="fxtitle">
          <b>{name}</b>
          {insert.name && <span className="fxkind"> · {kindName(insert, lang)}</span>}
          <span className="fxwhere"> · {where}</span>
        </span>
        <button className={insert.bypass ? "tgl" : "tgl on"} aria-pressed={!insert.bypass} onClick={() => actions.setEffectBypass(insert.id, !insert.bypass)}>
          {insert.bypass ? t("fxOff") : t("fxOn")}
        </button>
        <button className="ibtn" aria-label={t("close")} title={`${t("close")} (Esc)`} onClick={() => actions.closeEffectWindow()}>
          <CloseIcon />
        </button>
      </div>
      <div className="fxbody">
        {insert.kind === "eq" && <EqView params={params} onPreview={preview} onCommit={commit} />}
        {insert.kind === "compressor" && <CompView audio={audio} id={insert.id} params={params} onPreview={preview} onCommit={commit} />}
        {insert.kind === "limiter" && <LimView audio={audio} id={insert.id} params={params} onPreview={preview} onCommit={commit} />}
      </div>
    </div>
  );
}

interface ViewProps {
  params: Params;
  onPreview(p: Params): void;
  onCommit(p: Params): void;
}

const defOf = (kind: "eq" | "compressor" | "limiter", id: string): ParamDef => paramDefs(kind).find((d) => d.id === id)!;

/** A value shown as text that becomes a field with one click; out of range or unreadable, it stays open. */
function TypedValue({ def, value, onCommit }: { def: ParamDef; value: number; onCommit(v: number): void }) {
  const { t, lang } = useApp();
  const [open, setOpen] = useState(false);
  const [bad, setBad] = useState(false);
  if (open)
    return (
      <InlineEdit
        className={bad ? "fxval bad" : "fxval"}
        value={paramText(def, value, lang).replace(/ (Hz|dB|ms)$/, "")}
        maxLength={12}
        title={`${def.name}: ${paramText(def, def.min, lang)} – ${paramText(def, def.max, lang)}`}
        onCommit={(text) => {
          const v = parseParamValue(def, text);
          if (v === null) {
            setBad(true);
            setOpen(false);
            setTimeout(() => setOpen(true), 0);
            return;
          }
          setBad(false);
          setOpen(false);
          onCommit(v);
        }}
        onCancel={() => (setBad(false), setOpen(false))}
      />
    );
  return (
    <button className="fxval" title={t("fxTypeHint")} onClick={() => setOpen(true)}>
      {paramText(def, value, lang)}
    </button>
  );
}

/** A labelled fader for one parameter (log where it should be), with its value typed with a click. */
function ParamRow({ def, value, onPreview, onCommit }: { def: ParamDef; value: number; onPreview(v: number): void; onCommit(v: number): void }) {
  const { lang } = useApp();
  return (
    <div className="fxrow">
      <span className="fxlabel">{paramLabel(def, lang)}</span>
      <Fader
        className="fxfader"
        value={paramToUnit(def, value)}
        min={0}
        max={1}
        reset={paramToUnit(def, def.default)}
        label={paramLabel(def, lang)}
        valueText={paramText(def, value, lang)}
        onInput={(u) => onPreview(unitToParam(def, u))}
        onCommit={(u) => onCommit(unitToParam(def, u))}
      />
      <TypedValue def={def} value={value} onCommit={onCommit} />
    </div>
  );
}

/** Spanish names for the parameters (the AI and the file keep the English ids). */
const ES_LABELS: Record<string, string> = {
  threshold: "Umbral",
  ratio: "Ratio",
  attack: "Ataque",
  release: "Relajación",
  knee: "Rodilla",
  makeup: "Ganancia",
  gain: "Entrada",
  ceiling: "Techo",
};
function paramLabel(def: ParamDef, lang: "es" | "en"): string {
  return lang === "es" ? (ES_LABELS[def.id] ?? def.name) : def.name;
}

/** How much it reduces now, polled from the engine while the window is open. */
function useReduction(audio: AudioLayer, id: string): number {
  const [db, setDb] = useState(0);
  useEffect(() => {
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void audio
        .reductions([id])
        .then((r) => setDb(r?.[id] ?? 0))
        .finally(() => (busy = false));
    }, 66);
    return () => clearInterval(timer);
  }, [audio, id]);
  return db;
}

/** A vertical meter of gain reduction, 0 to -24 dB from the top. */
function ReductionMeter({ db }: { db: number }) {
  const { t, lang } = useApp();
  const frac = Math.max(0, Math.min(1, db / 24));
  return (
    <div className="fxgr" title={`${t("fxReduction")}: ${db.toFixed(1).replace(".", lang === "es" ? "," : ".")} dB`}>
      <span className="fxgrlbl">{t("fxReduction")}</span>
      <div className="fxgrbar">
        <div style={{ height: `${frac * 100}%` }} />
      </div>
      <span className="fxgrval">{db >= 0.05 ? `−${db.toFixed(1)}`.replace(".", lang === "es" ? "," : ".") : lang === "es" ? "0,0" : "0.0"}</span>
    </div>
  );
}

// --- EQ ------------------------------------------------------------------------------------------

const EQ_W = 760;
const EQ_H = 210;
const EQ_DB = 18;
const F_LO = 20;
const F_HI = 20000;
const xOf = (f: number) => (Math.log(f / F_LO) / Math.log(F_HI / F_LO)) * EQ_W;
const fOf = (x: number) => F_LO * Math.pow(F_HI / F_LO, Math.max(0, Math.min(1, x / EQ_W)));
const yOf = (db: number) => EQ_H / 2 - (db / EQ_DB) * (EQ_H / 2 - 12);
const dbOf = (y: number) => ((EQ_H / 2 - y) / (EQ_H / 2 - 12)) * EQ_DB;

interface Band {
  key: string;
  label: { es: string; en: string };
  freq: string;
  gain?: string;
  q?: string;
  on?: string;
}
const BANDS: Band[] = [
  { key: "lc", label: { es: "Corte grave", en: "Low cut" }, freq: "lowCutFreq", on: "lowCut" },
  { key: "ls", label: { es: "Graves", en: "Low shelf" }, freq: "lowFreq", gain: "lowGain" },
  { key: "lm", label: { es: "Medios graves", en: "Low-mid" }, freq: "lowMidFreq", gain: "lowMidGain", q: "lowMidQ" },
  { key: "hm", label: { es: "Medios agudos", en: "High-mid" }, freq: "highMidFreq", gain: "highMidGain", q: "highMidQ" },
  { key: "hs", label: { es: "Agudos", en: "High shelf" }, freq: "highFreq", gain: "highGain" },
  { key: "hc", label: { es: "Corte agudo", en: "High cut" }, freq: "highCutFreq", on: "highCut" },
];

function EqView({ params, onPreview, onCommit }: ViewProps) {
  const { t, lang } = useApp();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ band: Band; changes: Params } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const freqs = useMemo(() => logFreqs(240), []);
  const value = (id: string) => params[id] ?? defOf("eq", id).default;
  const point = (b: Band) => ({ x: xOf(value(b.freq)), y: b.gain ? yOf(value(b.gain)) : yOf(0), off: b.on ? value(b.on) < 0.5 : false });

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = EQ_W * dpr;
    c.height = EQ_H * dpr;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, EQ_W, EQ_H);
    // Grid: frequencies and dB.
    g.lineWidth = 1;
    g.font = "10px 'IBM Plex Mono', monospace";
    g.fillStyle = T.text2;
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      g.strokeStyle = T.lineSoft;
      g.beginPath();
      g.moveTo(Math.round(xOf(f)) + 0.5, 0);
      g.lineTo(Math.round(xOf(f)) + 0.5, EQ_H);
      g.stroke();
      g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), xOf(f) + 3, EQ_H - 4);
    }
    for (const db of [-12, -6, 0, 6, 12]) {
      g.strokeStyle = db === 0 ? T.lineStrong : T.lineSoft;
      g.beginPath();
      g.moveTo(0, Math.round(yOf(db)) + 0.5);
      g.lineTo(EQ_W, Math.round(yOf(db)) + 0.5);
      g.stroke();
      if (db !== 0) g.fillText(`${db > 0 ? "+" : "−"}${Math.abs(db)}`, 4, yOf(db) - 3);
    }
    // The curve, and the area to 0 dB.
    const resp = eqResponse(params, freqs);
    g.beginPath();
    freqs.forEach((f, i) => {
      const y = Math.max(-2, Math.min(EQ_H + 2, yOf(resp[i]!)));
      if (i === 0) g.moveTo(xOf(f), y);
      else g.lineTo(xOf(f), y);
    });
    g.strokeStyle = T.text;
    g.lineWidth = 1.75;
    g.stroke();
    g.lineTo(EQ_W, yOf(0));
    g.lineTo(0, yOf(0));
    g.closePath();
    g.fillStyle = "rgba(127,161,150,0.16)";
    g.fill();
  });

  const local = (e: React.PointerEvent | React.WheelEvent | React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * EQ_W, y: ((e.clientY - r.top) / r.height) * EQ_H };
  };
  const nearest = (x: number, y: number) => {
    let best: Band | null = null;
    let dist = 18;
    for (const b of BANDS) {
      const p = point(b);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < dist) (best = b), (dist = d);
    }
    return best;
  };
  const changesAt = (b: Band, x: number, y: number): Params => {
    const fd = defOf("eq", b.freq);
    const out: Params = { [b.freq]: unitToParam(fd, paramToUnit(fd, fOf(x))) };
    if (b.gain) {
      const gd = defOf("eq", b.gain);
      out[b.gain] = Math.round(Math.max(gd.min, Math.min(gd.max, dbOf(y))) * 10) / 10;
    }
    // Dragging a cut that is off turns it on.
    if (b.on && value(b.on) < 0.5) out[b.on] = 1;
    return out;
  };

  return (
    <div className="fxeq">
      <div className="fxcurve" title={t("fxEqHint")}>
        <canvas
          ref={canvas}
          style={{ width: EQ_W, height: EQ_H }}
          onPointerDown={(e) => {
            const { x, y } = local(e);
            const b = nearest(x, y);
            if (!b) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const changes = changesAt(b, x, y);
            setDrag({ band: b, changes });
            onPreview(changes);
          }}
          onPointerMove={(e) => {
            const { x, y } = local(e);
            if (!drag) return setHover(nearest(x, y)?.key ?? null);
            const changes = changesAt(drag.band, x, y);
            setDrag({ band: drag.band, changes });
            onPreview(changes);
          }}
          onPointerUp={() => {
            if (drag) onCommit(drag.changes);
            setDrag(null);
          }}
          onDoubleClick={(e) => {
            const { x, y } = local(e);
            const b = nearest(x, y);
            if (!b) return;
            if (b.gain) onCommit({ [b.gain]: 0 });
            else if (b.on) onCommit({ [b.on]: value(b.on) >= 0.5 ? 0 : 1 });
          }}
          onWheel={(e) => {
            const { x, y } = local(e);
            const b = nearest(x, y);
            if (!b?.q) return;
            const qd = defOf("eq", b.q);
            const next = unitToParam(qd, paramToUnit(qd, value(b.q)) + (e.deltaY < 0 ? 0.04 : -0.04));
            onCommit({ [b.q]: next });
          }}
          onPointerLeave={() => setHover(null)}
        />
        {BANDS.map((b) => {
          const p = point(b);
          return (
            <span
              key={b.key}
              className={`fxpt${p.off ? " off" : ""}${hover === b.key || drag?.band.key === b.key ? " hot" : ""}`}
              style={{ left: `${(p.x / EQ_W) * 100}%`, top: `${(p.y / EQ_H) * 100}%` }}
              aria-hidden="true"
            >
              {BANDS.indexOf(b) + 1}
            </span>
          );
        })}
      </div>
      <div className="fxbands">
        {BANDS.map((b, i) => (
          <div key={b.key} className={`fxband${b.on && value(b.on) < 0.5 ? " off" : ""}`}>
            <div className="fxbandhead">
              <span className="fxbandn">{i + 1}</span>
              <span className="fxbandname">{b.label[lang]}</span>
              {b.on && (
                <button className={value(b.on) >= 0.5 ? "fxon on" : "fxon"} aria-pressed={value(b.on) >= 0.5} title={t("fxBandOn")} onClick={() => onCommit({ [b.on!]: value(b.on!) >= 0.5 ? 0 : 1 })}>
                  {value(b.on) >= 0.5 ? "on" : "off"}
                </button>
              )}
            </div>
            <TypedValue def={defOf("eq", b.freq)} value={value(b.freq)} onCommit={(v) => onCommit({ [b.freq]: v })} />
            {b.gain ? <TypedValue def={defOf("eq", b.gain)} value={value(b.gain)} onCommit={(v) => onCommit({ [b.gain!]: v })} /> : <span className="fxval dim">12 dB/oct</span>}
            {b.q ? <TypedValue def={defOf("eq", b.q)} value={value(b.q)} onCommit={(v) => onCommit({ [b.q!]: v })} /> : <span className="fxval dim" />}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Compressor ------------------------------------------------------------------------------------

const TC = 180;

function CompView({ audio, id, params, onPreview, onCommit }: ViewProps & { audio: AudioLayer; id: string }) {
  const { t } = useApp();
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduction = useReduction(audio, id);
  const value = (k: string) => params[k] ?? defOf("compressor", k).default;
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = TC * dpr;
    c.height = TC * dpr;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, TC, TC);
    const pos = (db: number) => ((db + 60) / 60) * TC;
    g.strokeStyle = T.lineSoft;
    g.lineWidth = 1;
    for (const db of [-48, -36, -24, -12]) {
      g.beginPath();
      g.moveTo(pos(db) + 0.5, 0);
      g.lineTo(pos(db) + 0.5, TC);
      g.moveTo(0, TC - pos(db) + 0.5);
      g.lineTo(TC, TC - pos(db) + 0.5);
      g.stroke();
    }
    // 1:1 for reference, then the curve; the threshold marked.
    g.strokeStyle = T.lineStrong;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(0, TC);
    g.lineTo(TC, 0);
    g.stroke();
    g.setLineDash([]);
    const p = { threshold: value("threshold"), ratio: value("ratio"), knee: value("knee") };
    g.beginPath();
    for (let i = 0; i <= 120; i++) {
      const inDb = -60 + i / 2;
      const out = compressorOut(p, inDb) + value("makeup");
      const x = pos(inDb);
      const y = TC - Math.max(-2, Math.min(TC + 2, pos(out)));
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = T.text;
    g.lineWidth = 1.75;
    g.stroke();
    g.fillStyle = T.text2;
    g.beginPath();
    g.arc(pos(p.threshold), TC - pos(compressorOut(p, p.threshold) + value("makeup")), 3.5, 0, Math.PI * 2);
    g.fill();
  });
  return (
    <div className="fxdyn">
      <div className="fxgraph">
        <canvas ref={canvas} style={{ width: TC, height: TC }} aria-hidden="true" />
        <div className="fxaxes">
          <span>{t("fxIn")} →</span>
          <span>↑ {t("fxOut")}</span>
        </div>
      </div>
      <ReductionMeter db={reduction} />
      <div className="fxrows">
        {paramDefs("compressor").map((d) => (
          <ParamRow key={d.id} def={d} value={value(d.id)} onPreview={(v) => onPreview({ [d.id]: v })} onCommit={(v) => onCommit({ [d.id]: v })} />
        ))}
      </div>
    </div>
  );
}

// --- Limiter ---------------------------------------------------------------------------------------

function LimView({ audio, id, params, onPreview, onCommit }: ViewProps & { audio: AudioLayer; id: string }) {
  const reduction = useReduction(audio, id);
  const value = (k: string) => params[k] ?? defOf("limiter", k).default;
  return (
    <div className="fxdyn lim">
      <ReductionMeter db={reduction} />
      <div className="fxrows">
        {paramDefs("limiter").map((d) => (
          <ParamRow key={d.id} def={d} value={value(d.id)} onPreview={(v) => onPreview({ [d.id]: v })} onCommit={(v) => onCommit({ [d.id]: v })} />
        ))}
      </div>
    </div>
  );
}
