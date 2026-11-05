/**
 * Librería, in the Pista tab of a track that sounds through a plugin (Fran, 05/11/2026; boceto
 * aprobado, bocetos/propuestas/ficha_*.png): its library card from the user's catalog, the same in
 * every song. Three states: the card, no card, and editing it.
 */
import { useState } from "react";
import type { Track } from "@fourhands/core";
import type { AudioLayer } from "../audio-layer.js";
import { useActions, useApp, useView } from "../context.js";
import { type LibResponse, type LibState, type LibraryCard, hostPitchName, parseUserPitch } from "../../shared/library-cards.js";
import { noteName } from "../music.js";

type T = ReturnType<typeof useApp>["t"];

const STATE_KEY = { yes: "libYes", weak: "libWeak", no: "libNo", untested: "libUntested" } as const;
const REVERB_KEY = { off: "libRevOff", on: "libRevOn", none: "libRevNone" } as const;
const RESPONSES = [
  ["velocity", "libVelocity"],
  ["expression", "libExpression"],
  ["modulation", "libModulation"],
] as const;

function Pill({ r, t }: { r: LibResponse; t: T }) {
  return (
    <>
      <span className="lpill">
        <span className={`ldot ${r.state}`} />
        {t(STATE_KEY[r.state])}
      </span>
      {r.note && <div className="hint">{r.note}</div>}
    </>
  );
}

export function LibrarySection({ track, audio }: { track: Track; audio: AudioLayer }) {
  const { t } = useApp();
  const actions = useActions();
  const [editing, setEditing] = useState<string | null>(null);
  const card = audio.libraryCard(track.library?.id);
  const other = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    actions.libraryMenu(r.left, r.bottom + 4, track.id);
  };

  if (card && editing === card.id)
    return (
      <section className="tclibsec">
        <p className="ah">{t("libTitle")}</p>
        <CardForm card={card} audio={audio} done={() => setEditing(null)} />
      </section>
    );

  if (!card)
    return (
      <section className="tclibsec">
        <p className="ah">{t("libTitle")}</p>
        <div className="card tclib libempty">
          <div className="tclibname">{t("libNone")}</div>
          {track.library && <p className="hint">{t("libMissing", { name: track.library.name })}</p>}
          <p className="hint">{t("libAbout")}</p>
          <p className="hint">{t("libAsk")}</p>
        </div>
        <div className="tcbtns">
          <button className="btn" onClick={() => void actions.createLibraryCard(track.id).then((c) => c && setEditing(c.id))}>
            {t("libCreate")}
          </button>
          <button className="btn" onClick={other}>
            {t("libUseOther")}
          </button>
        </div>
      </section>
    );

  return (
    <section className="tclibsec">
      <p className="ah">{t("libTitle")}</p>
      <CardView card={card} />
      <div className="tcbtns">
        <button className="btn" onClick={() => setEditing(card.id)}>
          {t("libEdit")}
        </button>
        <button className="btn" onClick={other}>
          {t("libUseOther")}
        </button>
      </div>
    </section>
  );
}

function CardView({ card }: { card: LibraryCard }) {
  const { t, lang } = useApp();
  const v = useView();
  const name = (p: number) => noteName(p, v.noteNames);
  const host = card.range && hostPitchName(card.range.low, card.host);
  const at = card.updated ? new Date(card.updated.at) : null;
  const two = (n: number) => String(n).padStart(2, "0");
  const date = at ? (lang === "es" ? `${two(at.getDate())}/${two(at.getMonth() + 1)}` : `${two(at.getDate())}/${two(at.getMonth() + 1)}`) : null;
  return (
    <div className="card tclib">
      <div className="tclibname">{card.name}</div>
      {card.host && <div className="hint">{t("libIn", { plugin: card.host })}</div>}
      <dl className="tclibrows">
        {RESPONSES.map(([field, label]) => (
          <div className="tclibrow" key={field}>
            <dt>{t(label)}</dt>
            <dd>
              <Pill r={card[field]} t={t} />
            </dd>
          </div>
        ))}
        {card.range && (
          <div className="tclibrow">
            <dt>{t("libRange")}</dt>
            <dd>
              <span className="mono">
                {name(card.range.low)} – {name(card.range.high)}
              </span>
              {host && <div className="hint">{t("libRangeHost", { plugin: card.host!.replace(/\s*\d+$/, ""), low: host, high: hostPitchName(card.range.high, card.host)! })}</div>}
            </dd>
          </div>
        )}
        {card.keyswitches.length > 0 && (
          <div className="tclibrow">
            <dt>{t("libKeyswitches")}</dt>
            <dd className="lks">
              {card.keyswitches.map((k) => (
                <span className="lchip mono" key={k.pitch}>
                  {name(k.pitch)} {k.name}
                </span>
              ))}
            </dd>
          </div>
        )}
        {card.ownReverb && (
          <div className="tclibrow">
            <dt>{t("libReverb")}</dt>
            <dd>{t(REVERB_KEY[card.ownReverb])}</dd>
          </div>
        )}
        {card.notes && (
          <div className="tclibrow">
            <dt>{t("libNotes")}</dt>
            <dd>{card.notes}</dd>
          </div>
        )}
      </dl>
      {card.updated && (
        <div className="tclibby">
          <span className={`ldot ${card.updated.by === "ai" ? "ai" : "user"}`} />
          {t("libWhen", { who: t(card.updated.by === "ai" ? "libByAi" : "libByUser"), why: card.updated.why ? ` ${card.updated.why}` : "", date: date! })}
        </div>
      )}
    </div>
  );
}

