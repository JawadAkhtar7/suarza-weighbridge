/**
 * The sales table (brief §9): TanStack Table with SERVER-side pagination.
 *
 * Server-side matters: a year of weighments is tens of thousands of rows, and
 * a manager on a phone must not download all of them to look at one page.
 */

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@suarza/ui';
import {
  formatDateTimePkt,
  formatKg,
  formatPKR,
  vehicleTypeLabel,
  type PaginatedWeighments,
  type WeighmentRow,
  type WeighmentStatus,
} from '@suarza/shared';
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { MD_BREAKPOINT, useMediaQuery } from '../hooks/use-media-query.js';
import { CustomerId } from './ledger-bits.js';

const STATUS_VARIANT: Record<WeighmentStatus, 'secondary' | 'success' | 'destructive'> = {
  OPEN: 'secondary',
  COMPLETED: 'success',
  VOID: 'destructive',
};

interface SalesTableProps {
  data: PaginatedWeighments | undefined;
  isLoading: boolean;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onSelect: (weighment: WeighmentRow) => void;
}

export function SalesTable({
  data,
  isLoading,
  page,
  pageSize,
  onPageChange,
  onSelect,
}: SalesTableProps) {
  const columns: ColumnDef<WeighmentRow>[] = [
    {
      accessorKey: 'slip_number',
      header: 'Slip',
      cell: ({ row }) => <span className="tabular font-semibold">{row.original.slip_number}</span>,
    },
    {
      accessorKey: 'first_weight_at',
      header: 'Weighed',
      cell: ({ row }) => (
        <span className="tabular whitespace-nowrap text-muted-foreground">
          {formatDateTimePkt(row.original.first_weight_at)}
        </span>
      ),
    },
    {
      accessorKey: 'customer_name',
      header: 'Customer',
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {row.original.customer_name || <span className="text-muted-foreground">No name</span>}
          </p>
          {/* Dropped entirely rather than shown as a dash: this is a subtitle,
              and an empty line under every individual customer is just noise. */}
          {row.original.customer_company && (
            <p className="truncate text-xs text-muted-foreground">
              {row.original.customer_company}
            </p>
          )}
          {/* The ledger account this weighing belongs to. Absent until the
              account exists, which for an open ticket it does not. */}
          {row.original.customer_id && <CustomerId id={row.original.customer_id} />}
        </div>
      ),
    },
    {
      accessorKey: 'vehicle_plate',
      header: 'Vehicle',
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate">{row.original.vehicle_plate}</p>
          <p className="truncate text-xs text-muted-foreground">
            {vehicleTypeLabel(row.original.vehicle_type, row.original.vehicle_type_label)}
          </p>
        </div>
      ),
    },
    {
      accessorKey: 'net_weight_kg',
      header: () => <div className="text-right">Net weight</div>,
      cell: ({ row }) => (
        <div className="tabular whitespace-nowrap text-right">
          {row.original.status === 'COMPLETED' ? formatKg(row.original.net_weight_kg) : '—'}
        </div>
      ),
    },
    {
      accessorKey: 'amount_charged',
      header: () => <div className="text-right">Amount</div>,
      cell: ({ row }) => (
        <div className="tabular whitespace-nowrap text-right font-medium">
          {formatPKR(row.original.amount_charged)}
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={STATUS_VARIANT[row.original.status]}>{row.original.status}</Badge>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(row.original);
          }}
        >
          <FileText className="h-4 w-4" />
          Receipt
        </Button>
      ),
    },
  ];

  // Rendered conditionally rather than hidden with CSS: showing both and
  // hiding one would put every row in the DOM twice, and a screen reader would
  // read the whole page of results twice over.
  const isWide = useMediaQuery(MD_BREAKPOINT);

  const table = useReactTable({
    data: data?.rows ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    // The server has already paginated; the table must not try to do it again.
    manualPagination: true,
    pageCount: data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1,
  });

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);

  return (
    <Card>
      {/* A phone gets a list of cards, not a table. Eight columns need ~970px
          and a phone has ~360 — the table would technically "work" by scrolling
          sideways, but the manager would have to scroll to see the amount,
          which is the number they opened the app for. */}
      {!isWide && (
        <ul className="divide-y">
          {isLoading ? (
            Array.from({ length: 5 }, (_, index) => (
              <li key={index} className="space-y-2 p-4">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-4 w-full" />
              </li>
            ))
          ) : (data?.rows.length ?? 0) === 0 ? (
            <li className="p-8 text-center text-muted-foreground">
              No weighments match these filters.
            </li>
          ) : (
            data?.rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onSelect(row)}
                  className="flex w-full flex-col gap-2 p-4 text-left active:bg-muted/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="tabular font-semibold">{row.slip_number}</span>
                    <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>
                  </div>

                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {row.customer_name || <span className="text-muted-foreground">No name</span>}
                      </p>
                      {row.customer_company && (
                        <p className="truncate text-xs text-muted-foreground">
                          {row.customer_company}
                        </p>
                      )}
                      {row.customer_id && <CustomerId id={row.customer_id} />}
                    </div>
                    <span className="tabular shrink-0 font-semibold">
                      {formatPKR(row.amount_charged)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular">{formatDateTimePkt(row.first_weight_at)}</span>
                    <span>
                      {vehicleTypeLabel(row.vehicle_type, row.vehicle_type_label)} ·{' '}
                      {row.vehicle_plate}
                    </span>
                    {row.status === 'COMPLETED' && (
                      <span className="tabular font-medium text-foreground">
                        {formatKg(row.net_weight_kg)} net
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {isWide && (
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>

            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }, (_, index) => (
                  <TableRow key={index}>
                    {columns.map((_column, columnIndex) => (
                      <TableCell key={columnIndex}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="py-10 text-center text-muted-foreground"
                  >
                    No weighments match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => onSelect(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm">
        <p className="text-muted-foreground">
          {total === 0 ? 'No results' : `${firstRow}–${lastRow} of ${total.toLocaleString()}`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || isLoading}
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
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pageCount || isLoading}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
