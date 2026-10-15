/** The capture UX, driven the way an operator drives it. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * The agent is mocked because capturing a weight now photographs the bridge
 * at that instant — see PendingCaptureStore. Unmocked, every test here would
 * make a real request from jsdom and quietly fall back to "no cameras",
 * which is the one case that proves nothing.
 */
vi.mock('../src/lib/api.js', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/api.js')>('../src/lib/api.js');
  return {
    ...actual,
    agentApi: { captureNow: vi.fn(), discardCapture: vi.fn() },
  };
});

import { agentApi } from '../src/lib/api.js';
import { WeightCapture } from '../src/components/weight-capture.js';
import type { LiveWeightResult } from '../src/hooks/use-live-weight.js';
import type { IndicatorState } from '../src/lib/indicator-state.js';

const live = (state: IndicatorState, weightKg = 12_340): LiveWeightResult => ({
  weightKg,
  state,
  simulated: false,
  indicatorError: null,
  agentReachable: state !== 'AGENT_DOWN',
});

const mocked = vi.mocked(agentApi);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.captureNow.mockResolvedValue({ capture_id: 'held-1' });
  mocked.discardCapture.mockResolvedValue({ discarded: true });
});

function setup(state: IndicatorState, weightKg = 12_340) {
  const onCapture = vi.fn();
  const onClear = vi.fn();
  render(
    <WeightCapture
      live={live(state, weightKg)}
      captured={null}
      onCapture={onCapture}
      onClear={onClear}
    />,
  );
  return { onCapture, onClear, user: userEvent.setup() };
}

describe('capturing a stable reading', () => {
  it('captures the exact reading in one click', async () => {
    const { onCapture, user } = setup('STABLE', 12_340);
    await user.click(screen.getByRole('button', { name: /capture weight/i }));
    expect(onCapture).toHaveBeenCalledWith(expect.objectContaining({ kg: 12_340, source: 'SERIAL' }));
  });

  it('freezes the value shown at the moment of the click', async () => {
    // The captured number must be the snapshot, not whatever streams next.
    const { onCapture, user } = setup('STABLE', 8000);
    await user.click(screen.getByRole('button', { name: /capture weight/i }));

    /*
     * The weight is reported twice on purpose — once immediately, once when
     * the photographs' token comes back — so this checks the value on every
     * call rather than counting them. A second number here would mean the
     * capture had been read again from a live reading that has moved on,
     * which is the thing this test exists to catch.
     */
    await waitFor(() => expect(onCapture.mock.calls.length).toBeGreaterThan(0));
    for (const [weight] of onCapture.mock.calls) {
      expect(weight).toMatchObject({ kg: 8000, source: 'SERIAL' });
    }
  });

  it('photographs the bridge at the moment of the capture, and carries the token', async () => {
    /*
     * The reason any of this is asynchronous. The cameras used to fire when
     * the weighing was SAVED — a plate, a product and a customer later, by
     * which time the truck has usually pulled off the bridge.
     */
    const { onCapture, user } = setup('STABLE', 8000);
    await user.click(screen.getByRole('button', { name: /capture weight/i }));

    expect(mocked.captureNow).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(onCapture).toHaveBeenLastCalledWith(
        expect.objectContaining({ kg: 8000, captureId: 'held-1' }),
      ),
    );
  });

  it('still captures the weight when the cameras cannot be asked', async () => {
    // A weighing has never depended on a photograph and must not start now.
    mocked.captureNow.mockRejectedValue(new Error('no agent'));

    const { onCapture, user } = setup('STABLE', 8000);
    await user.click(screen.getByRole('button', { name: /capture weight/i }));

    expect(onCapture).toHaveBeenCalledWith(expect.objectContaining({ kg: 8000 }));
  });
});

describe('capturing while the reading is moving', () => {
  it('disables the capture button', () => {
    setup('UNSTABLE');
    expect(screen.getByRole('button', { name: /capture weight/i })).toBeDisabled();
  });

  it('still offers manual entry', () => {
    setup('UNSTABLE');
    expect(screen.getByRole('button', { name: /enter manually/i })).toBeEnabled();
  });
});

describe('capturing when the indicator reports no stability flag', () => {
  it('asks for confirmation before the weight counts', async () => {
    const { onCapture, user } = setup('UNKNOWN_STABILITY', 9500);

    await user.click(screen.getByRole('button', { name: /capture weight/i }));
    expect(onCapture).not.toHaveBeenCalled();
    expect(screen.getByText(/confirm this weight/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^confirm$/i }));
    expect(onCapture).toHaveBeenCalledWith(
      expect.objectContaining({ kg: 9500, source: 'SERIAL' }),
    );
  });

  it('captures nothing if the operator cancels', async () => {
    const { onCapture, user } = setup('UNKNOWN_STABILITY', 9500);
    await user.click(screen.getByRole('button', { name: /capture weight/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCapture).not.toHaveBeenCalled();
  });
});

describe('manual fallback', () => {
  it('is available even when the indicator is completely dead', async () => {
    const { onCapture, user } = setup('DISCONNECTED');

    await user.click(screen.getByRole('button', { name: /enter manually/i }));
    await user.type(screen.getByLabelText(/weight in kilograms/i), '7250');
    await user.click(screen.getByRole('button', { name: /use this weight/i }));

    expect(onCapture).toHaveBeenCalledWith(expect.objectContaining({ kg: 7250, source: 'MANUAL' }));
  });

  it('rejects a value that is not a weight', async () => {
    const { onCapture, user } = setup('DISCONNECTED');
    await user.click(screen.getByRole('button', { name: /enter manually/i }));
    await user.click(screen.getByRole('button', { name: /use this weight/i }));
    expect(onCapture).not.toHaveBeenCalled();
  });
});

describe('after a capture', () => {
  it('shows the captured weight and flags a manual one', () => {
    render(
      <WeightCapture
        live={live('STABLE')}
        captured={{ kg: 7250, source: 'MANUAL' }}
        onCapture={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByText('7,250 kg')).toBeInTheDocument();
    expect(screen.getByText(/manual entry/i)).toBeInTheDocument();
  });

  it('lets the operator capture again', async () => {
    const onClear = vi.fn();
    render(
      <WeightCapture
        live={live('STABLE')}
        captured={{ kg: 7250, source: 'SERIAL' }}
        onCapture={vi.fn()}
        onClear={onClear}
      />,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: /capture again/i }));
    expect(onClear).toHaveBeenCalled();
  });
});
