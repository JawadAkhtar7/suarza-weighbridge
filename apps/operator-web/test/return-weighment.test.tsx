/**
 * The pass-2 flow and its edge cases (brief §3 Scenario A & B).
 *
 * The agent client is mocked so each edge case can be reproduced on demand —
 * an already-completed slip and a voided one are otherwise awkward to stage.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// A namespace type-import rather than `typeof import(...)`: the inline form is
// banned by the shared consistent-type-imports rule.
import type * as ApiModule from '../src/lib/api.js';

vi.mock('../src/lib/api.js', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api.js');
  return {
    ...actual,
    agentApi: {
      getWeighment: vi.fn(),
      completeWeighment: vi.fn(),
      reprintWeighment: vi.fn(),
      getLiveWeight: vi.fn(),
      getSyncStatus: vi.fn(),
      createWeighment: vi.fn(),
    },
  };
});

import { agentApi, AgentApiError } from '../src/lib/api.js';
import { ReturnWeighment } from '../src/components/return-weighment.js';
import { renderWithQuery, weighment } from './utils.js';

const mocked = vi.mocked(agentApi);

function renderFlow(captured: { kg: number; source: 'SERIAL' | 'MANUAL' } | null = null) {
  /* No live reading and no onCapture: the capture control moved out to the
     left column, beside the live weight, so it is in the same place in every
     mode. This flow only consumes the captured value. */
  const onClearCapture = vi.fn();
  renderWithQuery(<ReturnWeighment captured={captured} onClearCapture={onClearCapture} />);
  return { onClearCapture, user: userEvent.setup() };
}

