/**
 * Recent weighments, for picking instead of typing (operator feedback).
 *
 * Open tickets come first and are the point of the list: those are the trucks
 * that are going to come back, and clicking one is faster and less error-prone
 * than reading a dusty slip and typing six digits. Completed ones are there so
 * a driver asking for another copy can be found without a slip at all.
 */

import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton, cn } from '@suarza/ui';
import {
  formatDateTimePkt,
  formatKg,
  vehicleTypeLabel,
  type Weighment,
  type WeighmentStatus,
} from '@suarza/shared';
import { Clock, RefreshCw } from 'lucide-react';
import { agentApi } from '../lib/api.js';

const STATUS_VARIANT: Record<WeighmentStatus, 'secondary' | 'success' | 'destructive'> = {
  OPEN: 'secondary',
  COMPLETED: 'success',
  VOID: 'destructive',
};

const STATUS_LABEL: Record<WeighmentStatus, string> = {
  OPEN: 'Awaiting 2nd weight',
  COMPLETED: 'Completed',
  VOID: 'Voided',
};

/** Enough to cover a shift without turning into a scroll. */
const LIMIT = 25;

interface RecentWeighmentsProps {
  onPick: (slipNumber: string) => void;
}

export function RecentWeighments({ onPick }: RecentWeighmentsProps) {
  const query = useQuery({
    queryKey: ['recent-weighments'],
    queryFn: () => agentApi.listWeighments({ limit: LIMIT }),
    // Another operator on a second screen, or a record completed a moment ago,
    // should show up without a manual refresh.
    refetchInterval: 15_000,
    retry: false,
  });

  const rows = query.data?.rows ?? [];
  // Open tickets first — they are the ones that still need something doing.
  const ordered = [...rows].sort((a, b) => {
    if (a.status === b.status) return 0;
    if (a.status === 'OPEN') return -1;
    if (b.status === 'OPEN') return 1;
    return 0;
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4" />
          Recent weighments
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Refresh recent weighments"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={cn('h-4 w-4', query.isFetching && 'animate-spin')} />
        </Button>
      </CardHeader>

      <CardContent className="p-0">
        {query.isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Cannot reach the weighbridge service.
          </p>
        ) : ordered.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Nothing weighed yet today.
          </p>
        ) : (
          <ul className="max-h-[28rem] divide-y overflow-y-auto">
            {ordered.map((row) => (
              <RecentRow key={row.id} weighment={row} onPick={onPick} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RecentRow({
  weighment,
  onPick,
}: {
  weighment: Weighment;
  onPick: (slipNumber: string) => void;
}) {
  const isOpen = weighment.status === 'OPEN';

  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(weighment.slip_number)}
        className={cn(
          'flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-accent',
          isOpen && 'border-l-2 border-l-primary',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="tabular font-semibold">{weighment.slip_number}</span>
          <Badge variant={STATUS_VARIANT[weighment.status]}>{STATUS_LABEL[weighment.status]}</Badge>
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-sm">{weighment.customer_name}</span>
          <span className="tabular shrink-0 text-sm text-muted-foreground">
            {weighment.status === 'COMPLETED'
              ? `${formatKg(weighment.net_weight_kg)} net`
              : formatKg(weighment.first_weight_kg)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          <span>
            {vehicleTypeLabel(weighment.vehicle_type)} · {weighment.vehicle_plate}
          </span>
          <span className="tabular">{formatDateTimePkt(weighment.first_weight_at)}</span>
        </div>
      </button>
    </li>
  );
}
