/**
 * The mixing console (F2.2 part B, 03/11/2026), on the approved sketch (branch `sketches-mezclador`;
 * docs/design.md, 13; capturas `sketches/propuestas/mezcla_1` a `mezcla_4`).
 *
 * It takes the piano roll's place, as in Studio One (F2 the editor, F3 the console); «Ampliar» hides
 * the arrangement. A strip, top to bottom: the track's colour, insert effects, sends, output, pan,
 * M and S, the fader with its meter and scale, dB, name and sound. The Master is fixed on the right.
 *
 * Parte B: the real tracks (fader = volume, pan, M and S with the usual commands, colour, name,
 * sound), live meters from the engine and the master fader. Parte C: the effects. Parte D (04/11/2026):
 * the buses after a «Buses» divider (the «Reverb» bus in every song), each strip's sends and its
 * output, which is clicked to choose a bus or the Master; «Añadir bus».
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type Bus, type Insert, type Send, type Track, audible, busList, insertName, kindName } from "@fourhands/core";
import { dbToVolume, formatDb, formatPan, formatReverb, parseDb, volumeToDb } from "../../shared/mix.js";
import { SILENT_METER, type MeterState, fracToDb, meterFrac, stepMeter } from "../../shared/meters.js";
import type { AudioLayer } from "../audio-layer.js";
import { useActions, useApp, useSong, useView } from "../context.js";
import { trackColor } from "../theme.js";
import { Fader } from "./Fader.js";
import { InlineEdit } from "./InlineEdit.js";
import { ModeButton } from "./RollToolbar.js";
import { EFFECT_DRAG } from "./SoundsBrowser.js";

/** About 30 readings a second, only while the console is on screen. */
const METER_MS = 33;

/** The meters of every strip ("master" for the Master), stepped with each reading. */
function useMeters(audio: AudioLayer, strips: ReadonlyArray<{ key: string; strip: number | null; bus?: number }>): {
  states: Map<string, MeterState>;
  clear(key: string): void;
} {
  const states = useRef(new Map<string, MeterState>());
  const stripsRef = useRef(strips);
  stripsRef.current = strips;
  const [, redraw] = useState(0);
  useEffect(() => {
    let busy = false;
    let last = performance.now();
    let quiet = false;
    const id = setInterval(() => {
      if (busy) return;
      busy = true;
      void audio
        .meters()
        .then((levels) => {
          const now = performance.now();
          let moving = false;
          for (const s of stripsRef.current) {
            const reading = !levels ? null : s.bus !== undefined ? (levels.buses?.[s.bus] ?? null) : s.strip === null ? levels.master : (levels.channels[s.strip] ?? null);
            const prev = states.current.get(s.key) ?? SILENT_METER;
            const next = stepMeter(prev, reading, now, last);
            if (next.rmsDb !== prev.rmsDb || next.peakDb !== prev.peakDb || next.clip !== prev.clip) moving = true;
            states.current.set(s.key, next);
          }
          last = now;
          // Silence that stays silent does not redraw the console.
          if (moving || !quiet) redraw((n) => n + 1);
          quiet = !moving;
        })
        .finally(() => (busy = false));
    }, METER_MS);
    return () => clearInterval(id);
  }, [audio]);
  return {
    states: states.current,
    clear: (key) => {
      const m = states.current.get(key);
      if (m) states.current.set(key, { ...m, clip: false });
      redraw((n) => n + 1);
    },
  };
}

function Meter({ m, onClear, clipTitle }: { m: MeterState; onClear(): void; clipTitle: string }) {
  return (
    <div className="cmeter">
      <button className={`cclip${m.clip ? " on" : ""}`} aria-label={clipTitle} title={m.clip ? clipTitle : undefined} tabIndex={m.clip ? 0 : -1} onClick={onClear} />
      {[0, 1].map((side) => (
        <div key={side} className="cbar" aria-hidden="true">
          <div className="crms" style={{ height: `${meterFrac(m.rmsDb) * 100}%` }} />
          {m.peakDb > -60 && <div className="cpeak" style={{ bottom: `${meterFrac(m.peakDb) * 100}%` }} />}
        </div>
      ))}
    </div>
  );
}

