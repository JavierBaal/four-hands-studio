/**
 * The rulers above the piano roll, at its zoom (docs/design.md, 6.1 item 4): form,
 * annotations in lanes of their own (20/10/2026), harmony, bar numbers with the loop band. Empty states as in capture 08.
 * DOM rather than canvas: a few dozen elements, crisp text, and chords are typed in place.
 *
 * Form: drag across empty space to create a section (whole bars); drag a section's edge to resize
 * it; double click renames; right click opens its menu (or, on empty space, "Add annotation").
 * Harmony: double click types the chord of the beat under the mouse; Enter or Tab goes on to the next bar.
 */
import { useState } from "react";
import { type Song, barAt, barStart, barTicks, bpmAt, keyAt, orderedSections, tempoMarks } from "@fourhands/core";
import { keyName } from "../music.js";
import type { Translate } from "../../shared/i18n.js";
import { useActions, useApp } from "../context.js";
import { type RollView, endTick, tickToX, xToTick } from "../roll/geometry.js";
import { InlineEdit } from "./InlineEdit.js";
import { layoutAnnotations } from "../roll/annotation-lanes.js";

interface RulerProps {
  song: Song;
  v: RollView;
  t: Translate;
}

/** Edge grab width in pixels. */
const EDGE = 5;

function localX(e: { clientX: number; currentTarget: Element }): number {
  return e.clientX - e.currentTarget.getBoundingClientRect().left;
}

/** Nearest bar line (as a 0-based boundary index) to a tick. */
function boundaryAt(song: Song, tick: number): number {
  return Math.max(0, Math.round(tick / barTicks(song.meter)));
}

type FormDrag =
  | { kind: "create"; x0: number; x: number; min: number; max: number }
  | { kind: "resize"; id: string; side: "start" | "end"; startBar: number; endBar: number; min: number; max: number };

