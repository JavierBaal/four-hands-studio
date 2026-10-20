/**
 * The AI in the window (H3), as capture 07 shows it (DIRECCION_ARTISTICA.md, 11;
 * bocetos/lienzo/Estados.dc.html):
 * - the AI status chip in the top bar: not connected, connected, reading, writing (with "Ir allí");
 * - the bar "Claude está escribiendo" with "Cerrar intervención", where the proposal bar goes;
 * - the "señalar" flag over the piano roll, and the edge tab when the AI writes out of view.
 * None of them moves the user's view: only the user's click on "Ir" does.
 */
import { barAt, barStart } from "@fourhands/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { AudioLayer } from "../audio-layer.js";
import type { AiWriting } from "../../shared/protocol.js";
import { useApp, useAi, useSong } from "../context.js";
import { barRange } from "../music.js";
import type { RollView } from "../roll/geometry.js";

/** Takes the user to a place: the piano roll slides there (a bar of margin) and opens the track. */
function useGoTo() {
  const { view, replica } = useApp();
  return (start: number, trackId?: string, noteIds?: string[]) => {
    const song = replica.song;
    const bar = barAt(song.meter, start);
    view.animate({ startTick: Math.max(0, barStart(song.meter, Math.max(1, bar - 1))) }, 260);
    const changes: { activeTrackId?: string; selection?: string[] } = {};
    if (trackId && song.tracks[trackId] && song.context.activeTrackId !== trackId) changes.activeTrackId = trackId;
    if (noteIds?.length) changes.selection = noteIds.filter((id) => song.notes[id]);
    if (Object.keys(changes).length) void replica.setContext(changes);
  };
}

/** "Chelos, c. 17–20" */
function where(w: AiWriting, song: ReturnType<typeof useSong>, t: ReturnType<typeof useApp>["t"]): string | null {
  if (w.start === null || w.end === null) return null;
  const tracks = w.trackIds.map((id) => song.tracks[id]?.name).filter(Boolean);
  const bars = t("bars", { range: barRange(song.meter, w.start, w.end) });
  return tracks.length ? `${tracks.join(", ")}, ${bars}` : bars;
}

export function AiChip() {
  const { t, bridge } = useApp();
  const ai = useAi();
  const song = useSong();
  const goTo = useGoTo();
  if (ai.clients.length === 0) {
    return (
      <span className="aichip">
        <span className="chip">
          <span className="dot off" />
          {t("aiOff")}
        </span>
        <button className="linkbtn" onClick={() => bridge.connectClaude()}>
          {t("aiHowTo")}
        </button>
      </span>
    );
  }
  const writing = ai.writing[0];
  if (writing) {
    const place = where(writing, song, t);
    return (
      <span className="aichip">
        <span className="chip" title={writing.description}>
          <span className="dot busy" />
          {place ? t("aiWritingIn", { name: writing.name, where: place }) : t("aiWritingNow", { name: writing.name })}
        </span>
        {writing.start !== null && (
          <button className="linkbtn" onClick={() => goTo(writing.start!, writing.trackIds[0])}>
            {t("aiGoThere")}
          </button>
        )}
      </span>
    );
  }
  const name = ai.clients[0]!.name;
  return (
    <span className="aichip">
      <span className="chip">
        <span className={ai.reading ? "dot busy" : "dot ai"} />
        {ai.reading ? t("aiReading", { name: ai.reading }) : t("aiConnected", { name })}
      </span>
    </span>
  );
}

/** "Claude está escribiendo · Reharmonizo el coro" with the notes so far and "Cerrar intervención". */
export function AiWritingBar() {
  const { t, bridge } = useApp();
  const ai = useAi();
  const writing = ai.writing[0];
  if (!writing) return null;
  const meta = writing.notes === 0 ? t("aiWritingMetaNone") : writing.notes === 1 ? t("aiWritingMetaOne") : t("aiWritingMeta", { n: writing.notes });
  return (
    <div className="aibar" role="status" aria-live="polite">
      <div className="pdesc">
        <b>{t("aiWritingNow", { name: writing.name })}</b> · {writing.description}
        <div className="pmeta">{meta}</div>
      </div>
      <button className="btn aibtn" onClick={() => bridge.closeIntervention(writing.id)}>
        {t("aiCloseIntervention")}
      </button>
    </div>
  );
}