function Scale() {
  return (
    <div className="cscale" aria-hidden="true">
      {[6, 0, -6, -12, -24, -48].map((db) => (
        <span key={db} style={{ bottom: `${meterFrac(db) * 100}%` }}>
          {db > 0 ? `+${db}` : db === 0 ? "0" : `−${-db}`}
        </span>
      ))}
    </div>
  );
}

/**
 * The vertical fader, on the meter's scale. Dragging is heard at once (`onInput`) and the song
 * changes on release (`onCommit`), one undo step; Shift drags finely; double click goes back to
 * `reset`; arrows move 1 dB (Shift: 0,1 dB). Volume stays at 0 dB or below, as on the tracks.
 */
function VFader({ value, reset, label, valueText, onInput, onCommit }: { value: number; reset: number; label: string; valueText: string; onInput(v: number): void; onCommit(v: number): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<number | null>(null);
  const drag = useRef<{ y0: number; f0: number } | null>(null);
  const shown = live ?? value;
  const frac = meterFrac(volumeToDb(shown));
  const toVolume = (f: number) => dbToVolume(fracToDb(f));
  const set = (v: number) => {
    setLive(v);
    onInput(v);
  };
  const byDb = (v: number, step: number) => {
    const db = volumeToDb(v);
    return dbToVolume((Number.isFinite(db) ? db : -84) + step);
  };
  return (
    <div
      ref={ref}
      className="cvfader"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Math.round(shown * 100) / 100}
      aria-valuetext={valueText}
      title={`${label}: ${valueText} dB`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus();
        const r = e.currentTarget.getBoundingClientRect();
        const at = 1 - (e.clientY - r.top) / r.height;
        // On the knob it is grabbed where it is; elsewhere on the rail it jumps there.
        const f0 = Math.abs(at - frac) * r.height <= 12 ? frac : Math.max(0, Math.min(1, at));
        drag.current = { y0: e.clientY, f0 };
        set(toVolume(f0));
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const r = e.currentTarget.getBoundingClientRect();
        const scale = e.shiftKey ? 0.15 : 1;
        set(toVolume(Math.max(0, Math.min(1, d.f0 - ((e.clientY - d.y0) / r.height) * scale))));
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        drag.current = null;
        const v = live ?? value;
        setLive(null);
        onCommit(v);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setLive(null);
        onInput(value);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setLive(null);
        onInput(reset);
        onCommit(reset);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.1 : 1;
        let v: number | null = null;
        if (e.key === "ArrowUp" || e.key === "ArrowRight") v = byDb(value, step);
        else if (e.key === "ArrowDown" || e.key === "ArrowLeft") v = byDb(value, -step);
        else if (e.key === "Home") v = 0;
        else if (e.key === "End") v = 1;
        if (v === null) return;
        e.preventDefault();
        e.stopPropagation();
        onInput(v);
        onCommit(v);
      }}
    >
      <div className="cvrail" />
      <div className={live !== null ? "cvknob on" : "cvknob"} style={{ bottom: `${frac * 100}%` }} />
    </div>
  );
}

/**
 * A value typed in place (03/11/2026): one click opens the field; Enter or leaving it writes
 * it, Esc cancels. `commit` returns false when the text cannot be read (the value stays as it was).
 */
function Typed({ text, className, title, commit }: { text: string; className: string; title: string; commit(text: string): boolean }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <InlineEdit
      className={`${className} ctype`}
      value={text}
      inputMode="numeric"
      maxLength={8}
      title={title}
      onCommit={(v) => {
        commit(v);
        setOpen(false);
      }}
      onCancel={() => setOpen(false)}
    />
  ) : (
    <button className={`${className} ctypeb`} title={title} onPointerDown={(e) => e.stopPropagation()} onClick={() => setOpen(true)}>
      {text}
    </button>
  );
}

/** Drag data of an effect slot (to reorder it, or move it to another strip). */
const FX_DRAG = "application/x-fourhands-effect";

/**
 * A strip's effect chain (F2.2 part C): one slot per effect, in order, and «+» at the end. Click
 * selects (Supr removes), double click opens a plugin's window, right click has the rest; dragging
 * reorders, also onto another strip. In «Estrecho», only how many.
 */
