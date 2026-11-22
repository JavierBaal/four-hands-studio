/**
 * A2 (F2.2, 03/11/2026): each track plays on a strip of its own in the engine, numbered here
 * and not by MIDI channel, so a song is not held to 16 tracks (or 15: the metronome had one).
 *
 * A track keeps its strip while it exists, whatever happens around it (reordering, other tracks
 * coming and going): its plugin stays loaded where it is. A new track takes its MIDI channel's
 * number when it is free, so a song of up to 15 tracks plays exactly as before A2; the rest take
 * the lowest free number. The MIDI channel stays what goes out to a DAW and into a .mid file.
 */

/** Strips in the engine (Engine.h, kStrips). */
export const MAX_STRIPS = 512;

/** The metronome's strip key: it gets a strip like a track, so it never shares one. */
export const METRONOME_KEY = "#metronome";

export class StripMap {
  private byKey = new Map<string, number>();
  private taken = new Set<number>();

  /**
   * Brings the map up to date with the song's tracks (in order) and the metronome. Returns the
   * strips that are no longer anyone's (their plugin and mix go) and the keys that got one.
   */
  sync(tracks: ReadonlyArray<{ id: string; channel: number }>): { freed: number[]; added: string[] } {
    const alive = new Set(tracks.map((t) => t.id));
    alive.add(METRONOME_KEY);
    const freed: number[] = [];
    for (const [key, strip] of this.byKey)
      if (!alive.has(key)) {
        this.byKey.delete(key);
        this.taken.delete(strip);
        freed.push(strip);
      }
    const added: string[] = [];
    for (const t of tracks) if (!this.byKey.has(t.id) && this.assign(t.id, t.channel)) added.push(t.id);
    // After the tracks: a track loaded with the song keeps its channel's number.
    if (!this.byKey.has(METRONOME_KEY) && this.assign(METRONOME_KEY, 15)) added.push(METRONOME_KEY);
    return { freed, added };
  }

  private assign(key: string, preferred: number): boolean {
    let strip = preferred >= 0 && preferred < 16 && !this.taken.has(preferred) ? preferred : -1;
    if (strip < 0) for (let s = 16; s < MAX_STRIPS && strip < 0; s++) if (!this.taken.has(s)) strip = s;
    if (strip < 0) for (let s = 0; s < 16 && strip < 0; s++) if (!this.taken.has(s)) strip = s;
    if (strip < 0) return false;
    this.byKey.set(key, strip);
    this.taken.add(strip);
    return true;
  }

  /** The strip of a track (or the metronome); `fallback` if it has none (all 512 taken). */
  of(key: string, fallback: number): number {
    return this.byKey.get(key) ?? fallback;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  entries(): Array<[string, number]> {
    return [...this.byKey.entries()];
  }

  clear(): void {
    this.byKey.clear();
    this.taken.clear();
  }
}

/** Buses in the engine (Engine.h, kBuses). */
export const MAX_BUSES = 128;

/**
 * F2.2 part D: each bus has its place in the engine while it exists, so its effects stay loaded
 * when other buses come, go or move in the console. The lowest free place for a new one.
 */
export class BusMap {
  private byId = new Map<string, number>();

  /** Up to date with the song's buses; returns the places that are free again. */
  sync(ids: readonly string[]): number[] {
    const alive = new Set(ids);
    const freed: number[] = [];
    for (const [id, index] of this.byId)
      if (!alive.has(id)) {
        this.byId.delete(id);
        freed.push(index);
      }
    const taken = new Set(this.byId.values());
    for (const id of ids) {
      if (this.byId.has(id)) continue;
      let index = 0;
      while (taken.has(index) && index < MAX_BUSES) index++;
      if (index >= MAX_BUSES) continue;
      this.byId.set(id, index);
      taken.add(index);
    }
    return freed;
  }

  /** A bus's place, or -1 if it has none (all taken). */
  of(id: string): number {
    return this.byId.get(id) ?? -1;
  }

  entries(): Array<[string, number]> {
    return [...this.byId.entries()];
  }

  clear(): void {
    this.byId.clear();
  }
}
