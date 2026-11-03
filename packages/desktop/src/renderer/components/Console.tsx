/**
 * The mixing console (F2.2 parte B, 03/11/2026), on the approved sketch (rama `bocetos-mezclador`;
 * DIRECCION_ARTISTICA.md, 13; capturas `bocetos/propuestas/mezcla_1` a `mezcla_4`).
 *
 * It takes the piano roll's place, as in Studio One (F2 the editor, F3 the console); «Ampliar» hides
 * the arrangement. A strip, top to bottom: the track's colour, insert effects, sends, output, pan,
 * M and S, the fader with its meter and scale, dB, name and sound. The Master is fixed on the right.
 *
 * In this part: the real tracks (fader = volume, pan, M and S with the usual commands, colour, name,
 * sound), live meters from the engine and the master fader. Effects, sends and buses come in parts C
 * and D: their places are there, empty, so the console does not change shape later (Fran, 03/11/2026).
 */
import { useEffect, useRef, useState } from "react";
import type { Track } from "@fourhands/core";
import { dbToVolume, formatDb, formatPan, parseDb, volumeToDb } from "../../shared/mix.js";
import { SILENT_METER, type MeterState, fracToDb, meterFrac, stepMeter } from "../../shared/meters.js";
import type { AudioLayer } from "../audio-layer.js";
import { useActions, useApp, useSong, useView } from "../context.js";
import { trackColor } from "../theme.js";
import { Fader } from "./Fader.js";
import { InlineEdit } from "./InlineEdit.js";
import { ModeButton, SWITCH_PLACE } from "./RollToolbar.js";

/** About 30 readings a second, only while the console is on screen. */
const METER_MS = 33;

/** The meters of every strip ("master" for the Master), stepped with each reading. */
function useMeters(audio: AudioLayer, strips: ReadonlyArray<{ key: string; strip: number | null }>): {
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
            const reading = !levels ? null : s.strip === null ? levels.master : (levels.channels[s.strip] ?? null);
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
 * A value typed in place (Fran, 03/11/2026): one click opens the field; Enter or leaving it writes
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

function TrackStrip({ track, narrow, active, silenced, meter, onClearClip, onSelect, onToggle }: StripProps) {
  const { t, lang } = useApp();
  const actions = useActions();
  const [live, setLive] = useState<number | null>(null);
  const db = formatDb(live ?? track.volume, lang);
  const external = track.output === "external";
  const cls = `cstrip track${active ? " active" : ""}${track.mute || silenced ? " muted" : ""}${narrow ? " narrow" : ""}`;
  return (
    <div className={cls} style={{ ["--strip" as string]: trackColor(track.color ?? 0) }} data-track={track.id} onPointerDown={() => onSelect(track.id)}>
      <div className="cband" />
      {narrow ? (
        <div className="cfxcount" title={t("consoleFxLater")}>
          —
        </div>
      ) : (
        <div className="cfx">
          <div className="cslot add off" title={t("consoleFxLater")} aria-disabled="true">
            +
          </div>
        </div>
      )}
      {!narrow && (
        <div className="csends">
          <div className="csend add off" title={t("consoleSendsLater")} aria-disabled="true">
            {t("consoleAddSend")}
          </div>
        </div>
      )}
      <div className="cout" title={external ? t("outputDaw", { ch: track.channel + 1 }) : t("consoleToMaster")}>
        → {external ? t("outputDawShort") : t("consoleToMaster")}
      </div>
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
      <div className="cfx">
        <div className="cslot add off" title={t("consoleFxLater")} aria-disabled="true">
          +
        </div>
      </div>
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
  const v = useView();
  const { t, view } = useApp();
  const tracks: Track[] = song.trackOrder.map((id) => song.tracks[id]!).filter(Boolean);
  const activeId = song.context.activeTrackId ?? tracks[0]?.id;
  const meters = useMeters(audio, [...tracks.map((tr) => ({ key: tr.id, strip: tr.output === "external" ? -1 : audio.stripOf(tr) })), { key: "master", strip: null }]);
  const meterOf = (key: string) => meters.states.get(key) ?? SILENT_METER;
  const narrow = v.mixNarrow;
  const anySolo = tracks.some((tr) => tr.solo);
  const engineOn = audio.engineStatus.state === "ready";
  return (
    <section className="console" aria-label={t("consoleLabel")}>
      <div className="ctoolbar">
        {SWITCH_PLACE === "left" && <ModeButton />}
        <span className="cspacer" />
        {!engineOn && <span className="cnote">{t("consoleNoEngine")}</span>}
        <button className="tgl" disabled title={t("consoleBusesLater")}>
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
        {SWITCH_PLACE === "right" && (
          <>
            <span className="sep" />
            <ModeButton />
          </>
        )}
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
              silenced={anySolo && !tr.solo}
              meter={meterOf(tr.id)}
              onClearClip={() => meters.clear(tr.id)}
              onSelect={onSelectTrack}
              onToggle={onToggle}
            />
          ))}
        </div>
        <div className="cmasterzone">
          <MasterStrip audio={audio} meter={meterOf("master")} onClearClip={() => meters.clear("master")} />
        </div>
      </div>
    </section>
  );
}
