/**
 * The indicator interface the rest of the agent talks to. Serial and simulator
 * are interchangeable behind it, which is what lets every flow — capture,
 * complete, print, sync — be built and QA'd with no hardware attached.
 */

import type { LiveWeight } from '@suarza/shared';
import { nowUtc } from '@suarza/shared';

export interface WeightReader {
  readonly kind: 'serial' | 'simulator';
  start(): Promise<void>;
  stop(): Promise<void>;
  /** The latest reading, with staleness and connection state already applied. */
  read(): LiveWeight;
}

export interface ReadingState {
  weightKg: number;
  stable: boolean | null;
  at: number;
}

/**
 * Shared bookkeeping: holds the most recent reading and decides whether the
 * indicator still counts as connected.
 *
 * "Connected" is deliberately about *data*, not about the OS handle. A serial
 * port can stay open while the indicator is switched off or its cable is
 * knocked loose, and the operator needs to see that immediately rather than
 * capture a frozen number that stopped being true minutes ago.
 */
export abstract class BaseWeightReader implements WeightReader {
  abstract readonly kind: 'serial' | 'simulator';

  protected latest: ReadingState | null = null;
  protected lastError: string | null = null;
  protected portOpen = false;

  constructor(protected readonly staleMs: number) {}

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;

  protected record(weightKg: number, stable: boolean | null): void {
    this.latest = { weightKg, stable, at: Date.now() };
    this.lastError = null;
  }

  protected fail(message: string): void {
    this.lastError = message;
  }

  read(): LiveWeight {
    const now = Date.now();
    const fresh = this.latest !== null && now - this.latest.at <= this.staleMs;

    return {
      weight_kg: this.latest?.weightKg ?? 0,
      // A stale reading is reported as unstable, never as stable: capture must
      // not be allowed against a number nobody is currently confirming.
      stable: fresh ? (this.latest?.stable ?? null) : false,
      connected: this.portOpen && fresh,
      at: this.latest ? new Date(this.latest.at).toISOString() : nowUtc(),
      simulated: this.kind === 'simulator',
      error: this.lastError,
    };
  }
}