function FxChain({ audio, target, inserts, narrow }: { audio: AudioLayer; target: string; inserts: readonly Insert[]; narrow: boolean }) {
  const { t, lang } = useApp();
  const actions = useActions();
  useSyncExternalStore(actions.subscribe, actions.getVersion);
  const [over, setOver] = useState<number | null>(null);
  if (narrow) {
    const names = inserts.map((x) => insertName(x, lang)).join(", ");
    return (
      <button className="cfxcount" title={names || t("fxAdd")} onClick={(e) => actions.effectAddMenu(target, e.clientX, e.clientY)}>
        {inserts.length ? t("fxCount", { n: inserts.length }) : "—"}
      </button>
    );
  }
  // A slot being moved, or a new effect from the Sonidos tab (04/11/2026).
  const ours = (e: React.DragEvent) => e.dataTransfer.types.includes(FX_DRAG) || e.dataTransfer.types.includes(EFFECT_DRAG);
  const drop = (index: number) => (e: React.DragEvent) => {
    if (!ours(e)) return;
    e.preventDefault();
    setOver(null);
    const key = e.dataTransfer.getData(EFFECT_DRAG);
    if (key) {
      const item = audio.effectCatalog(lang, t("sndBuiltIn")).find((i) => i.key === key);
      if (item) actions.addEffectItem(item, target, at(index, e));
      return;
    }
    actions.moveEffect(e.dataTransfer.getData(FX_DRAG), at(index, e), target);
  };
  // Over a slot, the upper half drops before it and the lower half after it (04/11/2026:
  // dragging down onto the next slot did nothing, as «before it» was where it already was).
  const at = (index: number, e: React.DragEvent) => {
    if (index >= inserts.length) return inserts.length;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY > r.top + r.height / 2 ? index + 1 : index;
  };
  const dragOver = (index: number) => (e: React.DragEvent) => {
    if (!ours(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(EFFECT_DRAG) ? "copy" : "move";
    setOver(at(index, e));
  };
  return (
    <div className="cfx" onDragLeave={() => setOver(null)}>
      {inserts.map((x, i) => {
        const problem = audio.insertProblems.get(x.id);
        const name = insertName(x, lang);
        const cls = `cslot${x.bypass ? " byp" : ""}${problem ? " bad" : ""}${actions.selectedEffect === x.id ? " sel" : ""}${over === i ? " dropbefore" : ""}`;
        // A name of the user's says what the effect is in the tooltip ("EQ graves · EQ").
        const label = x.name ? `${name} · ${kindName(x, lang)}` : name;
        const title = problem ? t("fxFailed", { name: label, error: problem }) : x.kind === "plugin" ? t("fxPluginTitle", { name: label }) : t("fxOwnTitle", { name: label });
        if (actions.typing?.kind === "effectName" && actions.typing.id === x.id)
          return (
            <InlineEdit
              key={x.id}
              className="cslot ctype"
              value={name}
              maxLength={60}
              title={t("fxRenameHint")}
              onCommit={(v) => (actions.renameEffect(x.id, v), actions.type(null))}
              onCancel={() => actions.type(null)}
            />
          );
        return (
          <div
            key={x.id}
            className={cls}
            role="button"
            tabIndex={0}
            draggable
            data-fx={x.id}
            title={title}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => actions.selectEffect(x.id)}
            onDoubleClick={() => actions.openEffectWindow(x.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              actions.selectEffect(x.id);
              actions.effectMenu(x.id, e.clientX, e.clientY);
            }}
            onDragStart={(e) => {
              e.dataTransfer.setData(FX_DRAG, x.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={dragOver(i)}
            onDrop={drop(i)}
          >
            <span className="cslotname">{name}</span>
          </div>
        );
      })}
      <button
        className={`cslot add${over === inserts.length ? " dropbefore" : ""}`}
        title={t("fxAdd")}
        aria-label={t("fxAdd")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => actions.effectAddMenu(target, e.clientX, e.clientY)}
        onDragOver={dragOver(inserts.length)}
        onDrop={drop(inserts.length)}
      >
        +
      </button>
    </div>
  );
}

/**
 * A strip's sends (F2.2 part D): the bus's name over a bar with its level. Dragging across it
 * changes the level (heard at once, the song on release); double click types it; right click has
 * before or after the fader and remove. «+ envío» at the end.
 */
function Sends({ source, sends }: { source: string; sends: readonly Send[] }) {
  const { t } = useApp();
  const actions = useActions();
  const song = useSong();
  const [live, setLive] = useState<{ bus: string; level: number } | null>(null);
  const drag = useRef<{ bus: string; x0: number; l0: number; width: number } | null>(null);
  return (
    <div className="csends">
      {sends.map((x) => {
        const bus = song.buses?.[x.bus];
        if (!bus) return null;
        const level = live?.bus === x.bus ? live.level : x.level;
        if (actions.typing?.kind === "sendLevel" && actions.typing.source === source && actions.typing.bus === x.bus)
          return (
            <InlineEdit
              key={x.bus}
              className="csend ctype"
              value={formatReverb(x.level)}
              inputMode="numeric"
              maxLength={4}
              title={t("sendTypeHint")}
              onCommit={(v) => (actions.typeSend(source, x.bus, v), actions.type(null))}
              onCancel={() => actions.type(null)}
            />
          );
        const title = t("sendTitle", { bus: bus.name, level: formatReverb(level), pre: x.pre ? t("sendPreShort") : "" });
        return (
          <div
            key={x.bus}
            className={`csend${x.pre ? " pre" : ""}`}
            role="slider"
            tabIndex={0}
            aria-label={title}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(level * 100)}
            data-send={x.bus}
            title={title}
            style={{ ["--send" as string]: trackColor(bus.color) }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { bus: x.bus, x0: e.clientX, l0: x.level, width: e.currentTarget.getBoundingClientRect().width };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
              const scale = e.shiftKey ? 0.15 : 1;
              const v = Math.max(0, Math.min(1, d.l0 + ((e.clientX - d.x0) / Math.max(1, d.width)) * scale));
              setLive({ bus: d.bus, level: v });
              actions.previewSend(source, d.bus, v);
            }}
            onPointerUp={() => {
              const d = drag.current;
              drag.current = null;
              if (!d || !live) return;
              setLive(null);
              actions.setSend(source, d.bus, live.level);
            }}
            onDoubleClick={() => actions.type({ kind: "sendLevel", source, bus: x.bus })}
            onContextMenu={(e) => {
              e.preventDefault();
              actions.sendMenu(source, x.bus, e.clientX, e.clientY);
            }}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.01 : 0.05;
              const v = e.key === "ArrowRight" || e.key === "ArrowUp" ? x.level + step : e.key === "ArrowLeft" || e.key === "ArrowDown" ? x.level - step : null;
              if (v === null) return;
              e.preventDefault();
              e.stopPropagation();
              actions.setSend(source, x.bus, Math.round(Math.max(0, Math.min(1, v)) * 100) / 100);
            }}
          >
            <span className="csendname">{bus.name}</span>
            <div className="cminibar">
              <div style={{ width: `${level * 100}%` }} />
            </div>
          </div>
        );
      })}
      <button className="csend add" title={t("sendTo")} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => actions.sendAddMenu(source, e.clientX, e.clientY)}>
        {t("consoleAddSend")}
      </button>
    </div>
  );
}

