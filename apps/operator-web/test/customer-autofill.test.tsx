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
      createCompletedWeighment: vi.fn(),
      getSettings: vi.fn(),
      /* The repeat flow fetches a slip and asks whether it has photographs. */
      getWeighment: vi.fn(),
      slipCaptures: vi.fn(),
    },
  };
});

import { agentApi } from '../src/lib/api.js';
import { NewWeighmentForm } from '../src/components/new-weighment-form.js';
import { renderWithQuery, weighment as aWeighment } from './utils.js';

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
  await user.type(screen.getByLabelText(/search customer/i), 'ali');
  await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
  await user.click(screen.getByText(/Ali Raza — Raza Traders/));
}

describe('picking a customer', () => {
  it('offers matches from the directory', async () => {
    const user = setup();
    await user.type(screen.getByLabelText(/search customer/i), 'ali');

    await waitFor(() => expect(screen.getByText(/Ali Raza — Raza Traders/)).toBeInTheDocument());
    // The truck, not how often they have been here.
    expect(screen.getByRole('listbox')).toHaveTextContent('LES-1234');
    expect(screen.queryByText(/weighed .* here/i)).not.toBeInTheDocument();
  });

  it('lists the same customer once per truck, and fills in the truck picked', async () => {
    // As the agent answers a plate search matching two of Ali's trucks.
    const user = setup([
      customer({ last_vehicle_plate: 'LES-1234', last_vehicle_type: 'trailer' }),
      customer({ last_vehicle_plate: 'RER-9600', last_vehicle_type: 'truck' }),
    ]);
    await user.type(screen.getByLabelText(/search customer or vehicle plate/i), 'les');

    await waitFor(() => expect(screen.getAllByText(/Ali Raza — Raza Traders/)).toHaveLength(2));
    await user.click(screen.getByText('RER-9600'));

    expect(field(/number plate/i).value).toBe('RER-9600');
    expect(vehicleType()).toMatch(/truck/i);
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
    expect(field(/number plate/i).value).toBe('LES-1234');
    expect(field(/product/i).value).toBe('Cement');
  });

  it('keeps showing who was picked, so the operator can see their own choice', async () => {
    // Clearing the box would leave the operator with no way to tell whether a
    // customer was selected at all, or which of two similar names it was.
    const user = setup();
    await pickCustomer(user);
    expect((screen.getByLabelText(/search customer/i) as HTMLInputElement).value).toBe(
      'Ali Raza — Raza Traders',
    );
  });
});

describe('what the operator already typed wins', () => {
  it('keeps a plate typed before the customer was picked', async () => {
    const user = setup();
    await user.type(field(/number plate/i), 'LHR-9999');
    await pickCustomer(user);

    // Today's truck is not last month's truck.
    expect(field(/number plate/i).value).toBe('LHR-9999');
  });

  it('does not contradict that plate with a stale vehicle type', async () => {
    // The bug this guards: filling the plate and then deciding the vehicle
    // type from a snapshot taken after the fill.
    const user = setup();
    await user.type(field(/number plate/i), 'LHR-9999');
    await pickCustomer(user);

    expect(vehicleType()).toBe('Truck');
  });

  it('does apply the remembered vehicle when no plate was typed', async () => {
    const user = setup();
    await pickCustomer(user);

    expect(field(/number plate/i).value).toBe('LES-1234');
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
    await user.type(screen.getByLabelText(/search customer/i), 'Brand New');
    await waitFor(() =>
      expect(screen.getByText(/no customer or vehicle like that yet/i)).toBeInTheDocument(),
    );

    await user.type(field(/customer name/i), 'Brand New Customer');
    expect(field(/customer name/i).value).toBe('Brand New Customer');
  });
});

/** The repeat flow, where both ways of filling the form are offered. */
function setupRepeat() {
  mocked.searchCustomers.mockResolvedValue({ customers: [customer()] });
  mocked.slipCaptures.mockResolvedValue({ front: null, side: null });
  mocked.getSettings.mockRejectedValue(new Error('settings unavailable in this test'));
  renderWithQuery(<NewWeighmentForm captured={null} onSaved={vi.fn()} flow="fourth" />);
  return userEvent.setup();
}

describe('the fourth-weight flow fills from two places at once', () => {
  /*
   * Both ways of starting a repeat weighing are offered side by side: search
   * the customer, or fetch the slip the driver is holding. Either may come
   * first, and they fill different halves of the form — so neither may
   * overwrite what the other has already put in.
   */
  const slip = {
    weighment: aWeighment({
      slip_number: '20261',
      customer_name: 'Ali Raza',
      customer_company: 'Raza Traders',
      vehicle_plate: 'LES-1234',
      product: 'Cement',
      first_weight_kg: 8000,
      second_weight_kg: 20_000,
      status: 'COMPLETED',
    }),
    net: { kg: 12_000, ton: 12, maund: 300 },
  };

  it('offers the customer search, which the first-weight flow always had', () => {
    setupRepeat();
    expect(screen.getByLabelText(/search customer/i)).toBeInTheDocument();
  });

  it('fills the customer from a fetched slip when nothing has been typed', async () => {
    mocked.getWeighment.mockResolvedValue(slip);
    const user = setupRepeat();

    await user.type(screen.getByLabelText(/slip number/i), '1{Enter}');

    await waitFor(() => expect(field(/customer name/i).value).toBe('Ali Raza'));
    expect(field(/number plate/i).value).toBe('LES-1234');
  });

  it('leaves a customer already chosen alone when a slip is fetched after', async () => {
    /*
     * The interference this exists to prevent. The operator finds the
     * customer, then fetches the slip for the weights — and the slip's own
     * customer, which may be an older spelling or a different company, must
     * not quietly replace the one just chosen.
     */
    mocked.getWeighment.mockResolvedValue(slip);
    const user = setupRepeat();

    await user.type(field(/customer name/i), 'Someone Else');
    await user.type(field(/number plate/i), 'ABC-999');

    await user.type(screen.getByLabelText(/slip number/i), '1{Enter}');
    // More than one element mentions the slip once it is fetched; any of them
    // appearing means the fetch has landed, which is all this waits for.
    await waitFor(() => expect(screen.getAllByText(/filled from slip/i).length).toBeGreaterThan(0));

    expect(field(/customer name/i).value).toBe('Someone Else');
    expect(field(/number plate/i).value).toBe('ABC-999');
  });
});
