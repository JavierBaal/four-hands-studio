/**
 * The window (DIRECCION_ARTISTICA.md, 6.1): top bar, arrangement, piano roll and activity panel.
 * The layout follows the approved sketches; below 1000 px of width the compact layout applies.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Note, barTicks } from "@fourhands/core";
import { ActivityPanel, Rail } from "./components/ActivityPanel.js";
import { Arrangement } from "./components/Arrangement.js";
import { RollArea, type RollHandlers, type RollOverlay } from "./components/RollArea.js";
import { RollToolbar } from "./components/RollToolbar.js";
import { TopBar } from "./components/TopBar.js";
import { activeTrack, notesByTrack, useApp, useSize, useSong, useView } from "./context.js";
import { type RollView, centerOnPitches, clampScrollY, zoomAt } from "./roll/geometry.js";
import { SIZE } from "./theme.js";

export interface AppExtras {
  /** Handlers and overlay from the editing layer (gestures.ts), when present. */
  useEditing?: (v: RollView) => { handlers: RollHandlers; overlay: Omit<RollOverlay, "playhead"> };
  transport?: React.ComponentProps<typeof TopBar>;
}

const IDLE_TRANSPORT = { playing: false, recording: false, looping: false };

export function App({ useEditing, transport }: AppExtras) {
  const { replica, view, t } = useApp();
  const song = useSong();
  const v = useView();
  const [appRef, appSize] = useSize<HTMLDivElement>();
  const [rollSize, setRollSize] = useState({ width: 0, height: 0 });
  const compact = appSize.width > 0 && appSize.width < SIZE.compactBelow;
  const track = activeTrack(song);
  const centred = useRef<string | null>(null);

  const rollView: RollView = { startTick: v.startTick, pxPerTick: v.pxPerTick, scrollY: v.scrollY, width: rollSize.width, height: rollSize.height };

  // Centre the active track's notes vertically the first time it is shown.
  useEffect(() => {
    if (!track || rollSize.height === 0 || centred.current === track.id) return;
    centred.current = track.id;
    const notes = notesByTrack(song).get(track.id) ?? [];
    if (notes.length === 0) {
      view.set({ scrollY: centerOnPitches(rollView, 60, 72) });
      return;
    }
    const pitches = notes.map((n: Note) => n.pitch);
    view.set({ scrollY: centerOnPitches(rollView, Math.min(...pitches), Math.max(...pitches)) });
  }, [track?.id, rollSize.height]);

  const selectTrack = useCallback((id: string) => {
    void replica.setContext({ activeTrackId: id, selection: [] });
  }, []);

  const jump = useCallback(
    (tick: number) => {
      const span = rollSize.width / view.state.pxPerTick;
      const bar = barTicks(song.meter);
      view.set({ startTick: Math.max(0, Math.floor((tick - span / 2) / bar) * bar) });
    },
    [rollSize.width, song.meter],
  );

  const toggleTrack = useCallback((id: string, field: "mute" | "solo") => {
    const tr = replica.song.tracks[id];
    if (!tr) return;
    void replica.run(t(field === "mute" ? "mute" : "solo"), [{ type: "updateTrack", id, changes: { [field]: !tr[field] } }]);
  }, []);

  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const s = view.state;
      const current: RollView = { ...rollView, startTick: s.startTick, pxPerTick: s.pxPerTick, scrollY: s.scrollY };
      if (e.ctrlKey || e.metaKey) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        view.set(zoomAt(current, Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left));
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const dx = e.shiftKey ? e.deltaY || e.deltaX : e.deltaX;
        view.set({ startTick: Math.max(0, s.startTick + dx / s.pxPerTick) });
      } else {
        view.set({ scrollY: clampScrollY(current, s.scrollY + e.deltaY) });
      }
    },
    [rollSize.width, rollSize.height],
  );

  const editing = useEditing?.(rollView);
  const handlers = useMemo(() => ({ ...editing?.handlers, onWheel }), [editing?.handlers, onWheel]);
  const tp = transport ?? {
    ...IDLE_TRANSPORT,
    position: song.context.cursor,
    onPlay: () => {},
    onStop: () => {},
    onLoop: () => {},
    onRecord: () => {},
  };
  const overlay: RollOverlay = { ...(editing?.overlay ?? {}), playhead: tp.playing ? tp.position : song.context.cursor };
  const visible = rollSize.width > 0 ? { start: v.startTick, end: v.startTick + rollSize.width / v.pxPerTick } : null;

  return (
    <div className={v.panelOpen ? "app" : "app pclosed"} ref={appRef}>
      <TopBar {...tp} />
      <div className="main">
        <div className="work">
          <Arrangement compact={compact} visible={visible} onSelectTrack={selectTrack} onJump={jump} onToggle={toggleTrack} />
          <section className="roll" aria-label={t("pianoRoll")}>
            <RollToolbar onGridMenu={() => view.set({ gridOn: !view.state.gridOn })} />
            <RollArea v={rollView} overlay={overlay} handlers={handlers} onResize={setRollSize} />
          </section>
        </div>
        <ActivityPanel />
        <Rail />
      </div>
    </div>
  );
}
