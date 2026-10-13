/**
 * Sample-accurate event queue for the audio thread (ARQUITECTURA.md, 7.1).
 * Events are kept sorted by frame; equal frames keep their arrival order.
 */
export interface Timed<T> {
  frame: number;
  value: T;
}

export class EventQueue<T> {
  private items: Timed<T>[] = [];

  get size(): number {
    return this.items.length;
  }

  push(frame: number, value: T): void {
    // Binary search for the first item with a larger frame (stable for equal frames).
    let lo = 0;
    let hi = this.items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.items[mid]!.frame <= frame) lo = mid + 1;
      else hi = mid;
    }
    this.items.splice(lo, 0, { frame, value });
  }

  /** Frame of the next event, or Infinity. */
  peekFrame(): number {
    return this.items.length ? this.items[0]!.frame : Infinity;
  }

  shift(): Timed<T> | undefined {
    return this.items.shift();
  }

  clear(): void {
    this.items = [];
  }
}

/**
 * Splits one render block into segments at event boundaries.
 * Calls `render(start, count)` for audio and `apply(event)` at the exact offset.
 * Events whose frame is already in the past are applied at offset 0 and reported as late via `onLate`.
 */
export function renderBlock<T>(
  queue: EventQueue<T>,
  blockStartFrame: number,
  blockSize: number,
  render: (start: number, count: number) => void,
  apply: (value: T) => void,
  onLate?: (value: T, framesLate: number) => void,
): void {
  let pos = 0;
  const end = blockStartFrame + blockSize;
  while (queue.peekFrame() < end) {
    const item = queue.shift()!;
    const offset = Math.max(0, item.frame - blockStartFrame);
    if (item.frame < blockStartFrame && onLate) onLate(item.value, blockStartFrame - item.frame);
    if (offset > pos) {
      render(pos, offset - pos);
      pos = offset;
    }
    apply(item.value);
  }
  if (pos < blockSize) render(pos, blockSize - pos);
}
