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
      voidWeighment: vi.fn(),
      reprintWeighment: vi.fn(),
      getLiveWeight: vi.fn(),
      getSyncStatus: vi.fn(),
      createWeighment: vi.fn(),
    },
  };
});

import { agentApi, AgentApiError } from '../src/lib/api.js';
import { ReturnWeighment } from '../src/components/return-weighment.js';
import { liveResult, renderWithQuery, weighment } from './utils.js';

const mocked = vi.mocked(agentApi);

function renderFlow(captured: { kg: number; source: 'SERIAL' | 'MANUAL' } | null = null) {
  const onCapture = vi.fn();
  const onClearCapture = vi.fn();
  renderWithQuery(
    <ReturnWeighment
      live={liveResult('STABLE', 20_000)}
      captured={captured}
      onCapture={onCapture}
      onClearCapture={onClearCapture}
    />,
  );
  return { onCapture, onClearCapture, user: userEvent.setup() };
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

    expect(await screen.findByText('SI-000001')).toBeInTheDocument();
    expect(screen.getByText('Ali Raza')).toBeInTheDocument();
    expect(screen.getByText(/cannot be changed/i)).toBeInTheDocument();
  });

  it('reports a slip that does not exist without blocking anything', async () => {
    mocked.getWeighment.mockRejectedValue(
      new AgentApiError('SLIP_NOT_FOUND', 'No weighment found for slip SI-999999.', 404),
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

    expect(await screen.findByText(/capture the second weight/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /complete weighing/i })).toBeDisabled();
  });

  it('previews the net weight from the captured snapshot before committing', async () => {
    const { user } = renderFlow({ kg: 20_000, source: 'SERIAL' });
    await fetchSlip(user);

    // 8,000 first + 20,000 second = 12,000 net, shown before anything is saved.
    expect(await screen.findByText('12,000 kg')).toBeInTheDocument();
    expect(screen.getByText('12.000 ton')).toBeInTheDocument();
    expect(screen.getByText('300.000 maund')).toBeInTheDocument();
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
      'SI-000001',
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
      new AgentApiError('ALREADY_COMPLETED', 'Slip SI-000001 is already completed.', 409),
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

    // The on-screen notice specifically — the toast says the same thing, and
    // matching either would not prove the record was actually re-fetched.
    expect(await screen.findByText(/this slip is already completed/i)).toBeInTheDocument();
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

    expect(await screen.findByText(/this slip is already completed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /complete weighing/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reprint receipt/i })).toBeEnabled();
  });

  it('cannot be voided once completed', async () => {
    const { user } = renderFlow();
    await fetchSlip(user);

    await screen.findByText(/this slip is already completed/i);
    expect(screen.queryByRole('button', { name: /void ticket/i })).not.toBeInTheDocument();
  });
});

describe('voiding an abandoned ticket', () => {
  beforeEach(() => {
    mocked.getWeighment.mockResolvedValue({
      weighment: weighment(),
      net: { kg: 0, ton: 0, maund: 0 },
    });
  });

  it('demands a reason before the void can be confirmed', async () => {
    const { user } = renderFlow();
    await fetchSlip(user);
    await user.click(await screen.findByRole('button', { name: /void ticket/i }));

    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByLabelText(/reason/i)).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: /void ticket/i })).toBeDisabled();
  });

  it('enables the confirm only once a real reason is typed', async () => {
    const { user } = renderFlow();
    await fetchSlip(user);
    await user.click(await screen.findByRole('button', { name: /void ticket/i }));

    const dialog = within(await screen.findByRole('dialog'));
    // Whitespace is not a reason, and neither is a single stray character.
    await user.type(dialog.getByLabelText(/reason/i), '  ');
    expect(dialog.getByRole('button', { name: /void ticket/i })).toBeDisabled();

    await user.type(dialog.getByLabelText(/reason/i), 'Truck never returned');
    expect(dialog.getByRole('button', { name: /void ticket/i })).toBeEnabled();
  });

  it('sends the reason to the agent', async () => {
    mocked.voidWeighment.mockResolvedValue({ weighment: weighment({ status: 'VOID' }) });

    const { user } = renderFlow();
    await fetchSlip(user);
    await user.click(await screen.findByRole('button', { name: /void ticket/i }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(/reason/i), 'Truck never returned');
    await user.click(dialog.getByRole('button', { name: /void ticket/i }));

    await waitFor(() =>
      expect(mocked.voidWeighment).toHaveBeenCalledWith(
        'SI-000001',
        expect.objectContaining({ reason: 'Truck never returned' }),
      ),
    );
  });

  it('never deletes — the record comes back as VOID', async () => {
    mocked.voidWeighment.mockResolvedValue({ weighment: weighment({ status: 'VOID' }) });
    mocked.getWeighment
      .mockResolvedValueOnce({ weighment: weighment(), net: { kg: 0, ton: 0, maund: 0 } })
      .mockResolvedValueOnce({
        weighment: weighment({ status: 'VOID', void_reason: 'Truck never returned' }),
        net: { kg: 0, ton: 0, maund: 0 },
      });

    const { user } = renderFlow();
    await fetchSlip(user);
    await user.click(await screen.findByRole('button', { name: /void ticket/i }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(/reason/i), 'Truck never returned');
    await user.click(dialog.getByRole('button', { name: /void ticket/i }));

    expect(await screen.findByText(/this ticket was voided/i)).toBeInTheDocument();
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

    await waitFor(() => expect(mocked.reprintWeighment).toHaveBeenCalledWith('SI-000001', 'FIRST'));
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
      expect(mocked.reprintWeighment).toHaveBeenCalledWith('SI-000001', 'SECOND'),
    );
  });
});
