/** Piano roll bar (DIRECCION_ARTISTICA.md, 6.1 item 3): track, tools, grid, layers, legend, what the AI sees. */
import { barAt } from "@fourhands/core";
import { SoundOriginIcon } from "./SidePanel.js";
import { activeTrack, useActions, useApp, useSong, useView } from "../context.js";
import { barRange } from "../music.js";
import { ArrowToolIcon, EraserIcon, PencilIcon, ZoomIcon } from "./Icons.js";
import type { Tool } from "../view.js";

export interface RollToolbarProps {
  onGridMenu(anchor: HTMLElement): void;
  /** Compact window: the arrangement's corner has no room for Editor / Mezcla, so they go here. */
  compact?: boolean;
}

/** "Melodía · c. 25–26": the track and the selection, or the loop, or the cursor's bar. */
export function aiSeesText(song: ReturnType<typeof useSong>, t: ReturnType<typeof useApp>["t"]): string {
  const track = activeTrack(song);
  const ctx = song.context;
  const selected = ctx.selection.map((id) => song.notes[id]).filter((n) => n !== undefined);
  let range: string;
  if (selected.length > 0) {
    const start = Math.min(...selected.map((n) => n.start));
    const end = Math.max(...selected.map((n) => n.start + n.duration));
    range = barRange(song.meter, start, end);
  } else if (ctx.loop) {
    range = barRange(song.meter, ctx.loop.start, ctx.loop.end);
  } else {
    range = String(barAt(song.meter, ctx.cursor));
  }
  const name = track?.name ?? t("nothing");
  return `${name} · ${t("bars", { range })}`;
}

/**
 * F2.2 parte B (Fran, 03/11/2026): Editor / Mezcla in sight, so nobody has to know F2 and F3: small
 * in the arrangement's top-left corner (empty until now, seen in both modes) and in the console's bar.
 */
export function EditorMixTabs({ keys = true, small = false }: { keys?: boolean; small?: boolean }) {
  const { t, view } = useApp();
  const v = useView();
  const mix = v.bottom === "mix";
  return (
    <div className={small ? "cseg small" : "cseg"} role="tablist" aria-label={t("consoleLabel")}>
      <button role="tab" className={mix ? "cseg1" : "cseg1 on"} aria-selected={!mix} title={`${t("consoleEditor")} (F2)`} onClick={() => view.set({ bottom: "editor" })}>
        {t("consoleEditor")} {keys && <span className="kbd">F2</span>}
      </button>
      <button role="tab" className={mix ? "cseg1 on" : "cseg1"} aria-selected={mix} title={t("consoleOpenTitle")} onClick={() => view.set({ bottom: "mix" })}>
        {t("consoleMix")} {keys && <span className="kbd">F3</span>}
      </button>
    </div>
  );
}

export function RollToolbar({ onGridMenu, compact = false }: RollToolbarProps) {
  const { t, view } = useApp();
  const actions = useActions();
  const song = useSong();
  const v = useView();
  const track = activeTrack(song);
  const tool: Tool = v.pencilHeld && v.tool === "arrow" ? "pencil" : v.tool;
  // Tools as icons (Fran, 14/10/2026); the name and key are in the tooltip and for screen readers.
  const toolButton = (id: Tool, label: string, key: string, icon: React.ReactNode) => (
    <button className={tool === id ? "tool icon on" : "tool icon"} aria-pressed={tool === id} aria-label={label} title={`${label} (${key})`} onClick={() => view.set({ tool: id })}>
      {icon} <span className="kbd">{key}</span>
    </button>
  );
  return (
    <div className="rtools">
      {compact && (
        <>
          <EditorMixTabs keys={false} />
          <span className="sep" />
        </>
      )}
      <span className="rtitle">{track?.name ?? ""}</span>
      {track && (
        <button
          className="rsubb"
          title={t("changeSound")}
          onClick={() => actions.openSounds(track.id)}
        >
          <SoundOriginIcon origin={actions.soundOrigin(track)} />
          {actions.soundLabel(track)}
        </button>
      )}
      <span className="sep" />
      {toolButton("arrow", t("arrow"), "1", <ArrowToolIcon />)}
      {toolButton("pencil", t("pencil"), "2", <PencilIcon />)}
      {toolButton("eraser", t("eraser"), "3", <EraserIcon />)}
      {toolButton("zoom", t("zoomTool"), "4", <ZoomIcon />)}
      <span className="sep" />
      <button className={v.gridOn ? "tool" : "tgl"} onClick={(e) => onGridMenu(e.currentTarget)} aria-haspopup="menu">
        {v.gridOn ? `${t("grid")} ${v.grid}` : t("gridOff")} <span className="kbd">N</span>
      </button>
      <button className={v.authorship ? "tgl on" : "tgl"} aria-pressed={v.authorship} onClick={() => view.set({ authorship: !v.authorship })}>
        {t("authorship")}
      </button>
      <button className={v.scale ? "tgl on" : "tgl"} aria-pressed={v.scale} onClick={() => view.set({ scale: !v.scale })}>
        {t("scale")}
      </button>
      {v.authorship && (
        <span className="legend">
          <span>
            <span className="dot u" /> {t("you")}
          </span>
          <span>
            <span className="dot ai" /> {t("aiName")}
          </span>
        </span>
      )}
      <span style={{ flex: 1 }} />
      <span className="sees">{t("aiSees", { what: aiSeesText(song, t) })}</span>
    </div>
  );
}
