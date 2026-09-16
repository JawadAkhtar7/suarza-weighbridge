import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Analytics, PaginatedWeighments, Weighment } from '@suarza/shared';

export function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

export function weighment(overrides: Partial<Weighment> = {}): Weighment {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slip_number: 'SI-000001',
    status: 'COMPLETED',
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
    second_weight_kg: 20_000,
    second_weight_at: '2026-09-14T11:00:00.000Z',
    second_weight_src: 'SERIAL',
    net_weight_kg: 12_000,
    amount_charged: 300,
    currency: 'PKR',
  payment_status: 'PAID',
    operator_username: 'operator',
    created_at: '2026-09-14T09:00:00.000Z',
    updated_at: '2026-09-14T11:00:00.000Z',
    void_reason: null,
    voided_at: null,
    ...overrides,
  };
}

export function page(
  rows: Weighment[],
  total = rows.length,
  pageNumber = 1,
  pageSize = 25,
): PaginatedWeighments {
  // The table shows the ledger account each weighing belongs to; the server
  // resolves it per row, so a fixture supplies one too.
  return {
    rows: rows.map((row) => ({ ...row, customer_id: null })),
    total,
    page: pageNumber,
    page_size: pageSize,
  };
}

export function analytics(overrides: Partial<Analytics> = {}): Analytics {
  return {
    total_weighments: 4,
    completed_weighments: 3,
    open_weighments: 1,
    total_revenue: 1500,
    total_net_weight_kg: 39_000,
    revenue_by_vehicle_type: [
      { vehicle_type: 'truck', revenue: 600, count: 2 },
      { vehicle_type: 'container', revenue: 500, count: 1 },
      { vehicle_type: 'dumper', revenue: 400, count: 1 },
    ],
    weighments_over_time: [
      { date: '2026-09-10', count: 1, revenue: 300 },
      { date: '2026-09-11', count: 1, revenue: 500 },
      { date: '2026-09-12', count: 2, revenue: 700 },
    ],
    top_customers: [{ customer_name: 'Ali Raza', count: 2, revenue: 600 }],
    top_companies: [
      { customer_company: 'Raza Traders', count: 2, revenue: 600 },
      { customer_company: 'Khan Brothers', count: 1, revenue: 500 },
    ],
    ...overrides,
  };
}