async function fetchSlip(user: ReturnType<typeof userEvent.setup>, slip = '1') {
  await user.type(screen.getByLabelText(/slip number/i), `${slip}{Enter}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetching a slip', () => {
  it('loads the record and locks the identity fields', async () => {
    mocked.getWeighment.mockResolvedValue({
      weighment: weighment(),
      net: { kg: 0, ton: 0, maund: 0 },
    });

    const { user } = renderFlow();
    await fetchSlip(user);

    /* The sentence that used to say so was removed from the screen; what
       proves the lock is that the customer arrives as text rather than as a
       field somebody could retype on the way to the second weighing. */
    expect(await screen.findByText('20261')).toBeInTheDocument();
    expect(screen.getByText('Ali Raza')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Ali Raza')).toBeNull();
  });

  it('reports a slip that does not exist without blocking anything', async () => {
    mocked.getWeighment.mockRejectedValue(
      new AgentApiError('SLIP_NOT_FOUND', 'No weighment found for slip 2026999999.', 404),
    );

    const { user } = renderFlow();
    await fetchSlip(user, '999999');

    expect(await screen.findByText(/no weighment found for that slip number/i)).toBeInTheDocument();
    // The field is still there and still usable — no dialog to dismiss first.
    expect(screen.getByLabelText(/slip number/i)).toBeInTheDocument();
  });
});

describe('completing the second weighing', () => {
  beforeEach(() => {
    mocked.getWeighment.mockResolvedValue({
      weighment: weighment(),
      net: { kg: 0, ton: 0, maund: 0 },
    });
  });

  it('will not complete until a second weight is captured', async () => {
    const { user } = renderFlow(null);
    await fetchSlip(user);

    // The prompt above the button is gone — the operator is looking at a
    // live weight, not at instructions — so the disabled button is the whole
    // of what stops an uncaptured weighing being committed.
    expect(await screen.findByRole('button', { name: /complete weighing/i })).toBeDisabled();
  });

  it('shows the first weight it will subtract, and opens the way once a weight is captured', async () => {
    /*
     * The net figure itself is no longer this panel's to show: the capture
     * control and the net display moved out to the left column so they sit in
     * the same place in every mode, and NetWeightDisplay is tested on its own.
     *
     * What belongs here is the pair either side of that move — the first
     * weight this pass is measured against, which came from the fetched slip,
     * and the fact that a captured weight is what unlocks the commit.
     */
    const { user } = renderFlow({ kg: 20_000, source: 'SERIAL' });
    await fetchSlip(user);

    expect(await screen.findByText('8,000 kg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /complete weighing/i })).toBeEnabled();
  });

  it('sends the captured weight, its source and the confirmed amount', async () => {
    mocked.completeWeighment.mockResolvedValue({
      weighment: weighment({
        status: 'COMPLETED',
        second_weight_kg: 20_000,
        net_weight_kg: 12_000,
      }),
      net: { kg: 12_000, ton: 12, maund: 300 },
    });

    const { user } = renderFlow({ kg: 20_000, source: 'MANUAL' });
    await fetchSlip(user);
    await user.click(await screen.findByRole('button', { name: /complete weighing/i }));

    await waitFor(() => expect(mocked.completeWeighment).toHaveBeenCalled());
    expect(mocked.completeWeighment).toHaveBeenCalledWith(
      '20261',
      expect.objectContaining({
        second_weight_kg: 20_000,
        second_weight_src: 'MANUAL',
        amount_charged: 300,
      }),
    );
  });

  it('confirms completion on screen', async () => {
    mocked.completeWeighment.mockResolvedValue({
      weighment: weighment({
        status: 'COMPLETED',
        second_weight_kg: 20_000,
        net_weight_kg: 12_000,
      }),
      net: { kg: 12_000, ton: 12, maund: 300 },
    });

    const { user } = renderFlow({ kg: 20_000, source: 'SERIAL' });
    await fetchSlip(user);
    await user.click(await screen.findByRole('button', { name: /complete weighing/i }));

    expect(await screen.findByText(/weighing completed/i)).toBeInTheDocument();
  });

  it('shows the record as it really is if someone else completed it first', async () => {
    // A race between two windows, or a second station. The operator is shown
    // the truth rather than left arguing with a rejected save.
    mocked.completeWeighment.mockRejectedValue(
      new AgentApiError('ALREADY_COMPLETED', 'Slip 20261 is already completed.', 409),
    );
    mocked.getWeighment
      .mockResolvedValueOnce({ weighment: weighment(), net: { kg: 0, ton: 0, maund: 0 } })
      .mockResolvedValueOnce({
        weighment: weighment({ status: 'COMPLETED', second_weight_kg: 20_000 }),
        net: { kg: 12_000, ton: 12, maund: 300 },
      });

    const { user } = renderFlow({ kg: 20_000, source: 'SERIAL' });
    await fetchSlip(user);
    await user.click(await screen.findByRole('button', { name: /complete weighing/i }));

    /*
     * The screen itself, not a message about it. The banner that used to say
     * this was removed — the state is already plain from what the screen
     * offers — so what proves the record was re-fetched is that there is no
     * longer a weighing to complete, only a receipt to reprint.
     */
    expect(await screen.findByRole('button', { name: /reprint receipt/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /complete weighing/i })).not.toBeInTheDocument();
  });
});

describe('a slip that is already completed', () => {
  beforeEach(() => {
    mocked.getWeighment.mockResolvedValue({
      weighment: weighment({
        status: 'COMPLETED',
        second_weight_kg: 20_000,
        net_weight_kg: 12_000,
      }),
      net: { kg: 12_000, ton: 12, maund: 300 },
    });
  });

  it('blocks re-completion and offers a reprint instead', async () => {
    const { user } = renderFlow();
    await fetchSlip(user);

    expect(await screen.findByRole('button', { name: /reprint receipt/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /complete weighing/i })).not.toBeInTheDocument();
  });

  it('cannot be voided once completed', async () => {
    const { user } = renderFlow();
    await fetchSlip(user);

    await screen.findByRole('button', { name: /reprint receipt/i });
    expect(screen.queryByRole('button', { name: /void ticket/i })).not.toBeInTheDocument();
  });
});

describe('a voided ticket', () => {
  it('explains itself and shows the reason', async () => {
    mocked.getWeighment.mockResolvedValue({
      weighment: weighment({ status: 'VOID', void_reason: 'Truck never returned' }),
      net: { kg: 0, ton: 0, maund: 0 },
    });

    const { user } = renderFlow();
    await fetchSlip(user);

    expect(await screen.findByText(/this ticket was voided/i)).toBeInTheDocument();
    expect(screen.getByText(/truck never returned/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /complete weighing/i })).not.toBeInTheDocument();
  });
});

describe('reprinting', () => {
  it('is available on an open ticket and records the first receipt', async () => {
    mocked.getWeighment.mockResolvedValue({
      weighment: weighment(),
      net: { kg: 0, ton: 0, maund: 0 },
    });
    mocked.reprintWeighment.mockResolvedValue({
      weighment: weighment(),
      net: { kg: 0, ton: 0, maund: 0 },
      audit_entry: {} as never,
    });

    const { user } = renderFlow();
    await fetchSlip(user);
    await user.click(await screen.findByRole('button', { name: /reprint receipt/i }));

    await waitFor(() => expect(mocked.reprintWeighment).toHaveBeenCalledWith('20261', 'FIRST'));
  });

  it('records the second receipt once the slip is completed', async () => {
    mocked.getWeighment.mockResolvedValue({
      weighment: weighment({ status: 'COMPLETED', second_weight_kg: 20_000 }),
      net: { kg: 12_000, ton: 12, maund: 300 },
    });
    mocked.reprintWeighment.mockResolvedValue({
      weighment: weighment({ status: 'COMPLETED' }),
      net: { kg: 12_000, ton: 12, maund: 300 },
      audit_entry: {} as never,
    });

    const { user } = renderFlow();
    await fetchSlip(user);
    await user.click(await screen.findByRole('button', { name: /reprint receipt/i }));

    await waitFor(() =>
      expect(mocked.reprintWeighment).toHaveBeenCalledWith('20261', 'SECOND'),
    );
  });
});
