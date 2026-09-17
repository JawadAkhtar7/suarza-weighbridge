/**
 * Recent weighments, for picking instead of typing (operator feedback).
 *
 * Open tickets come first and are the point of the list: those are the trucks
 * that are going to come back, and clicking one is faster and less error-prone
 * than reading a dusty slip and typing six digits. Completed ones are there so
 * a driver asking for another copy can be found without a slip at all.
 *
 * Paged, in a box of its own height. A weighbridge accumulates records for
 * years, and fetching them all would make the screen slower every month while
 * pushing the rest of the page off the bottom. A page at a time keeps both the
 * request and the layout the same size on day one and in year three, and the
 * ordering is done by the database so an open ticket can never be stranded on
 * a page nobody loaded.
 */

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
  cn,
} from '@suarza/ui';
import {
  formatDateTimePkt,
  formatKg,
  vehicleTypeLabel,
  type Weighment,
  type WeighmentStatus,
} from '@suarza/shared';
import { ChevronDown, Clock, Loader2, RefreshCw, Search } from 'lucide-react';
import { agentApi } from '../lib/api.js';
import { useDebounced } from '../hooks/use-debounced.js';

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

/** A page: enough to cover the trucks currently on site, small to fetch. */
const PAGE_SIZE = 20;

interface RecentWeighmentsProps {
  onPick: (slipNumber: string) => void;
}

export function RecentWeighments({ onPick }: RecentWeighmentsProps) {
  const [search, setSearch] = useState('');
  // Debounced: this hits the weighbridge on every keystroke otherwise, and a
  // slip number is six digits typed quickly.
  const q = useDebounced(search, 250);

  const query = useInfiniteQuery({
    // The search is part of the key, so changing it starts the paging again
    // rather than appending results from a different question.
    queryKey: ['recent-weighments', q],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      agentApi.listWeighments({ q, limit: PAGE_SIZE, offset: pageParam as number }),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.rows.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
    /*
     * Polls only while the operator is looking at the top of the list.
     *
     * Refetching an infinite query refetches EVERY loaded page, so an operator
     * who has paged back through a month of records would otherwise fire a
     * request per page every fifteen seconds. Someone reading history is not
     * waiting for a truck to arrive, so the poll stops once they page back and
     * resumes when they are back to one page.
     */
    refetchInterval: (state) => ((state.state.data?.pages.length ?? 1) > 1 ? false : 15_000),
    retry: false,
  });

  const pages = query.data?.pages ?? [];
  // Already ordered by the database: open tickets first, newest first within
  // each group. Sorting here would only reorder the page in hand.
  const ordered = pages.flatMap((page) => page.rows);
  const total = pages[0]?.total ?? 0;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-2 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4" />
          Recent weighments
          {total > 0 && <span className="text-xs font-normal text-muted-foreground">({total})</span>}
        </CardTitle>

        <div className="relative ml-auto min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search weighments"
            placeholder="Slip, customer or vehicle"
            className="h-9 pl-8"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

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
            {q ? `Nothing matches “${q}”.` : 'Nothing weighed yet today.'}
          </p>
        ) : (
          <div className="h-[19rem] overflow-y-auto">
            <ul className="divide-y">
              {ordered.map((row) => (
                <RecentRow key={row.id} weighment={row} onPick={onPick} />
              ))}
            </ul>

            {/* Inside the scroll area, so it sits under the last row where the
                operator's eye already is rather than pinned somewhere else. */}
            <div className="p-3">
              {query.hasNextPage ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                  Load more
                </Button>
              ) : (
                <p className="text-center text-xs text-muted-foreground">
                  {ordered.length} of {total} shown — that is all of them.
                </p>
              )}
            </div>
          </div>
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
            {vehicleTypeLabel(weighment.vehicle_type, weighment.vehicle_type_label)} · {weighment.vehicle_plate}
          </span>
          <span className="tabular">{formatDateTimePkt(weighment.first_weight_at)}</span>
        </div>
      </button>
    </li>
  );
}