export function FormRuler({ song, v, t }: RulerProps) {
  const actions = useActions();
  const [drag, setDrag] = useState<FormDrag | null>(null);
  const sections = orderedSections(song);
  const typing = actions.typing;
  const end = endTick(v);
  const meter = song.meter;

  /** Bars free around a tick (between the neighbouring sections), as boundary indices. */
  const gapAround = (tick: number, except?: string) => {
    let min = 0;
    let max = Infinity;
    for (const s of sections) {
      if (s.id === except) continue;
      const a = s.startBar - 1;
      const b = s.endBar;
      if (b * barTicks(meter) <= tick) min = Math.max(min, b);
      else if (a * barTicks(meter) >= tick) max = Math.min(max, a);
    }
    return { min, max };
  };

  const rowDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, .flag")) return;
    const x = localX(e);
    const edge = target.closest<HTMLElement>(".sedge");
    if (edge) {
      const s = song.sections[edge.dataset.id!];
      if (!s) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const gap = gapAround(barStart(meter, s.startBar) + 1, s.id);
      setDrag({ kind: "resize", id: s.id, side: edge.dataset.side as "start" | "end", startBar: s.startBar, endBar: s.endBar, min: gap.min, max: gap.max });
      return;
    }
    if (target.closest(".sec")) return;
    const gap = gapAround(xToTick(v, x));
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ kind: "create", x0: x, x, min: gap.min, max: gap.max });
  };

  const rowMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const x = localX(e);
    if (drag.kind === "create") return setDrag({ ...drag, x });
    const b = Math.max(drag.min, Math.min(drag.max, boundaryAt(song, xToTick(v, x))));
    if (drag.side === "start") setDrag({ ...drag, startBar: Math.min(b + 1, drag.endBar) });
    else setDrag({ ...drag, endBar: Math.max(b, drag.startBar) });
  };

  const createRange = (d: Extract<FormDrag, { kind: "create" }>) => {
    const bar = barTicks(meter);
    const a = Math.min(d.x0, d.x);
    const b = Math.max(d.x0, d.x);
    const from = Math.max(d.min, Math.floor(xToTick(v, a) / bar));
    const to = Math.min(d.max, Math.max(from + 1, Math.ceil(xToTick(v, b) / bar)));
    return { start: from * bar, end: to * bar };
  };

  const rowUp = () => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.kind === "resize") actions.resizeSection(d.id, d.startBar, d.endBar);
    else if (Math.abs(d.x - d.x0) > 4) {
      const r = createRange(d);
      if (r.end > r.start) void actions.addSection(r.start, r.end);
    }
  };

  const rowMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.target as HTMLElement;
    const sec = target.closest<HTMLElement>(".sec");
    if (sec) actions.sectionMenu(sec.dataset.id!, e.clientX, e.clientY);
    else actions.formMenu(xToTick(v, localX(e)), e.clientX, e.clientY);
  };

  const rowDouble = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const sec = target.closest<HTMLElement>(".sec");
    if (sec && !target.closest(".sedge")) actions.type({ kind: "section", id: sec.dataset.id! });
  };

  const span = (a: number, b: number) => {
    const left = Math.max(0, tickToX(v, a));
    return { left, width: Math.min(v.width, tickToX(v, b)) - left };
  };

  const items: React.ReactNode[] = [];
  for (const s of sections) {
    const resizing = drag?.kind === "resize" && drag.id === s.id ? drag : null;
    const a = barStart(meter, resizing?.startBar ?? s.startBar);
    const b = barStart(meter, (resizing?.endBar ?? s.endBar) + 1);
    if (b <= v.startTick || a >= end) continue;
    const box = span(a, b);
    if (typing?.kind === "section" && typing.id === s.id) {
      items.push(
        <InlineEdit
          key={`edit-${s.id}`}
          className="ruler"
          style={{ left: box.left, width: Math.max(120, box.width) }}
          value={s.name}
          title={t("sectionRename")}
          onCommit={(text) => (actions.renameSection(s.id, text), actions.type(null))}
          onCancel={() => actions.type(null)}
        />,
      );
      continue;
    }
    items.push(
      <span key={s.id} data-id={s.id} className={resizing ? "sec resizing" : "sec"} style={box} title={s.name}>
        {s.name}
        <span className="sedge start" data-id={s.id} data-side="start" />
        <span className="sedge end" data-id={s.id} data-side="end" />
      </span>,
    );
  }
  if (drag?.kind === "create" && Math.abs(drag.x - drag.x0) > 4) {
    const r = createRange(drag);
    items.push(<span key="new" className="sec ghost" style={span(r.start, r.end)} />);
  }
  return (
    <div className={drag?.kind === "resize" ? "rfill resizing" : "rfill"} onPointerDown={rowDown} onPointerMove={rowMove} onPointerUp={rowUp} onContextMenu={rowMenu} onDoubleClick={rowDouble}>
      {sections.length === 0 && !(drag?.kind === "create" && Math.abs(drag.x - drag.x0) > 4) && (
        <div className="empty">
          {t("noSections")}{" "}
          <button title={t("addSection")} onClick={() => actions.addSectionHere()}>
            {t("addSection")}
          </button>
        </div>
      )}
      {items}
    </div>
  );
}

/** Height of one annotation lane, in pixels. */
export const NOTE_LANE = 20;

/** Whether the annotation ruler shows: there are annotations, or one is being typed. */
export function hasAnnotationRuler(song: Song, typingAnnotation: boolean): boolean {
  return typingAnnotation || Object.keys(song.annotations).length > 0;
}

/** Lanes the annotation ruler needs at this view (at least one). */
export function annotationLanes(song: Song, v: RollView): number {
  const items = Object.values(song.annotations).map((a) => ({ id: a.id, x0: tickToX(v, a.start), x1: tickToX(v, a.end), text: a.text }));
  return Math.max(1, layoutAnnotations(items, v.width).lanes);
}

/**
 * Annotations in lanes that never overlap each other or the section names (20/10/2026).
 * Each one spans its bars, with its words as a label; the left edge carries its author's colour.
 * Double click edits; right click opens its menu; on empty space, "Add annotation".
 */
