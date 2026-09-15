/**
 * The capture-gating rule (brief §7.1). These are the cases that decide whether
 * a wrong number can reach an invoice, so they are tested directly rather than
 * only through the UI.
 */

import { describe, expect, it } from 'vitest';
import type { LiveWeight } from '@suarza/shared';
import {
  canCapture,
  deriveIndicatorState,
  presentIndicatorState,
  requiresConfirmation,
} from '../src/lib/indicator-state.js';

const reading = (overrides: Partial<LiveWeight> = {}): LiveWeight => ({
  weight_kg: 12_000,
  stable: true,
  connected: true,
  at: '2026-09-14T09:00:00.000Z',
  simulated: false,
  error: null,
  ...overrides,
});

describe('deriveIndicatorState', () => {
  it('reports the service being down before anything about the scale', () => {
    // Without this the UI would blame the indicator for the agent being stopped.
    expect(deriveIndicatorState(reading(), false)).toBe('AGENT_DOWN');
    expect(deriveIndicatorState(null, false)).toBe('AGENT_DOWN');
  });

  it('reports a silent indicator as disconnected', () => {
    expect(deriveIndicatorState(reading({ connected: false }), true)).toBe('DISCONNECTED');
    expect(deriveIndicatorState(null, true)).toBe('DISCONNECTED');
  });

  it('distinguishes stable from unstable', () => {
    expect(deriveIndicatorState(reading({ stable: true }), true)).toBe('STABLE');
    expect(deriveIndicatorState(reading({ stable: false }), true)).toBe('UNSTABLE');
  });

  it('treats "no stability flag" as its own case, not as unstable', () => {
    // An indicator that cannot report stability must not be confused with one
    // reporting movement: the first still allows capture, the second must not.
    expect(deriveIndicatorState(reading({ stable: null }), true)).toBe('UNKNOWN_STABILITY');
  });
});

describe('canCapture', () => {
  it('allows capture on a settled reading', () => {
    expect(canCapture('STABLE')).toBe(true);
  });

  it('allows capture behind a confirmation when stability is unknown', () => {
    expect(canCapture('UNKNOWN_STABILITY')).toBe(true);
    expect(requiresConfirmation('UNKNOWN_STABILITY')).toBe(true);
  });

  it('blocks capture while the reading is moving', () => {
    expect(canCapture('UNSTABLE')).toBe(false);
  });

  it('blocks capture when there is no reading to capture', () => {
    expect(canCapture('DISCONNECTED')).toBe(false);
    expect(canCapture('AGENT_DOWN')).toBe(false);
  });

  it('never asks for confirmation where capture is already blocked', () => {
    for (const state of ['UNSTABLE', 'DISCONNECTED', 'AGENT_DOWN'] as const) {
      expect(requiresConfirmation(state)).toBe(false);
    }
  });

  it('does not ask for confirmation on a stable reading', () => {
    expect(requiresConfirmation('STABLE')).toBe(false);
  });
});

describe('presentIndicatorState', () => {
  it('gives every state a label, and a hint wherever capture is blocked', () => {
    for (const state of [
      'STABLE',
      'UNSTABLE',
      'UNKNOWN_STABILITY',
      'DISCONNECTED',
      'AGENT_DOWN',
    ] as const) {
      const presentation = presentIndicatorState(state);
      expect(presentation.label.length).toBeGreaterThan(0);
      if (!canCapture(state)) {
        expect(presentation.hint).toBeTruthy();
      }
    }
  });

  it('points the operator at manual entry when the indicator is silent', () => {
    expect(presentIndicatorState('DISCONNECTED').hint).toMatch(/manually/i);
  });
});