/** Where a strip's sound goes: «→ Máster» or «→ Voces»; a click chooses (F2.2 part D). */
function Output({ source, bus }: { source: string; bus: string | undefined }) {
  const { t } = useApp();
  const actions = useActions();
  const name = actions.outputName(bus);
  return (
    <button className="cout" title={t("consoleOutputTitle")} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => actions.routeMenu(source, e.clientX, e.clientY)}>
      → {name}
    </button>
  );
}

/** "Altavoces (Realtek)" from "Windows Audio · Altavoces (Realtek) · 48000 Hz · 480 muestras". */
function deviceName(device: string | undefined): string | null {
  if (!device) return null;
  const part = device.split(" · ").find((p) => !/hz|samples|muestras|windows audio|wasapi|directsound|asio/i.test(p));
  return part?.trim() || null;
}

interface StripProps {
  audio: AudioLayer;
  track: Track;
  narrow: boolean;
  active: boolean;
  /** Another track is soloed: this one is silent too, as if muted (dimmed, its M untouched). */
  silenced: boolean;
  meter: MeterState;
  onClearClip(): void;
  onSelect(id: string): void;
  onToggle(id: string, field: "mute" | "solo"): void;
}

function TrackStrip({ audio, track, narrow, active, silenced, meter, onClearClip, onSelect, onToggle }: StripProps) {
  const { t, lang } = useApp();
  const actions = useActions();
  const [live, setLive] = useState<number | null>(null);
  const db = formatDb(live ?? track.volume, lang);
  const external = track.output === "external";
  const cls = `cstrip track${active ? " active" : ""}${track.mute || silenced ? " muted" : ""}${narrow ? " narrow" : ""}`;
  return (
    <div className={cls} style={{ ["--strip" as string]: trackColor(track.color ?? 0) }} data-track={track.id} onPointerDown={() => onSelect(track.id)}>
      <div className="cband" />
      {external ? (
        <div className={narrow ? "cfxcount off" : "cfx"} title={t("fxExternal")} />
      ) : (
        <FxChain audio={audio} target={track.id} inserts={track.inserts ?? []} narrow={narrow} />
      )}
      {!narrow && (external ? <div className="csends" /> : <Sends source={track.id} sends={track.sends ?? []} />)}
      {external ? (
        <div className="cout" title={t("outputDaw", { ch: track.channel + 1 })}>
          → {t("outputDawShort")}
        </div>
      ) : (
        <Output source={track.id} bus={track.bus} />
      )}
      <div className="cpan">
        <Fader
          className="fpan"
          value={track.pan}
          min={-1}
          max={1}
          reset={0}
          bipolar
          label={t("consolePan", { track: track.name })}
          valueText={formatPan(track.pan)}
          onInput={(v) => actions.previewMix(track.id, track.volume, v)}
          onCommit={(v) => actions.setMix(track.id, track.volume, v)}
        />
        {!narrow && <Typed className="cval" text={formatPan(track.pan)} title={t("consolePanType")} commit={(v) => actions.typeMix(track.id, "pan", v)} />}
      </div>
      <div className="cms">
        <button className={`msb${track.mute ? " on" : ""}`} aria-pressed={track.mute} aria-label={t("mute")} title={t("mute")} onClick={() => onToggle(track.id, "mute")}>
          M
        </button>
        <button className={`msb${track.solo ? " on" : ""}`} aria-pressed={track.solo} aria-label={t("solo")} title={t("solo")} onClick={() => onToggle(track.id, "solo")}>
          S
        </button>
      </div>
      <div className="cfaderzone">
        {!narrow && <Scale />}
        <VFader
          value={track.volume}
          reset={0.8}
          label={t("consoleFader", { track: track.name })}
          valueText={db}
          onInput={(v) => {
            setLive(v);
            actions.previewMix(track.id, v, track.pan);
          }}
          onCommit={(v) => {
            setLive(null);
            actions.setMix(track.id, v, track.pan);
          }}
        />
        <Meter m={meter} onClear={onClearClip} clipTitle={t("consoleClip")} />
      </div>
      <Typed className="cdb" text={db} title={t("consoleVolumeType")} commit={(v) => actions.typeMix(track.id, "volume", v)} />
      <div className="cname">
        <span className="ctitle" title={track.name}>
          {track.name}
        </span>
      </div>
      <div className="cinst" title={actions.soundLabel(track)}>
        {actions.soundLabel(track)}
      </div>
    </div>
  );
}

