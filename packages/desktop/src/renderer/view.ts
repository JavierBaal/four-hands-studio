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
  /** Which lane shows under the piano roll (ESPEC_PIANO_ROLL.md, 7). */
  lane: "velocity" | "pedal";
}

/** Where the piano roll is looking: the fields that move smoothly. */
export type Position = Pick<ViewState, "startTick" | "pxPerTick" | "scrollY">;

/** Time constant of a glide: about 90 % of the way in 2.3 × this. */
const GLIDE_MS = 45;

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Zoom moves in ratios (log space), so zooming in and out feel the same; the rest, linearly. */
function mix(key: keyof Position, from: number, to: number, k: number): number {
  if (key === "pxPerTick" && from > 0 && to > 0) return from * Math.pow(to / from, k);
  return from + (to - from) * k;
}

export class ViewStore {
  state: ViewState;
  private listeners = new Set<() => void>();
  version = 0;

  constructor(initial: ViewState) {
    this.state = initial;
  }

  /** Changes the view at once. Setting a position field stops any movement in progress. */
  set(changes: Partial<ViewState>): void {
    if ("startTick" in changes || "pxPerTick" in changes || "scrollY" in changes) this.stopAnimation();
    this.apply(changes);
  }

  private apply(changes: Partial<ViewState>): void {
    let changed = false;
    for (const [k, v] of Object.entries(changes)) {
      if (this.state[k as keyof ViewState] !== v) changed = true;
    }
    if (!changed) return;
    this.state = { ...this.state, ...changes };
    this.version++;
    for (const l of this.listeners) l();
  }

  private animation = 0;
  private animating = false;
  private goal: Position | null = null;

  /** True while the view is moving on its own (an animation or a glide). */
  get moving(): boolean {
    return this.animating || this.goal !== null;
  }

  /**
   * Moves the view smoothly to new values (jumps: clicking the arrangement, turning the page while
   * playing) with an ease-out curve. Respects "reduce motion".
   */
  animate(target: Partial<Position>, ms = 180): void {
    this.stopAnimation();
    if (reducedMotion() || ms <= 0) {
      this.apply(target);
      return;
    }
    const from = this.position();
    const t0 = performance.now();
    this.animating = true;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const next: Partial<ViewState> = {};
      for (const key of Object.keys(target) as (keyof Position)[]) next[key] = mix(key, from[key], target[key]!, e);
      this.apply(next);
      if (k < 1) this.animation = requestAnimationFrame(step);
      else this.animating = false;
    };
    this.animation = requestAnimationFrame(step);
  }

  /**
   * Wheel, trackpad and zoom keys: the view glides toward a goal that each new event pushes
   * further, so a mouse wheel's steps become one smooth movement. `update` gets the goal so far.
   */
  glide(update: (goal: Position) => Partial<Position>): void {
    if (reducedMotion()) {
      this.set(update(this.position()));
      return;
    }
    if (this.animating) {
      cancelAnimationFrame(this.animation);
      this.animating = false;
    }
    const base = this.goal ?? this.position();
    this.goal = { ...base, ...update(base) };
    if (this.animation) return;
    let last = performance.now();
    const step = () => {
      const goal = this.goal;
      if (!goal) return;
      const now = performance.now();
      const k = 1 - Math.exp(-(now - last) / GLIDE_MS);
      last = now;
      const cur = this.position();
      const next: Position = {
        startTick: mix("startTick", cur.startTick, goal.startTick, k),
        pxPerTick: mix("pxPerTick", cur.pxPerTick, goal.pxPerTick, k),
        scrollY: mix("scrollY", cur.scrollY, goal.scrollY, k),
      };
      const done =
        Math.abs(next.startTick - goal.startTick) * goal.pxPerTick < 0.25 &&
        Math.abs(next.scrollY - goal.scrollY) < 0.25 &&
        Math.abs(next.pxPerTick / goal.pxPerTick - 1) < 0.0005;
      this.apply(done ? goal : next);
      if (done) {
        this.goal = null;
        this.animation = 0;
      } else this.animation = requestAnimationFrame(step);
    };
    this.animation = requestAnimationFrame(step);
  }

  /** Stops any movement in progress (a drag or a direct change takes over). */
  stopAnimation(): void {
    cancelAnimationFrame(this.animation);
    this.animation = 0;
    this.animating = false;
    this.goal = null;
  }

  private position(): Position {
    return { startTick: this.state.startTick, pxPerTick: this.state.pxPerTick, scrollY: this.state.scrollY };
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
    lane: "velocity",
  };
}
