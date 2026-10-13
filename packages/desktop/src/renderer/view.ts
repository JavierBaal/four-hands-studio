/**
 * What the user is looking at and holding: tool, grid, zoom, scroll, layers, panel.
 * Lives only in the window. Selection, loop, cursor and active track do not live here: they are
 * part of the shared context in the song, because the AI reads them (ESTUDIO_INTERFAZ.md, 8.7).
 */
import type { GridValue } from "./roll/geometry.js";
import type { NoteNames } from "./music.js";

export type Tool = "arrow" | "pencil" | "eraser";

export interface ViewState {
  tool: Tool;
  gridOn: boolean;
  grid: GridValue;
  /** Horizontal zoom of the piano roll. */
  pxPerTick: number;
  /** Tick at the left edge of the piano roll. */
  startTick: number;
  /** Vertical scroll of the piano roll, in pixels from the top row (pitch 127). */
  scrollY: number;
  authorship: boolean;
  scale: boolean;
  panelOpen: boolean;
  noteNames: NoteNames;
  /** Ctrl/Cmd held: the arrow works as a pencil (ESPEC_PIANO_ROLL.md, 3). */
  pencilHeld: boolean;
  /** Track whose notes the vertical scroll was last centred on (centred once per track). */
  centredTrack: string | null;
}

export class ViewStore {
  state: ViewState;
  private listeners = new Set<() => void>();
  version = 0;

  constructor(initial: ViewState) {
    this.state = initial;
  }

  set(changes: Partial<ViewState>): void {
    let changed = false;
    for (const [k, v] of Object.entries(changes)) {
      if (this.state[k as keyof ViewState] !== v) changed = true;
    }
    if (!changed) return;
    this.state = { ...this.state, ...changes };
    this.version++;
    for (const l of this.listeners) l();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;
}

export function initialView(lang: "es" | "en"): ViewState {
  return {
    tool: "arrow",
    gridOn: true,
    grid: "1/8",
    pxPerTick: 90 / 3840,
    startTick: 0,
    scrollY: 0,
    authorship: true,
    scale: true,
    panelOpen: true,
    noteNames: lang === "es" ? "solfege" : "letters",
    pencilHeld: false,
    centredTrack: null,
  };
}