/** «Subgrupo» when tracks go into it, «Bus de envío» when only sends do. */
function busKind(song: ReturnType<typeof useSong>, bus: Bus): "busKindGroup" | "busKindSend" | "busKindEmpty" {
  const channels = [...song.trackOrder.map((id) => song.tracks[id]!), ...busList(song)].filter(Boolean);
  if (channels.some((c) => c.bus === bus.id)) return "busKindGroup";
  if (channels.some((c) => c.sends?.some((x) => x.bus === bus.id))) return "busKindSend";
  return "busKindEmpty";
}

interface BusStripProps {
  audio: AudioLayer;
  bus: Bus;
  narrow: boolean;
  silenced: boolean;
  meter: MeterState;
  onClearClip(): void;
}

/** A bus (F2.2 part D): like a track's strip, with its colour, effects, sends, output and fader. */
function BusStrip({ audio, bus, narrow, silenced, meter, onClearClip }: BusStripProps) {
  const { t, lang } = useApp();
  const actions = useActions();
  const song = useSong();
  const [live, setLive] = useState<number | null>(null);
  const db = formatDb(live ?? bus.volume, lang);
  const selected = actions.selectedBus === bus.id;
  const cls = `cstrip bus${selected ? " active" : ""}${bus.mute || silenced ? " muted" : ""}${narrow ? " narrow" : ""}`;
  return (
    <div
      className={cls}
      style={{ ["--strip" as string]: trackColor(bus.color) }}
      data-bus={bus.id}
      title={t("busTitle", { name: bus.name })}
      onPointerDown={() => actions.selectBus(bus.id)}
      onContextMenu={(e) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        actions.busMenu(bus.id, e.clientX, e.clientY);
      }}
    >
      <div className="cband" />
      <FxChain audio={audio} target={bus.id} inserts={bus.inserts ?? []} narrow={narrow} />
      {!narrow && <Sends source={bus.id} sends={bus.sends ?? []} />}
      <Output source={bus.id} bus={bus.bus} />
      <div className="cpan">
        <Fader
          className="fpan"
          value={bus.pan}
          min={-1}
          max={1}
          reset={0}
          bipolar
          label={t("busPan", { bus: bus.name })}
          valueText={formatPan(bus.pan)}
          onInput={(v) => actions.previewBus(bus.id, bus.volume, v)}
          onCommit={(v) => actions.setBusMix(bus.id, bus.volume, v)}
        />
        {!narrow && <Typed className="cval" text={formatPan(bus.pan)} title={t("consolePanType")} commit={(v) => actions.typeBusMix(bus.id, "pan", v)} />}
      </div>
      <div className="cms">
        <button className={`msb${bus.mute ? " on" : ""}`} aria-pressed={!!bus.mute} aria-label={t("mute")} title={t("mute")} onClick={() => actions.toggleBus(bus.id, "mute")}>
          M
        </button>
        <button className={`msb${bus.solo ? " on" : ""}`} aria-pressed={!!bus.solo} aria-label={t("solo")} title={t("solo")} onClick={() => actions.toggleBus(bus.id, "solo")}>
          S
        </button>
      </div>
      <div className="cfaderzone">
        {!narrow && <Scale />}
        <VFader
          value={bus.volume}
          reset={1}
          label={t("busFader", { bus: bus.name })}
          valueText={db}
          onInput={(v) => {
            setLive(v);
            actions.previewBus(bus.id, v, bus.pan);
          }}
          onCommit={(v) => {
            setLive(null);
            actions.setBusMix(bus.id, v, bus.pan);
          }}
        />
        <Meter m={meter} onClear={onClearClip} clipTitle={t("consoleClip")} />
      </div>
      <Typed className="cdb" text={db} title={t("consoleVolumeType")} commit={(v) => actions.typeBusMix(bus.id, "volume", v)} />
      <div className="cname">
        {actions.typing?.kind === "busName" && actions.typing.id === bus.id ? (
          <InlineEdit
            className="ctitle ctype"
            value={bus.name}
            maxLength={60}
            title={t("busRenameHint")}
            onCommit={(v) => (actions.renameBus(bus.id, v), actions.type(null))}
            onCancel={() => actions.type(null)}
          />
        ) : (
          <span className="ctitle" title={bus.name} onDoubleClick={() => actions.type({ kind: "busName", id: bus.id })}>
            {bus.name}
          </span>
        )}
      </div>
      <div className="cinst">{t(busKind(song, bus))}</div>
    </div>
  );
}

