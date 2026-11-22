/**
 * Annotations on their own ruler, in lanes that never overlap (20/10/2026: on the form ruler
 * they covered the section names and each other).
 *
 * Each annotation is a box from its start to its end, at least as wide as its label (up to a cap):
 * a short note on one bar still shows its words; a long one over many bars shows a line under them.
 * Boxes go to the first lane where they fit; what does not fit in MAX_LANES is counted, not drawn on top.
 */

export interface LaneInput {
  id: string;
  /** Pixels in the ruler, already at the roll's zoom. May start before 0 or end past the width. */
  x0: number;
  x1: number;
  text: string;
}

export interface LaneBox {
  id: string;
  lane: number;
  /** Visible box, clamped to the ruler. */
  left: number;
  width: number;
  /** Pixels of the annotation's own span inside the box (the line under the label). */
  spanWidth: number;
  /** The annotation started before the left edge (shown with an arrow-like cut). */
  cutLeft: boolean;
}

export interface LaneLayout {
  boxes: LaneBox[];
  lanes: number;
  /** Annotations with no room, by id, and where they would start. */
  hidden: { id: string; left: number }[];
}

export const MAX_LANES = 3;
/** Width a label asks for: about 6.3 px per character at 11 px, plus padding; capped. */
export const LABEL_MAX = 220;
const LABEL_MIN = 28;
const GAP = 6;

export function labelWidth(text: string): number {
  return Math.min(LABEL_MAX, Math.max(LABEL_MIN, Math.round(text.length * 6.3) + 18));
}

export function layoutAnnotations(items: readonly LaneInput[], width: number, maxLanes = MAX_LANES): LaneLayout {
  const visible = items
    .filter((a) => a.x1 > 0 && a.x0 < width)
    // Earlier first; at the same start, the longer one first, so it takes the upper lane.
    .sort((a, b) => a.x0 - b.x0 || b.x1 - b.x0 - (a.x1 - a.x0) || a.id.localeCompare(b.id));
  const ends: number[] = [];
  const boxes: LaneBox[] = [];
  const hidden: LaneLayout["hidden"] = [];
  for (const a of visible) {
    const left = Math.max(0, a.x0);
    const spanRight = Math.min(width, a.x1);
    const right = Math.min(width, Math.max(spanRight, left + labelWidth(a.text)));
    let lane = ends.findIndex((end) => end + GAP <= left);
    if (lane === -1 && ends.length < maxLanes) lane = ends.push(-Infinity) - 1;
    if (lane === -1) {
      hidden.push({ id: a.id, left });
      continue;
    }
    ends[lane] = right;
    boxes.push({ id: a.id, lane, left, width: Math.max(LABEL_MIN, right - left), spanWidth: Math.max(0, spanRight - left), cutLeft: a.x0 < 0 });
  }
  return { boxes, lanes: ends.length, hidden };
}
