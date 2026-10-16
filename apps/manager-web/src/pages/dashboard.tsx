/** The dashboard (brief §9). Filters drive every figure on the page. */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatPKR, type WeighmentRow } from '@suarza/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from '@suarza/ui';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../hooks/use-auth.js';
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
  /** The row a manager has asked to delete, held until they confirm. */
  const [deleting, setDeleting] = useState<WeighmentRow | null>(null);

  const { user } = useAuth();
  /* Deleting removes a record of money taken, so the button is only offered
     to an administrator — and the server refuses anyone else regardless. */
  const canDelete = user?.role === 'ADMIN';
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: (slip: string) => api.deleteWeighment(slip),
    onSuccess: (summary) => {
      /* Everything that counted this weighing is now wrong: the table, the
         tiles and the charts all read from it, and so does the ledger. */
      void queryClient.invalidateQueries({ queryKey: ['weighments'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics'] });
      void queryClient.invalidateQueries({ queryKey: ['ledger'] });
      setDeleting(null);

      const removed = [
        summary.ledger_entries > 0 && 'its ledger entry',
        summary.photographs > 0 && `${summary.photographs} photograph(s)`,
        summary.audit_entries > 0 && `${summary.audit_entries} audit entries`,
      ].filter(Boolean);

      toast.success(`Slip ${summary.slip_number} deleted`, {
        description: removed.length > 0 ? `Removed with ${removed.join(', ')}.` : undefined,
      });
    },
    onError: (error) =>
      toast.error('Could not delete the slip', {
        description: error instanceof ApiError ? error.message : 'Unexpected error.',
      }),
  });

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
        onDelete={canDelete ? setDeleting : undefined}
      />

      <Suspense fallback={<ChartsFallback />}>
        <DashboardCharts analytics={analytics.data} isLoading={analytics.isLoading} />
      </Suspense>

      {/*
       * Asked out loud, and said plainly, because it cannot be undone: the
       * record goes from the database along with its ledger entry, its audit
       * trail and its photographs, and the weighbridge is told never to send
       * it again.
       */}
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete slip {deleting?.slip_number}?</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <p>
              <span className="font-medium">{deleting?.customer_name || 'No customer'}</span>
              {deleting?.vehicle_plate ? ` · ${deleting.vehicle_plate}` : ''}
              {deleting ? ` · ${formatPKR(deleting.amount_charged)}` : ''}
            </p>
            <p className="text-muted-foreground">
              This removes the weighing itself, its ledger entry, its audit trail and its
              photographs. It cannot be undone, and the weighbridge will not send it again.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting.slip_number)}
            >
              {remove.isPending ? 'Deleting…' : 'Delete for good'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WeighmentDetail
        weighment={selected}
        captures={selected?.captures}
        onClose={() => setSelected(null)}
        receiptBaseUrl={window.location.origin}
      />
    </div>
  );
}