function MasterStrip({ audio, meter, onClearClip }: { audio: AudioLayer; meter: MeterState; onClearClip(): void }) {
  const { t, lang } = useApp();
  const actions = useActions();
  const song = useSong();
  const volume = song.masterVolume ?? 1;
  const [live, setLive] = useState<number | null>(null);
  const db = formatDb(live ?? volume, lang);
  const out = deviceName(audio.engineStatus.device) ?? t("consoleOutput");
  return (
    <div className="cstrip master" style={{ ["--strip" as string]: "var(--text)" }} data-track="master">
      <div className="cband" />
      <FxChain audio={audio} target="master" inserts={song.masterInserts ?? []} narrow={false} />
      <div className="csends" />
      <div className="cout" title={out}>
        → {out}
      </div>
      <div className="cpan" />
      <div className="cms" />
      <div className="cfaderzone">
        <Scale />
        <VFader
          value={volume}
          reset={1}
          label={t("consoleMasterHistory")}
          valueText={db}
          onInput={(v) => {
            setLive(v);
            actions.previewMaster(v);
          }}
          onCommit={(v) => {
            setLive(null);
            actions.setMasterVolume(v);
          }}
        />
        <Meter m={meter} onClear={onClearClip} clipTitle={t("consoleClip")} />
      </div>
      <Typed
        className="cdb"
        text={db}
        title={t("consoleVolumeType")}
        commit={(v) => {
          const vol = parseDb(v);
          if (vol === null) return false;
          actions.setMasterVolume(vol);
          return true;
        }}
      />
      <div className="cname">
        <span className="ctitle">{t("consoleMaster")}</span>
      </div>
      <div className="cinst">{t("consoleOutput")}</div>
    </div>
  );
}

