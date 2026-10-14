/**
 * Messages between the window and the synth AudioWorklet.
 * Times: `time` is AudioContext time in seconds; omitted = apply at the start of the next block.
 */

export type SynthEvent =
  | { kind: "on"; ch: number; note: number; vel: number }
  | { kind: "off"; ch: number; note: number }
  /** Program change; `bank` (MSB) first if given: 0 is the default bank, others are added banks. */
  | { kind: "prog"; ch: number; prog: number; bank?: number }
  | { kind: "cc"; ch: number; cc: number; value: number }
  | { kind: "panic" };

export type ToWorklet =
  | { t: "load"; soundfont: ArrayBuffer; predecode: boolean }
  | { t: "now"; ev: SynthEvent; id?: number }
  | { t: "sched"; events: Array<{ time: number; ev: SynthEvent }> }
  | { t: "effects"; enabled: boolean }
  /** Adds a sound bank next to the main one; its banks are shifted by `offset` (bank select MSB). */
  | { t: "bank"; id: string; soundfont: ArrayBuffer; offset: number };

export interface WorkletStats {
  /** Average share of the block budget used by the synth, 0..1+. */
  avgLoad: number;
  /** Worst block in the period, as share of the budget. */
  maxLoad: number;
  /** Worst block in the period, in ms. */
  maxBlockMs: number;
  /** Scheduled events that arrived after their time had passed. */
  lateEvents: number;
  /** Blocks measured in the period. */
  blocks: number;
  /** Which clock the worklet could use to measure itself. */
  clock: "performance" | "date";
}

export type FromWorklet =
  | { t: "ready"; parseMs: number; initMs: number; decodeMs: number; samples: number; presets: Array<{ program: number; bank: number; name: string }> }
  | { t: "error"; message: string }
  | { t: "bankReady"; id: string }
  | { t: "bankError"; id: string; message: string }
  | { t: "applied"; id: number; frame: number }
  | ({ t: "stats" } & WorkletStats);