export function AnnotationRuler({ song, v, t }: RulerProps) {
  const actions = useActions();
  const typing = actions.typing?.kind === "annotation" ? actions.typing : null;
  const items = Object.values(song.annotations)
    .filter((a) => !(typing && typing.id === a.id))
    .map((a) => ({ id: a.id, x0: tickToX(v, a.start), x1: tickToX(v, a.end), text: a.text }));
  const layout = layoutAnnotations(items, v.width);

  const rowMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const box = (e.target as HTMLElement).closest<HTMLElement>(".anote");
    if (box) actions.annotationMenu(box.dataset.id!, e.clientX, e.clientY);
    else actions.formMenu(xToTick(v, localX(e)), e.clientX, e.clientY);
  };
  const rowDouble = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = (e.target as HTMLElement).closest<HTMLElement>(".anote");
    const a = box ? song.annotations[box.dataset.id!] : undefined;
    if (a) actions.type({ kind: "annotation", id: a.id, tick: a.start });
    else if (!box) actions.type({ kind: "annotation", id: null, tick: barStart(song.meter, barAt(song.meter, xToTick(v, localX(e)))) });
  };

  return (
    <div className="rfill" onContextMenu={rowMenu} onDoubleClick={rowDouble}>
      {layout.boxes.map((b) => {
        const a = song.annotations[b.id]!;
        const by = a.author.by === "ai" ? "ai" : "u";
        return (
          <span
            key={b.id}
            data-id={b.id}
            className={`anote ${by}${b.cutLeft ? " cut" : ""}`}
            style={{ left: b.left, width: b.width, top: 3 + b.lane * NOTE_LANE }}
            title={`${a.text} · ${t(by === "ai" ? "annotationByAi" : "annotationByYou")}`}
          >
            <span className="atext">{a.text}</span>
            {b.spanWidth > 0 && <span className="aspan" style={{ width: b.spanWidth }} />}
          </span>
        );
      })}
      {layout.hidden.length > 0 && (
        <span
          className="amore"
          style={{ top: 3 + (layout.lanes - 1) * NOTE_LANE }}
          title={layout.hidden.map((h) => song.annotations[h.id]?.text ?? "").join("\n")}
        >
          +{layout.hidden.length}
        </span>
      )}
      {typing && (
        <InlineEdit
          key={`note-${typing.id ?? typing.tick}`}
          className="ruler"
          style={{ left: Math.max(0, tickToX(v, typing.tick)), width: 220 }}
          value={typing.id ? (song.annotations[typing.id]?.text ?? "") : ""}
          placeholder={t("addAnnotation")}
          title={t("addAnnotation")}
          maxLength={120}
          onCommit={(text) => (actions.saveAnnotation(typing.id, typing.tick, text), actions.type(null))}
          onCancel={() => actions.type(null)}
        />
      )}
    </div>
  );
}

export function HarmonyRuler({ song, v, t }: RulerProps) {
  const actions = useActions();
  const { view } = useApp();
  const typing = actions.typing?.kind === "chord" ? actions.typing : null;
  const chords = Object.entries(song.harmony)
    .map(([tick, symbol]) => ({ tick: Number(tick), symbol }))
    .sort((a, b) => a.tick - b.tick);
  const end = endTick(v);
  const bar = barTicks(song.meter);

  /** Types the next chord at a tick, scrolling it into view if needed. */
  const typeAt = (tick: number) => {
    const barPx = bar * v.pxPerTick;
    if (tickToX(v, tick) + Math.max(120, barPx) > v.width || tick < v.startTick) {
      view.animate({ startTick: Math.max(0, tick - Math.floor(v.width / 4 / v.pxPerTick)) });
    }
    actions.type({ kind: "chord", tick });
  };

  const rowDouble = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button, input")) return;
    // The beat under the mouse: the chord there is edited, or a new one starts (a bar can change on beat 3).
    typeAt(actions.beatAt(xToTick(v, localX(e))));
  };

  const rowMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const chord = (e.target as HTMLElement).closest<HTMLElement>(".chord");
    if (chord) actions.chordMenu(Number(chord.dataset.tick), e.clientX, e.clientY);
  };

  const items: React.ReactNode[] = [];
  chords.forEach((c, i) => {
    if (typing && typing.tick === c.tick) return;
    const next = chords[i + 1]?.tick ?? (Math.floor(c.tick / bar) + 1) * bar;
    if (next <= v.startTick || c.tick >= end) return;
    const left = tickToX(v, c.tick);
    items.push(
      <span key={c.tick} data-tick={c.tick} className="chord" style={{ left, width: tickToX(v, next) - left }} title={`${c.symbol} · ${t("bar")} ${barAt(song.meter, c.tick)}`}>
        {c.symbol}
      </span>,
    );
  });
  if (typing) {
    items.push(
      <InlineEdit
        key={`chord-${typing.tick}`}
        className="ruler"
        style={{ left: Math.max(0, tickToX(v, typing.tick)), width: Math.max(120, Math.min(220, bar * v.pxPerTick)) }}
        value={song.harmony[String(typing.tick)] ?? ""}
        placeholder={t("chordHint")}
        title={t("chordHint")}
        maxLength={16}
        onCommit={(text) => (actions.setChord(typing.tick, text), actions.type(null))}
        onNext={(text) => {
          actions.setChord(typing.tick, text);
          typeAt(actions.nextChordBar(typing.tick));
        }}
        onCancel={() => actions.type(null)}
      />,
    );
  }
  return (
    <div className="rfill" onDoubleClick={rowDouble} onContextMenu={rowMenu}>
      {chords.length === 0 && !typing && (
        <div className="empty">
          {t("noHarmony")}{" "}
          <button title={t("writeChords")} onClick={() => actions.writeChordsHere()}>
            {t("writeChords")}
          </button>
        </div>
      )}
      {items}
    </div>
  );
}

