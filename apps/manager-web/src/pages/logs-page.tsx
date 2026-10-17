/**
 * The log: who was on the bridge, and which slips were set aside.
 *
 * Four kinds of event to begin with, which is deliberate — a log that
 * records everything is read by nobody. These are the ones somebody actually
 * asks about afterwards: who started a shift and when it ended, and which
 * slips a manager voided or brought back.
 *
 * Read-only, and there is no way to write one from this screen. A log a
 * manager can edit answers nothing.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@suarza/ui';
import {
  LOG_KINDS,
  LOG_KIND_LABELS,
  OPERATOR_SLOT_LABELS,
  formatDateTimePkt,
  type LogEntry,
  type LogKind,
} from '@suarza/shared';
import { ChevronLeft, ChevronRight, LogIn, LogOut, Ban, Undo2 } from 'lucide-react';
import { api } from '../lib/api.js';

const PAGE_SIZE = 50;

/** Shift events read as neutral; voiding a slip is the one worth noticing. */
const KIND_STYLE: Record<LogKind, { icon: typeof LogIn; variant: 'secondary' | 'destructive' }> = {
  SHIFT_START: { icon: LogIn, variant: 'secondary' },
  SHIFT_END: { icon: LogOut, variant: 'secondary' },
  WEIGHMENT_VOID: { icon: Ban, variant: 'destructive' },
  WEIGHMENT_RESTORE: { icon: Undo2, variant: 'secondary' },
};

function Who({ entry }: { entry: LogEntry }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{entry.actor_name || entry.actor}</p>
      <p className="truncate text-xs text-muted-foreground">
        {entry.slot ? OPERATOR_SLOT_LABELS[entry.slot] : entry.actor}
      </p>
    </div>
  );
}

export function LogsPage() {
  const [kind, setKind] = useState<LogKind | 'all'>('all');
  const [page, setPage] = useState(1);

  const logs = useQuery({
    queryKey: ['logs', kind, page],
    queryFn: () => api.logs({ page, page_size: PAGE_SIZE, ...(kind === 'all' ? {} : { kind }) }),
    placeholderData: (previous) => previous,
  });

  const total = logs.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Logs</h1>
          <p className="text-sm text-muted-foreground">
            Shifts starting and ending at the weighbridge, and slips voided or restored here.
          </p>
        </div>

        <Select
          value={kind}
          onValueChange={(value) => {
            setKind(value as LogKind | 'all');
            // Page 7 of one kind is meaningless under another.
            setPage(1);
          }}
        >
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everything</SelectItem>
            {LOG_KINDS.map((value) => (
              <SelectItem key={value} value={value}>
                {LOG_KIND_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Slip</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {logs.isLoading ? (
                Array.from({ length: 6 }, (_, index) => (
                  <TableRow key={index}>
                    {Array.from({ length: 5 }, (_, cell) => (
                      <TableCell key={cell}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (logs.data?.rows.length ?? 0) === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    Nothing logged yet.
                  </TableCell>
                </TableRow>
              ) : (
                logs.data?.rows.map((entry) => {
                  const style = KIND_STYLE[entry.kind];
                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="tabular whitespace-nowrap text-muted-foreground">
                        {formatDateTimePkt(entry.at)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={style.variant} className="gap-1.5 whitespace-nowrap">
                          <style.icon className="h-3.5 w-3.5" />
                          {LOG_KIND_LABELS[entry.kind]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Who entry={entry} />
                      </TableCell>
                      <TableCell className="tabular">
                        {entry.subject ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{entry.detail ?? '—'}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm">
          <p className="text-muted-foreground">
            {total === 0
              ? 'No entries'
              : `${total.toLocaleString()} entr${total === 1 ? 'y' : 'ies'}`}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page - 1)}
              disabled={page <= 1 || logs.isLoading}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <span className="tabular text-muted-foreground">
              Page {page} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={page >= pageCount || logs.isLoading}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
