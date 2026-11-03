/** Piano roll bar (DIRECCION_ARTISTICA.md, 6.1 item 3): track, tools, grid, layers, legend, what the AI sees. */
import { barAt } from "@fourhands/core";
import { SoundOriginIcon } from "./SidePanel.js";
import { activeTrack, useActions, useApp, useSong, useView } from "../context.js";
import { barRange } from "../music.js";
import { ArrowToolIcon, EditorIcon, EraserIcon, MixIcon, PencilIcon, ZoomIcon } from "./Icons.js";
import type { Tool } from "../view.js";

export interface RollToolbarProps {
  onGridMenu(anchor: HTMLElement): void;
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
 * F2.2 parte B (Fran, 03/11/2026): one button that says where it takes you, «Mezcla» in the editor
 * and «Editor» in the console, first in both bars, so it is always in the same place. Never pressed:
 * it is an action, not a layer like Autoría or Escala. The keys (F2, F3) are in the tooltip.
 */
export function ModeButton() {
  const { t, view } = useApp();
  const v = useView();
  const mix = v.bottom === "mix";
  return (
    <button className="tool modeb" title={mix ? t("consoleBackTitle") : t("consoleOpenTitle")} onClick={() => view.set({ bottom: mix ? "editor" : "mix" })}>
      {mix ? <EditorIcon /> : <MixIcon />}
      {mix ? t("consoleEditor") : t("consoleMix")}
    </button>
  );
}

export function RollToolbar({ onGridMenu }: RollToolbarProps) {
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
      <ModeButton />
      <span className="sep" />
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