/** Whether the Tempo ruler shows (H4): the song changes tempo, or a change is being typed. */
export function hasTempoRuler(song: Song, typingTempo: boolean): boolean {
  return typingTempo || (song.tempoChanges ?? []).length > 0;
}

/** Whether the Key ruler shows (H4): the song changes key. */
export function hasKeyRuler(song: Song): boolean {
  return (song.keyChanges ?? []).length > 0;
}

/**
 * Tempo changes (H4, 26/10/2026): each change reads where it happens, like a marking on a
 * score: "60" for a jump, "rit." or "accel." over the bars where it glides and the tempo it
 * reaches, "⌒ 2×" for a fermata. Double click writes one at the beat under the mouse (or rewrites
 * the one clicked); right click opens its menu.
 */
export function TempoRuler({ song, v, t }: RulerProps) {
  const actions = useActions();
  const typing = actions.typing?.kind === "tempoChange" ? actions.typing : null;
  const marks = tempoMarks(song);
  const end = endTick(v);
  // What is in force at the left edge, dimmed, until the first mark in view (like a clef at the start of a line).
  const edgeBpm = Math.round(bpmAt(song, v.startTick) * 100) / 100;
  const firstX = Math.min(...marks.filter((m) => (m.kind === "ramp" ? m.from : m.tick) >= v.startTick).map((m) => tickToX(v, m.kind === "ramp" ? m.from : m.tick)), Infinity);
  const inRamp = marks.some((m) => m.kind === "ramp" && m.from < v.startTick && m.tick > v.startTick);
  // A jump right where a ramp starts: the ramp's words go after the jump's value.
  const jumpAt = new Set(marks.filter((m) => m.kind === "jump").map((m) => m.tick));
  jumpAt.add(0);

  const markAt = (target: EventTarget) => {
    const el = (target as HTMLElement).closest<HTMLElement>(".tmark");
    return el ? Number(el.dataset.tick) : null;
  };
  const rowDouble = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("input")) return;
    const on = markAt(e.target);
    if (on !== null) actions.type({ kind: "tempoChange", tick: on, editing: on });
    else actions.type({ kind: "tempoChange", tick: Math.max(1, actions.beatAt(xToTick(v, localX(e)))), editing: null });
  };
  const rowMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    actions.tempoMenu(xToTick(v, localX(e)), markAt(e.target), e.clientX, e.clientY);
  };

  const items: React.ReactNode[] = [];
  marks.forEach((m, i) => {
    if (typing?.editing === m.tick) return;
    const next = marks[i + 1]?.tick ?? Infinity;
    const from = m.kind === "ramp" ? m.from : m.tick;
    const to = m.kind === "fermata" ? m.end : m.kind === "ramp" ? m.tick : Math.min(next, end);
    if (to < v.startTick || from > end) return;
    const left = Math.max(0, tickToX(v, from) + (m.kind === "ramp" && jumpAt.has(from) && from >= v.startTick ? 52 : 0));
    if (m.kind === "ramp") {
      const width = Math.max(18, tickToX(v, m.tick) - left);
      items.push(
        <span key={m.tick} data-tick={m.tick} className={`tmark tramp ${m.slower ? "slower" : "faster"}`} style={{ left, width }} title={`${t(m.slower ? "rampSlower" : "rampFaster")} → ${m.bpm} · ${t("bar")} ${barAt(song.meter, m.tick)}`}>
          <span className="tword">{t(m.slower ? "rampSlower" : "rampFaster")}</span>
          <span className="tline" />
          <span className="tval mono">{m.bpm}</span>
        </span>,
      );
    } else if (m.kind === "fermata") {
      items.push(
        <span key={m.tick} data-tick={m.tick} className="tmark tferm" style={{ left, width: Math.max(44, tickToX(v, m.end) - left) }} title={`${t("fermataWord")} ×${m.factor} · ${t("bar")} ${barAt(song.meter, m.tick)}`}>
          ⌒ <span className="mono">{m.factor}×</span>
        </span>,
      );
    } else {
      items.push(
        <span key={m.tick} data-tick={m.tick} className="tmark tjump" style={{ left, width: Math.max(28, Math.min(tickToX(v, to), marks[i + 1]?.kind === "ramp" ? tickToX(v, m.tick) + 52 : Infinity) - left) }} title={`♩ = ${m.bpm} · ${t("bar")} ${barAt(song.meter, m.tick)}`}>
          <span className="mono">♩ {m.bpm}</span>
        </span>,
      );
    }
  });
  if (typing) {
    items.push(
      <InlineEdit
        key={`tempo-${typing.tick}`}
        className="ruler"
        style={{ left: Math.max(0, tickToX(v, typing.tick)), width: 180 }}
        value={typing.editing !== null ? actions.tempoChangeText(typing.editing) : ""}
        placeholder={t("tempoChangeHint")}
        title={t("tempoChangeHint")}
        maxLength={24}
        onCommit={(text) => (actions.saveTempoChange(typing.editing, typing.tick, text), actions.type(null))}
        onCancel={() => actions.type(null)}
      />,
    );
  }
  return (
    <div className="rfill" onDoubleClick={rowDouble} onContextMenu={rowMenu}>
      {!inRamp && firstX > 56 && (
        <span className="tstart mono" title={`♩ = ${edgeBpm}`}>
          ♩ {edgeBpm}
        </span>
      )}
      {items}
    </div>
  );
}

