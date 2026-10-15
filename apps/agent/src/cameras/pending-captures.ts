/**
 * Photographs taken at the moment the weight was, waiting for the save.
 *
 * The cameras used to fire when a weighing was committed. That is the wrong
 * moment: the operator captures a weight, then types a plate, a product, a
 * customer and an amount, and by the time they press Save the truck has often
 * pulled off the bridge. The slip then carried a picture of an empty plate,
 * or of whoever had driven on next.
 *
 * So the pictures are taken when the weight is, and held here until the save
 * claims them by token. Everything about this store is built around one fact:
 * a photograph must never make a weighing slower or less likely to succeed.
 *
 *   - `start` returns a token immediately and photographs in the background,
 *     so the operator's click is not waiting on two cameras.
 *   - `claim` waits only briefly for pictures still in flight, and yields
 *     nothing rather than holding up a save.
 *   - a token nobody claims is forgotten after HOLD_MS, and the store never
 *     holds more than MAX_PENDING at once, so a day of abandoned forms cannot
 *     fill the weighbridge PC's memory.
 */

import { randomUUID } from 'node:crypto';
import type { CameraClient, Snapshot } from './camera-client.js';

/**
 * How long a token stays good.
 *
 * Long enough for an operator interrupted half-way through a form — a phone
 * call, a driver with a question — and short enough that the pictures still
 * show the weighing they belong to. Past this the save photographs the bridge
 * as it is now, which is what it did before any of this existed.
 */
const HOLD_MS = 10 * 60 * 1000;

/** At most this many weighings-in-progress hold pictures. Oldest goes first. */
const MAX_PENDING = 8;

/**
 * How long a save will wait for pictures still being taken.
 *
 * Only reached when the save follows the capture within a second or two —
 * normally the cameras have long since answered. A truck at the window is
 * worth more than its photograph, so this is short.
 */
const CLAIM_TIMEOUT_MS = 3000;

interface PendingEntry {
  id: string;
  startedAt: number;
  /** Resolves to whatever the cameras gave; never rejects. */
  shots: Promise<Snapshot[]>;
}

export interface PendingCaptureStoreOptions {
  cameras: CameraClient;
  onLog?: (level: 'info' | 'warn', message: string) => void;
  /** Overridable for tests; the defaults above are what runs on site. */
  holdMs?: number;
  maxPending?: number;
  claimTimeoutMs?: number;
}

export class PendingCaptureStore {
  private readonly entries = new Map<string, PendingEntry>();

  constructor(private readonly options: PendingCaptureStoreOptions) {}

  get enabled(): boolean {
    return this.options.cameras.enabled;
  }

  private get holdMs(): number {
    return this.options.holdMs ?? HOLD_MS;
  }

  /**
   * Photograph the bridge now, and hand back a token for the save to quote.
   *
   * Returns null on a station with no cameras, which the operator app treats
   * as "carry on": the weighing is the thing that matters.
   */
  start(): string | null {
    if (!this.enabled) return null;

    this.sweep();

    const id = randomUUID();
    /*
     * Not awaited. The operator clicked Capture and the screen must answer at
     * once; the cameras take a few hundred milliseconds on a good day and the
     * timeout on a bad one. `snapshotAll` already yields an empty list rather
     * than throwing, so this promise cannot reject.
     */
    const shots = this.options.cameras.snapshotAll();

    this.entries.set(id, { id, startedAt: Date.now(), shots });

    // Oldest out first, so a burst of abandoned forms cannot push the useful
    // one out of the store before its save arrives.
    const max = this.options.maxPending ?? MAX_PENDING;
    while (this.entries.size > max) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
      this.options.onLog?.('warn', 'Dropped the oldest held photographs: too many in progress');
    }

    return id;
  }

  /**
   * Take the pictures held against a token, if they are still here.
   *
   * Empty for a token that has expired, was never issued, or belongs to a
   * restart. Every one of those means the same thing to the caller — there is
   * nothing held, photograph the bridge as it is now.
   */
  async claim(id: string | null | undefined): Promise<Snapshot[]> {
    if (!id) return [];
    this.sweep();

    const entry = this.entries.get(id);
    if (!entry) return [];
    this.entries.delete(id);

    /*
     * A race, deliberately. The pictures have almost always arrived by now;
     * when they have not, the weighing goes on without them rather than the
     * operator standing at the window while a camera decides.
     */
    const timeout = new Promise<Snapshot[]>((resolve) =>
      setTimeout(() => resolve([]), this.options.claimTimeoutMs ?? CLAIM_TIMEOUT_MS).unref?.(),
    );

    const shots = await Promise.race([entry.shots, timeout]);
    if (shots.length === 0) {
      this.options.onLog?.('warn', 'The held photographs did not arrive in time');
    }
    return shots;
  }

  /** Let go of a token the operator abandoned — a cleared capture. */
  discard(id: string | null | undefined): void {
    if (id) this.entries.delete(id);
  }

  /** How many are being held. For tests and the camera status route. */
  get size(): number {
    this.sweep();
    return this.entries.size;
  }

  private sweep(now = Date.now()): void {
    for (const [id, entry] of this.entries) {
      if (now - entry.startedAt > this.holdMs) this.entries.delete(id);
    }
  }
}
