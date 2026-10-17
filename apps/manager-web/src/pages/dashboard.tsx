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
  Label,
  Textarea,
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
  /** The row a manager has asked to void, held until they give a reason. */
  const [voiding, setVoiding] = useState<WeighmentRow | null>(null);
  const [reason, setReason] = useState('');

  const { user } = useAuth();
  /* Voiding takes a weighing out of the day's takings, so the buttons are
     only offered to an administrator — and the server refuses anyone else
     regardless. */
  const canVoid = user?.role === 'ADMIN';
  const queryClient = useQueryClient();

  /* Everything that counts this weighing is now answering an older question:
     the table, the tiles and the charts all read from it, and so does the
     ledger, whose charge has just been voided or brought back. */
  const refreshEverything = () => {
    void queryClient.invalidateQueries({ queryKey: ['weighments'] });
    void queryClient.invalidateQueries({ queryKey: ['analytics'] });
    void queryClient.invalidateQueries({ queryKey: ['ledger'] });
    /* The void itself is now an entry in the log. */
    void queryClient.invalidateQueries({ queryKey: ['logs'] });
  };

  const voidSlip = useMutation({
    mutationFn: ({ slip, why }: { slip: string; why: string }) => api.voidWeighment(slip, why),
    onSuccess: ({ weighment }) => {
      refreshEverything();
      setVoiding(null);
      setReason('');
      toast.success(`Slip ${weighment.slip_number} voided`, {
        description: 'It stays on the record but no longer counts towards anything.',
      });
    },
    onError: (error) =>
      toast.error('Could not void the slip', {
        description: error instanceof ApiError ? error.message : 'Unexpected error.',
      }),
  });

  const restoreSlip = useMutation({
    mutationFn: (slip: string) => api.restoreWeighment(slip),
    onSuccess: ({ weighment }) => {
      refreshEverything();
      toast.success(`Slip ${weighment.slip_number} restored`, {
        description: 'It counts again, and its charge is back on the account.',
      });
    },
    onError: (error) =>
      toast.error('Could not restore the slip', {
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
        onVoid={
          canVoid
            ? (row) => {
                setReason('');
                setVoiding(row);
              }
            : undefined
        }
        onRestore={canVoid ? (row) => restoreSlip.mutate(row.slip_number) : undefined}
      />

      <Suspense fallback={<ChartsFallback />}>
        <DashboardCharts analytics={analytics.data} isLoading={analytics.isLoading} />
      </Suspense>

      {/*
       * A reason is offered, not demanded. The log already records who voided
       * which slip and when, so insisting on a sentence here only taught the
       * manager to type "x" — and a box of x's is worse than an empty one,
       * because it looks like a reason.
       */}
      <Dialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (!open) setVoiding(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void slip {voiding?.slip_number}?</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <p>
              <span className="font-medium">{voiding?.customer_name || 'No customer'}</span>
              {voiding?.vehicle_plate ? ` · ${voiding.vehicle_plate}` : ''}
              {voiding ? ` · ${formatPKR(voiding.amount_charged)}` : ''}
            </p>
            <div className="space-y-1">
              <Label htmlFor="void-reason" className="text-xs font-normal">
                Reason <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="void-reason"
                rows={2}
                placeholder="Why is this being set aside?"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiding(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={voidSlip.isPending}
              onClick={() =>
                voiding && voidSlip.mutate({ slip: voiding.slip_number, why: reason.trim() })
              }
            >
              {voidSlip.isPending ? 'Voiding…' : 'Void this slip'}
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
