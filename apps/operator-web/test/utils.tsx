import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@suarza/ui';
import { ReceiptSettingsProvider } from '../src/components/receipt-settings-provider.js';
import type { LiveWeightResult } from '../src/hooks/use-live-weight.js';
import type { IndicatorState } from '../src/lib/indicator-state.js';

export function liveResult(state: IndicatorState = 'STABLE', weightKg = 20_000): LiveWeightResult {
  return {
    weightKg,
    state,
    simulated: false,
    indicatorError: null,
    agentReachable: state !== 'AGENT_DOWN',
  };
}

/** Renders inside a fresh QueryClient so state never leaks between tests. */
export function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ReceiptSettingsProvider>{children}</ReceiptSettingsProvider>
      {/* Present because the app has one: several behaviours only surface to
          the operator as a toast, and a test that cannot see them would pass
          while the operator saw nothing. */}
      <Toaster />
    </QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

export function weighment(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slip_number: 'SI-000001',
    status: 'OPEN',
    station_id: 'A',
    customer_name: 'Ali Raza',
    customer_company: 'Raza Traders',
    customer_phone: undefined,
    vehicle_type: 'truck',
    vehicle_plate: 'LES-1234',
    container_number: undefined,
    product: 'Cement',
    first_weight_kg: 8000,
    first_weight_at: '2026-09-14T09:00:00.000Z',
    first_weight_src: 'SERIAL',
    second_weight_kg: null,
    second_weight_at: null,
    second_weight_src: null,
    net_weight_kg: 0,
    amount_charged: 300,
    currency: 'PKR',
    operator_username: 'operator',
    created_at: '2026-09-14T09:00:00.000Z',
    updated_at: '2026-09-14T09:00:00.000Z',
    void_reason: null,
    voided_at: null,
    ...overrides,
  } as never;
}
