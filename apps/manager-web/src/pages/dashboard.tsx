/** The dashboard (brief §9). Filters drive every figure on the page. */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Weighment } from '@suarza/shared';
import { api } from '../lib/api.js';
import {
  DEFAULT_FILTERS,
  FiltersBar,
  toQuery,
  type DashboardFilters,
} from '../components/filters-bar.js';
import { StatTiles } from '../components/stat-tiles.js';
// Recharts is by far the heaviest dependency here and nothing needs it until
// a manager is signed in and looking at the dashboard. Splitting it keeps the
// login screen light on a phone with a slow connection.
const DashboardCharts = lazy(() => import('../components/charts.js'));
import { SalesTable } from '../components/sales-table.js';
import { ChartsFallback } from '../components/charts-fallback.js';
import { WeighmentDetail } from '../components/weighment-detail.js';

const PAGE_SIZE = 25;

/** `[PLACEHOLDER]` until the client supplies the real details (brief §14). */
const COMPANY = {
  name: 'Suarza International',
  address: '[PLACEHOLDER] Address line, City, Pakistan',
  phone: '[PLACEHOLDER] +92 300 0000000',
  logoUrl: '/logo.png',
};

export function Dashboard() {
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Weighment | null>(null);

  const query = useMemo(() => toQuery(filters), [filters]);

  // Page 7 of the old filters is meaningless under the new ones.
  useEffect(() => {
    setPage(1);
  }, [filters]);

  const weighments = useQuery({
    queryKey: ['weighments', query, page],
    queryFn: () => api.weighments({ ...query, page, page_size: PAGE_SIZE }),
    // Keeps the previous page on screen while the next loads, so the table
    // doesn't collapse to a skeleton on every click.
    placeholderData: (previous) => previous,
  });

  const analytics = useQuery({
    queryKey: ['analytics', query],
    queryFn: () => api.analytics(query),
  });

  return (
    <div className="space-y-6">
      <FiltersBar filters={filters} onChange={setFilters} />

      <StatTiles analytics={analytics.data} isLoading={analytics.isLoading} />

      {/* The table first: a manager opens this to look something up far more
          often than to look at a trend. The charts are context underneath. */}
      <SalesTable
        data={weighments.data}
        isLoading={weighments.isLoading}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        onSelect={setSelected}
      />

      <Suspense fallback={<ChartsFallback />}>
        <DashboardCharts analytics={analytics.data} isLoading={analytics.isLoading} />
      </Suspense>

      <WeighmentDetail
        weighment={selected}
        onClose={() => setSelected(null)}
        company={COMPANY}
        receiptBaseUrl={window.location.origin}
      />
    </div>
  );
}
