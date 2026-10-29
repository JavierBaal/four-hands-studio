/**
 * Keyboard shortcuts in one table that can be changed (ESPEC_PIANO_ROLL.md, 6.4).
 * `mod` is Ctrl on Windows and Cmd on Mac, resolved in one place (ESPEC, 9).
 * Letters match the character typed; digits, arrows and space match the physical key.
 */
export type Action =
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "duplicate"
  | "selectAll"
  | "delete"
  | "quantize"
  | "transposeUp"
  | "transposeDown"
  | "octaveUp"
  | "octaveDown"
  | "previousNote"
  | "nextNote"
  | "nudgeLeft"
  | "nudgeRight"
  | "escape"
  | "playStop"
  | "toStart"
  | "toggleGrid"
  | "zoomOut"
  | "zoomIn"
  | "zoomRowsOut"
  | "save"
  | "settings"
  | "zoomRowsIn"
  | "toolZoom"
  | "toolArrow"
  | "toolPencil"
  | "toolEraser"
  | "record"
  | "compare"
  | "pianoMode";

export interface Combo {
  /** `KeyboardEvent.key`, lower case, for letters. */
  key?: string;
  /** `KeyboardEvent.code`, for physical keys. */
  code?: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export const DEFAULT_SHORTCUTS: Record<Action, Combo[]> = {
  save: [{ key: "s", mod: true }],
  settings: [{ key: ",", mod: true }],
  undo: [{ key: "z", mod: true }],
  redo: [{ key: "y", mod: true }, { key: "z", mod: true, shift: true }],
  cut: [{ key: "x", mod: true }],
  copy: [{ key: "c", mod: true }],
  paste: [{ key: "v", mod: true }],
  duplicate: [{ key: "d", mod: true }],
  selectAll: [{ key: "a", mod: true }],
  delete: [{ code: "Delete" }, { code: "Backspace" }],
  quantize: [{ key: "q" }],
  transposeUp: [{ code: "ArrowUp" }],
  transposeDown: [{ code: "ArrowDown" }],
  octaveUp: [{ code: "ArrowUp", shift: true }],
  octaveDown: [{ code: "ArrowDown", shift: true }],
  previousNote: [{ code: "ArrowLeft" }],
  nextNote: [{ code: "ArrowRight" }],
  nudgeLeft: [{ code: "ArrowLeft", alt: true }],
  nudgeRight: [{ code: "ArrowRight", alt: true }],
  escape: [{ code: "Escape" }],
  playStop: [{ code: "Space" }],
  toStart: [{ code: "Home" }],
  toggleGrid: [{ key: "n" }],
  zoomOut: [{ key: "g" }],
  zoomIn: [{ key: "h" }],
  // Vertical zoom (ESPEC_PIANO_ROLL.md, 6.2): taller or shorter rows, by comfortable steps.
  zoomRowsOut: [{ key: "g", shift: true }],
  zoomRowsIn: [{ key: "h", shift: true }],
  toolArrow: [{ code: "Digit1" }, { code: "Numpad1" }],
  toolPencil: [{ code: "Digit2" }, { code: "Numpad2" }],
  toolEraser: [{ code: "Digit3" }, { code: "Numpad3" }],
  toolZoom: [{ code: "Digit4" }, { code: "Numpad4" }],
  record: [{ key: "r" }],
  // H4: hear the song with or without the last AI intervention (Con / Sin).
  compare: [{ code: "KeyB" }],
  pianoMode: [{ code: "KeyK", mod: true }],
};

/** Actions that keep working while the computer keyboard plays notes (ESPEC_PIANO_ROLL.md, 8.2). */
export const PIANO_MODE_ALLOWED: ReadonlySet<Action> = new Set<Action>([
  "playStop",
  "compare",
  "toStart",
  "record",
  "quantize",
  "transposeUp",
  "transposeDown",
  "octaveUp",
  "octaveDown",
  "previousNote",
  "nextNote",
  "nudgeLeft",
  "nudgeRight",
  "toolArrow",
  "toolPencil",
  "toolEraser",
  "toolZoom",
  "save",
  "settings",
  "delete",
  "escape",
  "undo",
  "redo",
  "cut",
  "copy",
  "paste",
  "duplicate",
  "selectAll",
  "pianoMode",
]);

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function matches(e: KeyLike, c: Combo, mac: boolean): boolean {
  const mod = mac ? e.metaKey : e.ctrlKey;
  const otherMod = mac ? e.ctrlKey : e.metaKey;
  if (!!c.mod !== mod || otherMod) return false;
  if (!!c.shift !== e.shiftKey || !!c.alt !== e.altKey) return false;
  if (c.code) return e.code === c.code;
  if (c.key) return e.key.toLowerCase() === c.key;
  return false;
}

export function actionFor(e: KeyLike, table: Record<Action, Combo[]>, mac: boolean): Action | null {
  for (const [action, combos] of Object.entries(table) as [Action, Combo[]][]) {
    if (combos.some((c) => matches(e, c, mac))) return action;
  }
  return null;
}
