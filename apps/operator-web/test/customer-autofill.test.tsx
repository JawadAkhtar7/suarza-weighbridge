/**
 * Picking an existing customer fills the form (operator feedback item 8).
 *
 * The rule that matters: what the operator has already typed wins. A plate
 * typed before the customer was picked must survive, and must not be
 * contradicted by a vehicle type from a previous visit.
 */

import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Customer } from '@suarza/shared';

// A namespace type-import rather than `typeof import(...)`: the inline form is
// banned by the shared consistent-type-imports rule.
import type * as ApiModule from '../src/lib/api.js';

vi.mock('../src/lib/api.js', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api.js');
  return {
    ...actual,
    agentApi: {
      ...actual.agentApi,
      searchCustomers: vi.fn(),
      createWeighment: vi.fn(),
      getSettings: vi.fn(),
    },
  };
});

import { agentApi } from '../src/lib/api.js';
import { NewWeighmentForm } from '../src/components/new-weighment-form.js';
import { renderWithQuery } from './utils.js';

const mocked = vi.mocked(agentApi);

const customer = (overrides: Partial<Customer> = {}): Customer => ({
  id: 'c1',
  name: 'Ali Raza',
  company: 'Raza Traders',
  phone: '0300-1234567',
  last_vehicle_type: 'trailer',
  last_vehicle_plate: 'LES-1234',
  last_product: 'Cement',
  weighment_count: 4,
  last_seen_at: '2026-09-14T09:00:00.000Z',
  ...overrides,
});

function setup(found: Customer[] = [customer()]) {
  mocked.searchCustomers.mockResolvedValue({ customers: found });
  mocked.getSettings.mockRejectedValue(new Error('settings unavailable in this test'));
  renderWithQuery(<NewWeighmentForm captured={{ kg: 8000, source: 'SERIAL' }} onSaved={vi.fn()} />);
  return userEvent.setup();
}

const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
/** The select's own value — "Truck" also appears in the rate hint below it. */
const vehicleType = () => screen.getByLabelText(/vehicle type/i).textContent?.trim();

async function pickCustomer(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/find an existing customer/i), 'ali');
  await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
  await user.click(screen.getByText(/Ali Raza — Raza Traders/));
}

describe('picking a customer', () => {
  it('offers matches from the directory', async () => {
    const user = setup();
    await user.type(screen.getByLabelText(/find an existing customer/i), 'ali');

    await waitFor(() => expect(screen.getByText(/Ali Raza — Raza Traders/)).toBeInTheDocument());
    expect(screen.getByText(/weighed 4 times here/i)).toBeInTheDocument();
  });

  it('fills the identity fields', async () => {
    const user = setup();
    await pickCustomer(user);

    expect(field(/customer name/i).value).toBe('Ali Raza');
    expect(field(/^company/i).value).toBe('Raza Traders');
  });

  it('fills the details it knows', async () => {
    const user = setup();
    await pickCustomer(user);

    expect(field(/phone/i).value).toBe('0300-1234567');
    expect(field(/vehicle plate/i).value).toBe('LES-1234');
    expect(field(/product/i).value).toBe('Cement');
  });

  it('clears the search box, so it does not look like a filter is stuck on', async () => {
    const user = setup();
    await pickCustomer(user);
    expect((screen.getByLabelText(/find an existing customer/i) as HTMLInputElement).value).toBe(
      '',
    );
  });
});

describe('what the operator already typed wins', () => {
  it('keeps a plate typed before the customer was picked', async () => {
    const user = setup();
    await user.type(field(/vehicle plate/i), 'LHR-9999');
    await pickCustomer(user);

    // Today's truck is not last month's truck.
    expect(field(/vehicle plate/i).value).toBe('LHR-9999');
  });

  it('does not contradict that plate with a stale vehicle type', async () => {
    // The bug this guards: filling the plate and then deciding the vehicle
    // type from a snapshot taken after the fill.
    const user = setup();
    await user.type(field(/vehicle plate/i), 'LHR-9999');
    await pickCustomer(user);

    expect(vehicleType()).toBe('Truck');
  });

  it('does apply the remembered vehicle when no plate was typed', async () => {
    const user = setup();
    await pickCustomer(user);

    expect(field(/vehicle plate/i).value).toBe('LES-1234');
    expect(vehicleType()).toBe('Trailer');
  });

  it('keeps a product typed first', async () => {
    const user = setup();
    await user.type(field(/product/i), 'Wheat');
    await pickCustomer(user);
    expect(field(/product/i).value).toBe('Wheat');
  });

  it('keeps a phone typed first', async () => {
    const user = setup();
    await user.type(field(/phone/i), '0311-0000000');
    await pickCustomer(user);
    expect(field(/phone/i).value).toBe('0311-0000000');
  });
});

describe('a customer with gaps', () => {
  it('fills only what is known and leaves the rest alone', async () => {
    const user = setup([customer({ phone: null, last_product: null, last_vehicle_plate: null })]);
    await pickCustomer(user);

    expect(field(/customer name/i).value).toBe('Ali Raza');
    expect(field(/phone/i).value).toBe('');
    expect(field(/product/i).value).toBe('');
  });
});

describe('a customer who has never been here', () => {
  it('never blocks typing a new name', async () => {
    const user = setup([]);
    await user.type(screen.getByLabelText(/find an existing customer/i), 'Brand New');
    await waitFor(() =>
      expect(screen.getByText(/no customer by that name yet/i)).toBeInTheDocument(),
    );

    await user.type(field(/customer name/i), 'Brand New Customer');
    expect(field(/customer name/i).value).toBe('Brand New Customer');
  });
});