function CardForm({ card, audio, done }: { card: LibraryCard; audio: AudioLayer; done: () => void }) {
  const { t } = useApp();
  const v = useView();
  const name = (p: number) => noteName(p, v.noteNames);
  const [draft, setDraft] = useState<LibraryCard>(() => structuredClone(card));
  const [low, setLow] = useState(card.range ? name(card.range.low) : "");
  const [high, setHigh] = useState(card.range ? name(card.range.high) : "");
  const [ksPitch, setKsPitch] = useState("");
  const [ksName, setKsName] = useState("");
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (change: Partial<LibraryCard>) => setDraft((d) => ({ ...d, ...change }));
  const seg = <V extends string>(value: V | undefined, options: ReadonlyArray<readonly [V, string]>, pick: (v: V) => void, label: string) => (
    <div className="lseg" role="radiogroup" aria-label={label}>
      {options.map(([o, text]) => (
        <button key={o} role="radio" aria-checked={o === value} className={o === value ? "lsegb on" : "lsegb"} onClick={() => pick(o)}>
          {text}
        </button>
      ))}
    </div>
  );
  const addKs = () => {
    const p = parseUserPitch(ksPitch);
    if (p === null) return setProblem(t("libBadPitch", { text: ksPitch }));
    if (!ksName.trim()) return;
    set({ keyswitches: [...draft.keyswitches.filter((k) => k.pitch !== p), { pitch: p, name: ksName.trim() }].sort((a, b) => a.pitch - b.pitch) });
    setKsPitch("");
    setKsName("");
    setProblem(null);
  };
  const save = async () => {
    const next: LibraryCard = { ...draft, name: draft.name.trim() || card.name };
    if (low.trim() || high.trim()) {
      const a = parseUserPitch(low);
      const b = parseUserPitch(high);
      if (a === null) return setProblem(t("libBadPitch", { text: low }));
      if (b === null) return setProblem(t("libBadPitch", { text: high }));
      next.range = { low: Math.min(a, b), high: Math.max(a, b) };
    } else delete next.range;
    if (!next.notes?.trim()) delete next.notes;
    next.updated = { by: "user", at: Date.now() };
    await audio.saveLibrary(next);
    done();
  };
  const states = (["yes", "weak", "no", "untested"] as const).map((s) => [s, t(STATE_KEY[s])] as const);
  return (
    <>
      <div className="card tclib edit">
        <label className="lrow">
          <span>{t("libName")}</span>
          <input className="linput" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        {RESPONSES.map(([field, label]) => (
          <div className="lrow" key={field}>
            <span>{t(label)}</span>
            {seg<LibState>(draft[field].state, states, (s) => set({ [field]: { ...draft[field], state: s } }), t(label))}
          </div>
        ))}
        <div className="lrow">
          <span>{t("libRange")}</span>
          <span className="lrange">
            <input className="linput mono" value={low} aria-label={`${t("libRange")} 1`} onChange={(e) => setLow(e.target.value)} /> –{" "}
            <input className="linput mono" value={high} aria-label={`${t("libRange")} 2`} onChange={(e) => setHigh(e.target.value)} />
            <span className="hint">{t("libRangeHint")}</span>
          </span>
        </div>
        <div className="lrow">
          <span>{t("libKeyswitches")}</span>
          <span className="lks">
            {draft.keyswitches.map((k) => (
              <span className="lchip mono" key={k.pitch}>
                {name(k.pitch)} {k.name}{" "}
                <button className="lchipx" aria-label="×" onClick={() => set({ keyswitches: draft.keyswitches.filter((x) => x.pitch !== k.pitch) })}>
                  ×
                </button>
              </span>
            ))}
            {!adding && (
              <button className="lchip add" onClick={() => setAdding(true)} title={t("libKsAdd")} aria-label={t("libKsAdd")}>
                +
              </button>
            )}
          </span>
          {adding && (
            <span className="lksadd">
              <input className="linput mono" autoFocus value={ksPitch} placeholder={t("libKsNote")} aria-label={t("libKsNote")} onChange={(e) => setKsPitch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addKs()} />
              <input className="linput" value={ksName} placeholder={t("libKsName")} aria-label={t("libKsName")} onChange={(e) => setKsName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addKs()} />
              <button className="btn" onClick={addKs}>
                {t("libKsAdd")}
              </button>
            </span>
          )}
        </div>
        <div className="lrow">
          <span>{t("libReverb")}</span>
          {seg(draft.ownReverb, (["off", "on", "none"] as const).map((r) => [r, t(REVERB_KEY[r])] as const), (r) => set({ ownReverb: r }), t("libReverb"))}
        </div>
        <label className="lrow">
          <span>{t("libNotes")}</span>
          <textarea className="linput ltext" value={draft.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} />
        </label>
        {problem && (
          <p className="hint lproblem" role="alert">
            {problem}
          </p>
        )}
      </div>
      <div className="tcbtns">
        <button className="btn primary" onClick={() => void save()}>
          {t("libSave")}
        </button>
        <button className="btn" onClick={done}>
          {t("libCancel")}
        </button>
      </div>
    </>
  );
}