/**
 * H4, Con / Sin (decided with Fran, 20/10/2026): the AI's changes go straight into the song, and
 * after each intervention this bar lets the user hear the song with and without it (B), or undo
 * it. No accepting or discarding: it is gone as soon as anything else changes the song. Same look
 * as the proposal bar of sketches 01 and 07, without Aceptar and Descartar.
 */
export function AiCompareBar({ audio }: { audio: AudioLayer }) {
  const { t, replica } = useApp();
  const ai = useAi();
  useSong();
  useSyncExternalStore(audio.subscribe, audio.getVersion);
  const last = replica.undo.lastAi;
  const [hidden, setHidden] = useState<number | null>(null);
  useEffect(() => {
    if (!last) setHidden(null);
  }, [last?.revision]);
  if (!last || ai.writing.length > 0 || hidden === last.revision) return null;
  const name = ai.clients.find((c) => c.client === last.client)?.name ?? (last.client.startsWith("claude") || last.client.startsWith("local-agent") ? "Claude" : last.client);
  const without = audio.compare === "without";
  return (
    <div className={without ? "aibar cmpbar sin" : "aibar cmpbar"} role="region" aria-label={t("cmpRegion")}>
      <div className="pdesc">
        <b>{t("cmpTitle", { name })}</b> · {last.label}
        <div className="pmeta">{without ? t("cmpMetaWithout") : t("cmpMeta")}</div>
      </div>
      <div className="seg" role="group" aria-label={t("cmpGroup")}>
        <button className={without ? "segb" : "segb on"} aria-pressed={!without} onClick={() => void audio.setCompare("with")}>
          {t("cmpWith")}
        </button>
        <button className={without ? "segb on" : "segb"} aria-pressed={without} onClick={() => void audio.setCompare("without")}>
          {t("cmpWithout")}
        </button>
      </div>
      <span className="kbd" aria-hidden="true">B</span>
      <button className="btn aibtn" onClick={() => void replica.undoLast()}>
        {t("cmpUndo")}
      </button>
      <button
        className="ibtn cmpclose"
        aria-label={t("cmpHide")}
        title={t("cmpHide")}
        onClick={() => {
          void audio.setCompare("with");
          setHidden(last.revision);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/** Over the piano roll: the AI's mark, and the tab on the edge when it writes out of view. */
export function AiOverlay({ v }: { v: RollView }) {
  const { t, bridge } = useApp();
  const ai = useAi();
  const song = useSong();
  const goTo = useGoTo();
  const viewEnd = v.startTick + v.width / v.pxPerTick;
  const mark = ai.mark;
  const writing = ai.writing.find((w) => w.start !== null && w.end !== null);
  let edge: { side: "left" | "right"; w: AiWriting } | null = null;
  if (writing && v.width > 0) {
    if (writing.start! >= viewEnd) edge = { side: "right", w: writing };
    else if (writing.end! <= v.startTick) edge = { side: "left", w: writing };
  }
  if (!mark && !edge) return null;
  let flagLeft = 8;
  if (mark) {
    const x = (mark.start - v.startTick) * v.pxPerTick;
    flagLeft = Math.max(8, Math.min(Math.max(8, v.width - 360), x));
  }
  return (
    <>
      {mark && (
        <div className="pflag" style={{ left: flagLeft }} role="note">
          <span>
            {t("aiPoints", { name: mark.name, where: t("bars", { range: barRange(song.meter, mark.start, mark.end) }) })} {mark.reason}
          </span>
          <button
            className="linkbtn"
            onClick={() => {
              goTo(mark.start, mark.trackIds[0], mark.noteIds);
              bridge.markSeen(mark.id);
            }}
          >
            {t("aiGo")}
          </button>
        </div>
      )}
      {edge && (
        <button className={edge.side === "right" ? "edge" : "edge left"} onClick={() => goTo(edge.w.start!, edge.w.trackIds[0])} title={edge.w.description}>
          {edge.side === "left" && <Arrow left />}
          {t("aiEdge", { name: edge.w.name })}
          {edge.side === "right" && <Arrow />}
        </button>
      )}
    </>
  );
}

function Arrow({ left = false }: { left?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" style={left ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M3 7h8M8 4l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