export interface ConsoleProps {
  audio: AudioLayer;
  onSelectTrack(id: string): void;
  onToggle(id: string, field: "mute" | "solo"): void;
}

export function Console({ audio, onSelectTrack, onToggle }: ConsoleProps) {
  const song = useSong();
  const actions = useActions();
  // The selected bus and what is being typed (a bus's name, a send's level) live in the actions.
  useSyncExternalStore(actions.subscribe, actions.getVersion);
  const v = useView();
  const { t, view } = useApp();
  const tracks: Track[] = song.trackOrder.map((id) => song.tracks[id]!).filter(Boolean);
  const activeId = song.context.activeTrackId ?? tracks[0]?.id;
  const buses = busList(song);
  const meters = useMeters(audio, [
    ...tracks.map((tr) => ({ key: tr.id, strip: tr.output === "external" ? -1 : audio.stripOf(tr) })),
    ...buses.map((b) => ({ key: b.id, strip: -1, bus: audio.busIndexOf(b.id) })),
    { key: "master", strip: null },
  ]);
  const meterOf = (key: string) => meters.states.get(key) ?? SILENT_METER;
  const narrow = v.mixNarrow;
  // The plugin effects for «+»: the list the engine knows (scanned before, as in Sonidos).
  useEffect(() => {
    if (!audio.pluginList && !audio.pluginScan && audio.engineStatus.state !== "missing") void audio.loadPlugins(false);
  }, [audio]);
  // Who sounds (part D: a solo keeps on the buses a soloed track goes through or sends to).
  const on = audible(song);
  const engineOn = audio.engineStatus.state === "ready";
  return (
    <section className="console" aria-label={t("consoleLabel")}>
      <div className="ctoolbar">
        <ModeButton />
        <span className="cspacer" />
        {!engineOn && <span className="cnote">{t("consoleNoEngine")}</span>}
        <button className="tgl" title={t("consoleAddBusTitle")} onClick={() => void actions.addBus()}>
          {t("consoleAddBus")}
        </button>
        <div className="cseg">
          <button className={`cseg1${narrow ? "" : " on"}`} aria-pressed={!narrow} onClick={() => view.set({ mixNarrow: false })}>
            {t("consoleNormal")}
          </button>
          <button className={`cseg1${narrow ? " on" : ""}`} aria-pressed={narrow} onClick={() => view.set({ mixNarrow: true })}>
            {t("consoleNarrow")}
          </button>
        </div>
        <button className={`tgl${v.mixMax ? " on" : ""}`} aria-pressed={v.mixMax} title={t("consoleExpandTitle")} onClick={() => view.set({ mixMax: !v.mixMax })}>
          {v.mixMax ? t("consoleShrink") : t("consoleExpand")}
        </button>
      </div>
      <div className="cbody">
        <div className="cstrips">
          {tracks.map((tr) => (
            <TrackStrip
              key={tr.id}
              audio={audio}
              track={tr}
              narrow={narrow}
              active={tr.id === activeId}
              silenced={!tr.mute && !on.has(tr.id)}
              meter={meterOf(tr.id)}
              onClearClip={() => meters.clear(tr.id)}
              onSelect={onSelectTrack}
              onToggle={onToggle}
            />
          ))}
          {buses.length > 0 && (
            <div className="cdivider" aria-hidden="true">
              <span>{t("consoleBuses")}</span>
            </div>
          )}
          {buses.map((b) => (
            <BusStrip key={b.id} audio={audio} bus={b} narrow={narrow} silenced={!b.mute && !on.has(b.id)} meter={meterOf(b.id)} onClearClip={() => meters.clear(b.id)} />
          ))}
        </div>
        <div className="cmasterzone">
          <MasterStrip audio={audio} meter={meterOf("master")} onClearClip={() => meters.clear("master")} />
        </div>
      </div>
    </section>
  );
}
