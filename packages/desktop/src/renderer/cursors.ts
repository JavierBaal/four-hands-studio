/**
 * Mouse cursors for the tools, drawn like their buttons (Fran, 14/10/2026: tools as icons, also in
 * the cursor). Light strokes with a dark outline so they read over notes and the dark grid.
 * The hotspot is the tip that touches the music: the pencil's point, the eraser's lower edge.
 */
import { T } from "./theme.js";

/** Pencil, tip at the bottom left. 16 × 16 drawing space, as the icons. */
export const PENCIL_PATH = "M11.5 2.5l2 2-8 8-3 1 1-3z M10 4l2 2";
/** Eraser: a tilted block, the rubber end at the bottom left. */
export const ERASER_PATH = "M9.5 2.5l4 4-6.5 6.5h-3l-2-2z M5.5 6.5l4 4 M7 13h6.5";

function cursor(path: string, hotX: number, hotY: number, fallback: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="-2 -2 20 20">` +
    `<path d="${path}" fill="none" stroke="${T.bgPage}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${path}" fill="none" stroke="${T.text}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotX} ${hotY}, ${fallback}`;
}

// Hotspots in the 24 px cursor: (x + 2) × 1.2 for a point (x, y) of the 16 px drawing.
export const CURSORS = {
  pencil: cursor(PENCIL_PATH, 5, 19, "crosshair"),
  eraser: cursor(ERASER_PATH, 6, 18, "crosshair"),
} as const;
