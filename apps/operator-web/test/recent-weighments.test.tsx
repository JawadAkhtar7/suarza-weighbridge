/**
 * The quick-pick list on the second-weight screen (operator feedback item 2).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// A namespace type-import rather than `typeof import(...)`: the inline form is
// banned by the shared consistent-type-imports rule.
import type * as ApiModule from '../src/lib/api.js';

vi.mock('../src/lib/api.js', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api.js');
  return {
    ...actual,
    agentApi: { ...actual.agentApi, listWeighments: vi.fn(), getSettings: vi.fn() },
  };
});

import { agentApi } from '../src/lib/api.js';
import { RecentWeighments } from '../src/components/recent-weighments.js';
import { renderWithQuery, weighment } from './utils.js';

const mocked = vi.mocked(agentApi);

beforeEach(() => {
  mocked.getSettings.mockRejectedValue(new Error('not needed here'));
});

function setup(rows: ReturnType<typeof weighment>[]) {
  mocked.listWeighments.mockResolvedValue({ rows, count: rows.length });
  const onPick = vi.fn();
  renderWithQuery(<RecentWeighments onPick={onPick} />);
  return { onPick, user: userEvent.setup() };
}

// Distinct ids: the list keys by record id, and two rows sharing one would
// make React drop a row — hiding a real bug behind a fixture mistake.
const open = () =>
  weighment({
    id: '11111111-1111-4111-8111-111111111111',
    slip_number: 'SI-000010',
    status: 'OPEN',
    second_weight_kg: null,
    net_weight_kg: 0,
  });
const done = () =>
  weighment({
    id: '22222222-2222-4222-8222-222222222222',
    slip_number: 'SI-000011',
    status: 'COMPLETED',
    // The shared helper defaults to an OPEN ticket, so a completed one has to
    // carry its second weight and net explicitly.
    second_weight_kg: 20_000,
    second_weight_at: '2026-09-14T11:00:00.000Z',
    second_weight_src: 'SERIAL',
    net_weight_kg: 12_000,
  });

describe('what it lists', () => {
  it('shows tickets waiting for a second weight', async () => {
    setup([open()]);
    expect(await screen.findByText('SI-000010')).toBeInTheDocument();
    expect(screen.getByText(/awaiting 2nd weight/i)).toBeInTheDocument();
  });

  it('shows completed ones too, so a driver with no slip can be found', async () => {
    setup([done()]);
    expect(await screen.findByText('SI-000011')).toBeInTheDocument();
    expect(screen.getByText(/^completed$/i)).toBeInTheDocument();
  });

  it('puts the ones still needing work first', async () => {
    // Completed first in the incoming data — the list must reorder.
    setup([done(), open()]);
    await screen.findByText('SI-000010');

    const slips = screen.getAllByText(/^SI-\d{6}$/).map((el) => el.textContent);
    expect(slips).toEqual(['SI-000010', 'SI-000011']);
  });

  it('shows the first weight for an open ticket and the net for a finished one', async () => {
    setup([open(), done()]);
    await screen.findByText('SI-000010');

    expect(screen.getByText('8,000 kg')).toBeInTheDocument();
    expect(screen.getByText('12,000 kg net')).toBeInTheDocument();
  });

  it('says so when nothing has been weighed yet', async () => {
    setup([]);
    expect(await screen.findByText(/nothing weighed yet/i)).toBeInTheDocument();
  });

  it('says so when the service cannot be reached', async () => {
    mocked.listWeighments.mockRejectedValue(new Error('offline'));
    renderWithQuery(<RecentWeighments onPick={vi.fn()} />);
    expect(await screen.findByText(/cannot reach the weighbridge service/i)).toBeInTheDocument();
  });
});

describe('picking one', () => {
  it('fetches that slip instead of making the operator type it', async () => {
    const { onPick, user } = setup([open()]);
    await screen.findByText('SI-000010');

    await user.click(screen.getByText('SI-000010'));
    expect(onPick).toHaveBeenCalledWith('SI-000010');
  });
});

describe('staying current', () => {
  it('can be refreshed by hand', async () => {
    const { user } = setup([open()]);
    await screen.findByText('SI-000010');

    // Relative, not absolute: the list also polls, so an exact call count
    // would be testing the clock rather than the button.
    const before = mocked.listWeighments.mock.calls.length;
    await user.click(screen.getByRole('button', { name: /refresh recent weighments/i }));
    await waitFor(() => expect(mocked.listWeighments.mock.calls.length).toBeGreaterThan(before));
  });
});
