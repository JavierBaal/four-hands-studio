/**
 * The window's copy of the AI's state (H3): who is connected, reading, writing or pointing.
 * Kept up to date by the main process; the window never changes it, it only asks (close the
 * intervention, the mark was seen).
 */
import { type AiState, NO_AI } from "../shared/protocol.js";
import type { Bridge } from "./bridge.js";

export class AiStore {
  state: AiState = NO_AI;
  version = 0;
  private listeners = new Set<() => void>();

  constructor(private readonly bridge: Bridge) {}

  async init(): Promise<void> {
    this.bridge.onAiState((s) => this.set(s));
    this.set(await this.bridge.ai());
  }

  private set(state: AiState): void {
    this.state = state;
    this.version++;
    for (const l of this.listeners) l();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;
}
