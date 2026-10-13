/**
 * The rulers above the piano roll, at its zoom (DIRECCION_ARTISTICA.md, 6.1 item 4): form with
 * annotation flags, harmony, bar numbers with the loop band. Empty states as in capture 08.
 * DOM rather than canvas: a few dozen elements, crisp text, and chords will be typed in place.
 */
import { type Song, barAt, barStart, barTicks, orderedSections } from "@fourhands/core";
import type { Translate } from "../../shared/i18n.js";
import { type RollView, endTick, tickToX } from "../roll/geometry.js";

interface RulerProps {
  song: Song;
  v: RollView;
  t: Translate;
}

export function FormRuler({ song, v, t }: RulerProps) {
  const sections = orderedSections(song);
  if (sections.length === 0) {
    return (
      <div className="empty">
        {t("noSections")} <button disabled title={t("addSection")}>{t("addSection")}</button>
      </div>
    );
  }
  const end = endTick(v);
  return (
    <>
      {sections.map((s) => {
        const a = barStart(song.meter, s.startBar);
        const b = barStart(song.meter, s.endBar + 1);
        if (b <= v.startTick || a >= end) return null;
        const left = Math.max(0, tickToX(v, a));
        const right = Math.min(v.width, tickToX(v, b));
        return (
          <span key={s.id} className="sec" style={{ left, width: right - left }}>
            {s.name}
          </span>
        );
      })}
      {Object.values(song.annotations).map((a) =>
        a.start >= v.startTick && a.start < end ? (
          <span key={a.id} className="flag" style={{ left: tickToX(v, a.start) }}>
            {a.text}
          </span>
        ) : null,
      )}
    </>
  );
}

export function HarmonyRuler({ song, v, t }: RulerProps) {
  const chords = Object.entries(song.harmony)
    .map(([tick, symbol]) => ({ tick: Number(tick), symbol }))
    .sort((a, b) => a.tick - b.tick);
  if (chords.length === 0) {
    return (
      <div className="empty">
        {t("noHarmony")} <button disabled title={t("writeChords")}>{t("writeChords")}</button>
      </div>
    );
  }
  const end = endTick(v);
  const bar = barTicks(song.meter);
  return (
    <>
      {chords.map((c, i) => {
        const next = chords[i + 1]?.tick ?? (Math.floor(c.tick / bar) + 1) * bar;
        if (next <= v.startTick || c.tick >= end) return null;
        const left = tickToX(v, c.tick);
        return (
          <span key={c.tick} className="chord" style={{ left, width: tickToX(v, next) - left }}>
            {c.symbol}
          </span>
        );
      })}
    </>
  );
}

export function BarRuler({ song, v }: Omit<RulerProps, "t">) {
  const bar = barTicks(song.meter);
  const barPx = bar * v.pxPerTick;
  const every = barPx >= 28 ? 1 : barPx >= 14 ? 2 : barPx >= 7 ? 4 : 8;
  const first = barAt(song.meter, v.startTick);
  const last = barAt(song.meter, endTick(v));
  const labels: number[] = [];
  for (let b = first; b <= last; b++) if ((b - 1) % every === 0) labels.push(b);
  const loop = song.context.loop;
  return (
    <>
      {labels.map((b) => (
        <span key={b} className="barn mono" style={{ left: tickToX(v, barStart(song.meter, b)) }}>
          {b}
        </span>
      ))}
      {loop && <span className="loopband" style={{ left: tickToX(v, loop.start), width: (loop.end - loop.start) * v.pxPerTick }} />}
    </>
  );
}
