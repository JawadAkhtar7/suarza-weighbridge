/**
 * Stable-weight capture rules (brief §7.1) — the single place that decides
 * whether the operator may freeze a reading.
 *
 * Pure and separately tested, because getting this wrong is how a wrong weight
 * ends up on an invoice. The rule has three cases, and the third is the one
 * that is easy to miss: an indicator that reports no stability flag at all is
 * NOT the same as an indicator reporting "unstable". The first still allows
 * capture, behind an explicit confirmation; the second must block it.
 */

import type { LiveWeight } from '@suarza/shared';

export type IndicatorState =
  /** The agent itself is unreachable — the service is down, not the scale. */
  | 'AGENT_DOWN'
  /** Agent is up, but the indicator is silent: unplugged, off, or wrong port. */
  | 'DISCONNECTED'
  /** Indicator reports a settled reading. */
  | 'STABLE'
  /** Indicator reports the reading is still moving. */
  | 'UNSTABLE'
  /** Indicator does not report stability at all. */
  | 'UNKNOWN_STABILITY';

export function deriveIndicatorState(
  reading: LiveWeight | null,
  agentReachable: boolean,
): IndicatorState {
  if (!agentReachable) return 'AGENT_DOWN';
  if (!reading || !reading.connected) return 'DISCONNECTED';
  if (reading.stable === true) return 'STABLE';
  if (reading.stable === false) return 'UNSTABLE';
  return 'UNKNOWN_STABILITY';
}

/** Whether the capture button does anything at all. */
export function canCapture(state: IndicatorState): boolean {
  return state === 'STABLE' || state === 'UNKNOWN_STABILITY';
}

/**
 * Whether capture must be confirmed before it counts. Only when the indicator
 * cannot vouch for the reading itself — then the operator vouches for it.
 */
export function requiresConfirmation(state: IndicatorState): boolean {
  return state === 'UNKNOWN_STABILITY';
}

export interface IndicatorPresentation {
  label: string;
  /** Maps to the shared Badge variants. */
  tone: 'success' | 'warning' | 'destructive' | 'secondary';
  /** Shown under the capture button when capture is not possible. */
  hint: string | null;
}

export function presentIndicatorState(state: IndicatorState): IndicatorPresentation {
  switch (state) {
    case 'STABLE':
      return { label: 'Stable', tone: 'success', hint: null };
    case 'UNSTABLE':
      return {
        label: 'Unstable',
        tone: 'warning',
        hint: 'Wait for the reading to settle before capturing.',
      };
    case 'UNKNOWN_STABILITY':
      return {
        label: 'Stability not reported',
        tone: 'secondary',
        hint: 'This indicator does not report stability — you will be asked to confirm.',
      };
    case 'DISCONNECTED':
      return {
        label: 'No signal',
        tone: 'destructive',
        hint: 'The indicator is not sending readings. Enter the weight manually.',
      };
    case 'AGENT_DOWN':
      return {
        label: 'Service offline',
        tone: 'destructive',
        hint: 'Cannot reach the weighbridge service on this PC.',
      };
  }
}