/** Key changes (H4): the key from each change on, until the next one. Right click or double click: its menu. */
export function KeyRuler({ song, v, t }: RulerProps) {
  const actions = useActions();
  const { lang } = useApp();
  const changes = song.keyChanges ?? [];
  const end = endTick(v);
  const open = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = (e.target as HTMLElement).closest<HTMLElement>(".kchange");
    actions.keyChangeMenu(el ? Number(el.dataset.tick) : xToTick(v, localX(e)), e.clientX, e.clientY);
  };
  return (
    <div className="rfill" onContextMenu={open} onDoubleClick={open}>
      {Math.min(...changes.filter((c) => c.tick >= v.startTick).map((c) => tickToX(v, c.tick)), Infinity) > 90 && <span className="kstart">{keyName(keyAt(song, v.startTick), lang)}</span>}
      {changes.map((c, i) => {
        const next = changes[i + 1]?.tick ?? Infinity;
        if (next <= v.startTick || c.tick >= end) return null;
        const left = tickToX(v, c.tick);
        return (
          <span key={c.tick} data-tick={c.tick} className="kchange" style={{ left, width: Math.min(v.width, tickToX(v, Math.min(next, end))) - left }} title={`${keyName(c.key, lang)} · ${t("bar")} ${barAt(song.meter, c.tick)}`}>
            {keyName(c.key, lang)}
          </span>
        );
      })}
    </div>
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
