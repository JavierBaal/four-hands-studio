/**
 * The window (DIRECCION_ARTISTICA.md, 6.1): top bar, arrangement, piano roll and activity panel.
 * The layout follows the approved sketches; below 1000 px of width the compact layout applies.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { type Note, barTicks } from "@fourhands/core";
import { ActivityPanel, Rail } from "./components/ActivityPanel.js";
import { Arrangement } from "./components/Arrangement.js";
import { ContextMenu, QuantizeDialog } from "./components/Menus.js";
import { RollArea } from "./components/RollArea.js";
import { RollToolbar } from "./components/RollToolbar.js";
import { TopBar } from "./components/TopBar.js";
import { activeTrack, notesByTrack, useApp, useSize, useSong, useView } from "./context.js";
import { Editor } from "./editor.js";
import { type RollView, centerOnPitches, clampScrollY, zoomAt } from "./roll/geometry.js";
import { type Action, DEFAULT_SHORTCUTS, PIANO_MODE_ALLOWED, actionFor } from "./shortcuts.js";
import { SIZE } from "./theme.js";
import type { MenuAction } from "../shared/protocol.js";

export interface AppExtras {
  transport?: React.ComponentProps<typeof TopBar>;
  /** Extra shortcut handlers from the audio layer (play, record, piano mode). */
  onAction?: (action: Action) => boolean;
  /** True while the computer keyboard plays notes: its letters are not shortcuts. */
  pianoMode?: boolean;
  onEditor?: (editor: Editor) => void;
  /** Sounds a key of the side keyboard. */
  onKeyPress?: (pitch: number) => void;
}

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

const IDLE_TRANSPORT = { playing: false, recording: false, looping: false };

export function App({ transport, onAction, pianoMode, onEditor, onKeyPress }: AppExtras) {
  const { replica, view, t, bridge } = useApp();
  const editor = useMemo(() => new Editor(replica, view, t), []);
  useEffect(() => onEditor?.(editor), [editor]);
  const song = useSong();
  const v = useView();
  const [appRef, appSize] = useSize<HTMLDivElement>();
  const [rollSize, setRollSize] = useState({ width: 0, height: 0 });
  const compact = appSize.width > 0 && appSize.width < SIZE.compactBelow;
  const track = activeTrack(song);

  const rollView: RollView = { startTick: v.startTick, pxPerTick: v.pxPerTick, scrollY: v.scrollY, width: rollSize.width, height: rollSize.height };

  // Centre the active track's notes vertically the first time it is shown.
  useEffect(() => {
    if (!track || rollSize.height === 0 || view.state.centredTrack === track.id) return;
    view.set({ centredTrack: track.id });
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
    const on = !tr[field];
    const label = t(field === "mute" ? (on ? "hMute" : "hUnmute") : on ? "hSolo" : "hUnsolo", { name: tr.name });
    void replica.run(label, [{ type: "updateTrack", id, changes: { [field]: on } }]);
  }, []);

  const zoom = useCallback(
    (factor: number) => {
      const s = view.state;
      view.set(zoomAt({ ...rollView, startTick: s.startTick, pxPerTick: s.pxPerTick }, factor, rollSize.width / 2));
    },
    [rollSize.width],
  );

  /** Runs a shortcut or menu action. Returns false if it does not apply. */
  const perform = useCallback(
    (action: Action): boolean => {
      if (onAction?.(action)) return true;
      switch (action) {
        case "undo":
          void replica.undoLast();
          return true;
        case "redo":
          void replica.redoLast();
          return true;
        case "cut":
          editor.cut();
          return true;
        case "copy":
          editor.copy();
          return true;
        case "paste":
          editor.paste();
          return true;
        case "duplicate":
          editor.duplicate();
          return true;
        case "selectAll":
          editor.selectAll();
          return true;
        case "delete":
          editor.deleteSelection();
          return true;
        case "quantize":
          editor.quantizeSelection();
          return true;
        case "transposeUp":
          editor.transpose(1);
          return true;
        case "transposeDown":
          editor.transpose(-1);
          return true;
        case "octaveUp":
          editor.transpose(12);
          return true;
        case "octaveDown":
          editor.transpose(-12);
          return true;
        case "previousNote":
          editor.selectNeighbour(-1);
          return true;
        case "nextNote":
          editor.selectNeighbour(1);
          return true;
        case "nudgeLeft":
          editor.nudge(-1);
          return true;
        case "nudgeRight":
          editor.nudge(1);
          return true;
        case "escape":
          editor.escape();
          return true;
        case "toggleGrid":
          view.set({ gridOn: !view.state.gridOn });
          return true;
        case "zoomIn":
          zoom(1.25);
          return true;
        case "zoomOut":
          zoom(0.8);
          return true;
        case "toolArrow":
          view.set({ tool: "arrow" });
          return true;
        case "toolPencil":
          view.set({ tool: "pencil" });
          return true;
        case "toolEraser":
          view.set({ tool: "eraser" });
          return true;
        default:
          return false;
      }
    },
    [zoom, onAction],
  );

  // Keyboard: one table (shortcuts.ts). Ctrl/Cmd held turns the arrow into a pencil.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
      if (e.key === (MAC ? "Meta" : "Control")) view.set({ pencilHeld: true });
      const action = actionFor(e, DEFAULT_SHORTCUTS, MAC);
      if (!action) return;
      if (pianoMode && !PIANO_MODE_ALLOWED.has(action)) return;
      if (perform(action)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === (MAC ? "Meta" : "Control")) view.set({ pencilHeld: false });
    };
    const blur = () => view.set({ pencilHeld: false });
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [perform, pianoMode]);

  // Menu bar (main process): edit and view actions run here.
  useEffect(
    () =>
      bridge.onMenu((a: MenuAction) => {
        if (a === "toggleAuthorship") view.set({ authorship: !view.state.authorship });
        else if (a === "togglePanel") view.set({ panelOpen: !view.state.panelOpen });
        else perform(a);
      }),
    [perform],
  );

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

  useSyncExternalStore(editor.subscribe, editor.getVersion);
  const overlayMenus = editor.overlay;
  const tp = transport ?? {
    ...IDLE_TRANSPORT,
    position: song.context.cursor,
    onPlay: () => {},
    onStop: () => {},
    onLoop: () => {},
    onRecord: () => {},
  };
  const playhead = tp.playing ? tp.position : song.context.cursor;
  const visible = rollSize.width > 0 ? { start: v.startTick, end: v.startTick + rollSize.width / v.pxPerTick } : null;

  return (
    <div className={v.panelOpen ? "app" : "app pclosed"} ref={appRef}>
      <TopBar {...tp} />
      <div className="main">
        <div className="work">
          <Arrangement compact={compact} visible={visible} onSelectTrack={selectTrack} onJump={jump} onToggle={toggleTrack} />
          <section className="roll" aria-label={t("pianoRoll")}>
            <RollToolbar
              onGridMenu={(anchor) => {
                const r = anchor.getBoundingClientRect();
                editor.gridMenu(r.left, r.bottom + 4);
              }}
            />
            <RollArea v={rollView} editor={editor} playhead={playhead} onResize={setRollSize} onWheel={onWheel} onKeyPress={(p) => onKeyPress?.(p)} />
          </section>
        </div>
        <ActivityPanel />
        <Rail />
      </div>
      {overlayMenus.menu && <ContextMenu {...overlayMenus.menu} onClose={() => editor.closeMenus()} />}
      {overlayMenus.quantizeDialog && <QuantizeDialog editor={editor} {...overlayMenus.quantizeDialog} />}
    </div>
  );
}
