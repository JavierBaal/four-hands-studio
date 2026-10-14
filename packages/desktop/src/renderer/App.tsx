/**
 * The window (DIRECCION_ARTISTICA.md, 6.1): top bar, arrangement, piano roll and activity panel.
 * The layout follows the approved sketches; below 1000 px of width the compact layout applies.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Note } from "@fourhands/core";
import { ActivityPanel, Rail } from "./components/ActivityPanel.js";
import { AiWritingBar } from "./components/AiPresence.js";
import { Arrangement } from "./components/Arrangement.js";
import { ContextMenu, QuantizeDialog } from "./components/Menus.js";
import { RollArea } from "./components/RollArea.js";
import { RollToolbar } from "./components/RollToolbar.js";
import { TopBar } from "./components/TopBar.js";
import { ActionsCtx, activeTrack, notesByTrack, useApp, useSize, useSong, useView } from "./context.js";
import { Mixer } from "./components/Mixer.js";
import { KeyGuide } from "./components/KeyGuide.js";
import { Notice, SoundsHelp } from "./components/SoundsHelp.js";
import { SongActions } from "./song-actions.js";
import { Editor } from "./editor.js";
import { type RollView, centerOnPitches, clampScrollY, zoomAt } from "./roll/geometry.js";
import type { AudioLayer } from "./audio-layer.js";
import type { Position } from "./view.js";
import { type Action, DEFAULT_SHORTCUTS, PIANO_MODE_ALLOWED, actionFor } from "./shortcuts.js";
import { SIZE } from "./theme.js";
import type { MenuAction } from "../shared/protocol.js";

export interface AppProps {
  audio: AudioLayer;
  onEditor?: (editor: Editor) => void;
}

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);


export function App({ audio, onEditor }: AppProps) {
  const { replica, view, t, bridge, lang } = useApp();
  const editor = useMemo(() => new Editor(replica, view, t), []);
  const actions = useMemo(() => new SongActions(replica, editor, t, lang, audio), []);
  useSyncExternalStore(audio.subscribe, audio.getVersion);
  const pianoMode = audio.pianoMode;
  useEffect(() => {
    editor.audition = (pitch, velocity) => audio.audition(pitch, velocity);
    audio.onDraft = (notes) => editor.showDraft(notes);
    audio.onToStart = () => view.animate({ startTick: 0 }, 260);
    onEditor?.(editor);
  }, [editor]);
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

  const pan = useCallback((startTick: number, animate: boolean) => {
    if (animate) view.animate({ startTick });
    else {
      view.stopAnimation();
      view.set({ startTick });
    }
  }, []);

  const toggleTrack = useCallback((id: string, field: "mute" | "solo") => {
    const tr = replica.song.tracks[id];
    if (!tr) return;
    const on = !tr[field];
    const label = t(field === "mute" ? (on ? "hMute" : "hUnmute") : on ? "hSolo" : "hUnsolo", { name: tr.name });
    void replica.run(label, [{ type: "updateTrack", id, changes: { [field]: on } }]);
  }, []);

  const zoom = useCallback(
    (factor: number) => {
      view.glide((g) => zoomAt({ ...rollView, startTick: g.startTick, pxPerTick: g.pxPerTick }, factor, rollSize.width / 2));
    },
    [rollSize.width],
  );

  /** Runs a shortcut or menu action. Returns false if it does not apply. */
  const perform = useCallback(
    (action: Action): boolean => {
      switch (action) {
        case "playStop":
          audio.playStop();
          return true;
        case "toStart":
          audio.toStart();
          return true;
        case "record":
          audio.toggleRecord();
          return true;
        case "pianoMode":
          audio.togglePiano();
          return true;
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
    [zoom],
  );

  // Keyboard: one table (shortcuts.ts). Ctrl/Cmd held turns the arrow into a pencil.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
      if (e.key === (MAC ? "Meta" : "Control")) view.set({ pencilHeld: true });
      // The computer keyboard as a piano takes its keys first (ESPEC_PIANO_ROLL.md, 8.2).
      if (audio.keyDown(e)) {
        e.preventDefault();
        return;
      }
      const action = actionFor(e, DEFAULT_SHORTCUTS, MAC);
      if (!action) return;
      if (pianoMode && !PIANO_MODE_ALLOWED.has(action)) return;
      if (perform(action)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === (MAC ? "Meta" : "Control")) view.set({ pencilHeld: false });
      audio.keyUp(e);
    };
    const blur = () => {
      view.set({ pencilHeld: false });
      audio.releaseAll();
    };
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
      // Lines (Firefox) and pages become pixels; every step glides instead of jumping.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rollSize.height : 1;
      const deltaX = e.deltaX * unit;
      const deltaY = e.deltaY * unit;
      const at = (g: Position): RollView => ({ ...rollView, ...g });
      if (e.ctrlKey || e.metaKey) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const anchor = e.clientX - rect.left;
        view.glide((g) => zoomAt(at(g), Math.exp(-deltaY * 0.0015), anchor));
      } else if (e.shiftKey || Math.abs(deltaX) > Math.abs(deltaY)) {
        const dx = e.shiftKey ? deltaY || deltaX : deltaX;
        view.glide((g) => ({ startTick: Math.max(0, g.startTick + dx / g.pxPerTick) }));
      } else {
        view.glide((g) => ({ scrollY: clampScrollY(at(g), g.scrollY + deltaY) }));
      }
    },
    [rollSize.width, rollSize.height],
  );

  useSyncExternalStore(editor.subscribe, editor.getVersion);
  const overlayMenus = editor.overlay;
  const playhead = audio.player.playing ? null : song.context.cursor;
  const visible = rollSize.width > 0 ? { start: v.startTick, end: v.startTick + rollSize.width / v.pxPerTick } : null;

  // What the user sees, for the AI's get_user_context (note names, colours, visible bars).
  const visibleStart = visible ? Math.round(visible.start) : null;
  const visibleEnd = visible ? Math.round(visible.end) : null;
  useEffect(() => {
    const id = setTimeout(() => {
      bridge.viewInfo({
        noteNames: v.noteNames,
        authorship: v.authorship,
        visible: visibleStart !== null && visibleEnd !== null ? { start: visibleStart, end: visibleEnd } : null,
      });
    }, 300);
    return () => clearTimeout(id);
  }, [v.noteNames, v.authorship, visibleStart, visibleEnd]);

  return (
    <ActionsCtx.Provider value={actions}>
    <div
      className={v.panelOpen ? "app" : "app pclosed"}
      ref={appRef}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        const files = [...e.dataTransfer.files];
        if (!files.length) return;
        e.preventDefault();
        void actions.dropSounds(files);
      }}
    >
      <TopBar audio={audio} />
      <div className="main">
        <div className="work">
          <Arrangement compact={compact} visible={visible} onSelectTrack={selectTrack} onPan={pan} onToggle={toggleTrack} />
          <section className="roll" aria-label={t("pianoRoll")}>
            <RollToolbar
              onGridMenu={(anchor) => {
                const r = anchor.getBoundingClientRect();
                editor.gridMenu(r.left, r.bottom + 4);
              }}
            />
            <RollArea v={rollView} editor={editor} audio={audio} playhead={playhead} onResize={setRollSize} onWheel={onWheel} onKeyPress={(p) => audio.audition(p, 90)} />
            <KeyGuide audio={audio} />
          </section>
        </div>
        <ActivityPanel />
        <Rail />
      </div>
      <AiWritingBar />
      {overlayMenus.menu && <ContextMenu {...overlayMenus.menu} onClose={() => editor.closeMenus()} />}
      {overlayMenus.quantizeDialog && <QuantizeDialog editor={editor} {...overlayMenus.quantizeDialog} />}
      <Mixer />
      <SoundsHelp audio={audio} />
      <Notice />
    </div>
    </ActionsCtx.Provider>
  );
}
