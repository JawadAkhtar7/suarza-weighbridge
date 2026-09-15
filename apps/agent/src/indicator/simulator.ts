/**
 * Weight simulator (brief §13-M1).
 *
 * Emits a realistic stream so the whole product can be built before the client
 * supplies the indicator spec. It models the cycle that actually happens at a
 * bridge — an empty platform, a truck rolling on, the reading swinging and then
 * settling, the truck rolling off — because the stable-capture UX (brief §7.1)
 * is only exercised properly if the weight genuinely refuses to settle for a
 * few seconds first.
 */

import { BaseWeightReader } from './reader.js';

export interface SimulatorOptions {
  staleMs: number;
  /** How often a reading is emitted. Real indicators run 5–20 Hz. */
  intervalMs?: number;
  /** Weight the simulated truck settles at, in kg. */
  targetKg?: number;
  /** Drive the cycle automatically; off means the weight only changes on command. */
  autoCycle?: boolean;
}

type Phase = 'EMPTY' | 'DRIVING_ON' | 'SETTLING' | 'STABLE' | 'DRIVING_OFF';

/** How long each phase lasts before the cycle advances, in ms. */
const PHASE_DURATION: Record<Phase, number> = {
  EMPTY: 4000,
  DRIVING_ON: 2500,
  SETTLING: 3000,
  STABLE: 12000,
  DRIVING_OFF: 2000,
};

export class SimulatorWeightReader extends BaseWeightReader {
  readonly kind = 'simulator' as const;

  private timer: NodeJS.Timeout | null = null;
  private phase: Phase = 'EMPTY';
  private phaseStartedAt = Date.now();
  private targetKg: number;
  private currentKg = 0;
  private readonly intervalMs: number;
  private autoCycle: boolean;
  /** Stability to report while pinned by setWeight(). */
  private pinnedStable = true;

  constructor(private readonly options: SimulatorOptions) {
    super(options.staleMs);
    this.intervalMs = options.intervalMs ?? 200;
    this.targetKg = options.targetKg ?? 18_500;
    this.autoCycle = options.autoCycle ?? true;
  }

  start(): Promise<void> {
    if (this.timer) return Promise.resolve();
    this.portOpen = true;
    this.phase = 'EMPTY';
    this.phaseStartedAt = Date.now();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    // Don't hold the process open on the simulator alone.
    this.timer.unref?.();
    this.tick();
    return Promise.resolve();
  }

  stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.portOpen = false;
    return Promise.resolve();
  }

  // --- Dev controls, exposed over HTTP only while the simulator is on -------

  /**
   * Park the simulator on an exact weight — how tests and the M9 QA run drive a
   * two-pass transaction. Pinned readings carry no noise: the point of this
   * control is that the number the caller asked for is the number that comes
   * back on every subsequent poll, not just the first one.
   */
  setWeight(kg: number, { stable = true }: { stable?: boolean } = {}): void {
    this.autoCycle = false;
    this.pinnedStable = stable;
    this.targetKg = kg;
    this.currentKg = kg;
    this.phase = stable ? 'STABLE' : 'SETTLING';
    this.phaseStartedAt = Date.now();
    this.emit();
  }

  /** Hand control back to the automatic drive-on/drive-off cycle. */
  resumeCycle(targetKg?: number): void {
    if (targetKg !== undefined) this.targetKg = targetKg;
    this.autoCycle = true;
    this.pinnedStable = true;
    this.phase = 'DRIVING_ON';
    this.phaseStartedAt = Date.now();
  }

  getState(): { phase: Phase; targetKg: number; autoCycle: boolean } {
    return { phase: this.phase, targetKg: this.targetKg, autoCycle: this.autoCycle };
  }

  // --- Simulation ----------------------------------------------------------

  private tick(): void {
    if (this.autoCycle) this.advancePhase();
    this.emit();
  }

  private advancePhase(): void {
    const elapsed = Date.now() - this.phaseStartedAt;
    if (elapsed < PHASE_DURATION[this.phase]) return;

    const next: Record<Phase, Phase> = {
      EMPTY: 'DRIVING_ON',
      DRIVING_ON: 'SETTLING',
      SETTLING: 'STABLE',
      STABLE: 'DRIVING_OFF',
      DRIVING_OFF: 'EMPTY',
    };
    this.phase = next[this.phase];
    this.phaseStartedAt = Date.now();

    // Each truck is a different truck.
    if (this.phase === 'DRIVING_ON') {
      this.targetKg = Math.round(6000 + Math.random() * 24_000);
    }
  }

  private emit(): void {
    // Pinned by setWeight(): hold the exact value until the cycle is resumed.
    if (!this.autoCycle) {
      this.record(Math.max(0, Math.round(this.targetKg)), this.pinnedStable);
      return;
    }

    const elapsed = Date.now() - this.phaseStartedAt;
    const progress = Math.min(1, elapsed / PHASE_DURATION[this.phase]);

    switch (this.phase) {
      case 'EMPTY':
        // An unloaded platform still drifts a kilo or two.
        this.currentKg = this.noise(0, 2);
        break;
      case 'DRIVING_ON':
        // Axles land one at a time, so the climb overshoots and jumps.
        this.currentKg = this.noise(this.targetKg * this.easeIn(progress), 400);
        break;
      case 'SETTLING': {
        // Damped oscillation around the target — the reason stable capture
        // exists at all.
        const amplitude = 300 * (1 - progress);
        this.currentKg = this.targetKg + Math.sin(elapsed / 120) * amplitude + this.noise(0, 15);
        break;
      }
      case 'STABLE':
        this.currentKg = this.noise(this.targetKg, 1);
        break;
      case 'DRIVING_OFF':
        this.currentKg = this.noise(this.targetKg * (1 - this.easeIn(progress)), 400);
        break;
    }

    const kg = Math.max(0, Math.round(this.currentKg));
    this.record(kg, this.phase === 'STABLE');
  }

  private noise(base: number, spread: number): number {
    return base + (Math.random() - 0.5) * 2 * spread;
  }

  private easeIn(t: number): number {
    return t * t * (3 - 2 * t);
  }
}
