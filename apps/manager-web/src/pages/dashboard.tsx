/** The dashboard (brief §9). Filters drive every figure on the page. */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { WeighmentRow } from '@suarza/shared';
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

export function Dashboard() {
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  /* The row, not just the weighing: it carries the slip's two capture ids, so
     the dialog can start fetching the photographs the instant it opens. */
  const [selected, setSelected] = useState<WeighmentRow | null>(null);

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
        captures={selected?.captures}
        onClose={() => setSelected(null)}
        receiptBaseUrl={window.location.origin}
      />
    </div>
  );
}
