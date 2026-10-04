/**
 * Ledger — every customer account, worst first.
 *
 * The question this page answers is "who is in debit", so that is the default
 * sort and the first thing on the screen. Everything else is secondary.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Card,
  CardContent,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@suarza/ui';
import { balanceState, formatPKR, type LedgerQuery } from '@suarza/shared';
import { Search } from 'lucide-react';
import { api } from '../lib/api.js';
import { CustomerId } from '../components/ledger-bits.js';

const STATUS_TABS: { key: LedgerQuery['status']; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'owing', label: 'Debit' },
  { key: 'credit', label: 'Credit' },
  { key: 'settled', label: 'Settled' },
];

/** Rs 1,200 — never a bare negative number, which reads as an error. */
function BalanceCell({ balance }: { balance: number }) {
  const state = balanceState(balance);
  if (state === 'settled') {
    return (
      <span className="text-muted-foreground">
        Settled
      </span>
    );
  }

  return (
    <span className={cn('font-semibold', state === 'owing' ? 'text-destructive' : 'text-success')}>
      {formatPKR(Math.abs(balance))}
      <span className="block text-xs font-normal text-muted-foreground">
        {state === 'owing' ? 'debit' : 'credit'}
      </span>
    </span>
  );
}

export function LedgerPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<LedgerQuery['status']>('all');
  const summary = useQuery({ queryKey: ['ledger', 'summary'], queryFn: api.ledgerSummary });

  const customers = useQuery({
    queryKey: ['ledger', 'customers', search, status],
    queryFn: () => api.ledgerCustomers({ q: search || undefined, status, page_size: 200 }),
  });

  return (
    <div className="mx-auto max-w-[80rem] space-y-6">
      <div>
        <h1 className="flex items-baseline gap-2 text-xl font-semibold">
          Ledger
        </h1>
        <p className="text-sm text-muted-foreground">
          Each customer&rsquo;s debit and credit.
        </p>
        <p className="text-xs text-muted-foreground">
          An account opens by itself the first time a customer is weighed.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">
              Total debit
            </p>
            {summary.isLoading ? (
              <Skeleton className="mt-2 h-8 w-32" />
            ) : (
              <p className="tabular mt-1 text-2xl font-bold text-destructive">
                {formatPKR(summary.data?.total_receivable_pkr ?? 0)}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              from {summary.data?.customers_owing ?? 0} customer
              {summary.data?.customers_owing === 1 ? '' : 's'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">
              Total credit
            </p>
            {summary.isLoading ? (
              <Skeleton className="mt-2 h-8 w-32" />
            ) : (
              <p className="tabular mt-1 text-2xl font-bold text-success">
                {formatPKR(summary.data?.total_advance_pkr ?? 0)}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              from {summary.data?.customers_in_credit ?? 0} customer
              {summary.data?.customers_in_credit === 1 ? '' : 's'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[14rem] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search customers"
                placeholder="Search by name, company or phone"
                className="pl-8"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <div className="flex gap-1 rounded-md bg-muted p-1">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStatus(tab.key)}
                  className={cn(
                    'rounded px-3 py-1.5 text-sm font-medium transition-colors',
                    status === tab.key
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {customers.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((row) => (
                <Skeleton key={row} className="h-11 w-full" />
              ))}
            </div>
          ) : customers.data && customers.data.customers.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      ID
                    </TableHead>
                    <TableHead>
                      Customer
                    </TableHead>
                    <TableHead className="text-right">
                      Charged
                    </TableHead>
                    <TableHead className="text-right">
                      Paid
                    </TableHead>
                    <TableHead className="text-right">
                      Balance
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.data.customers.map((customer) => (
                    <TableRow
                      key={customer.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/ledger/${encodeURIComponent(customer.id)}`)}
                    >
                      <TableCell>
                        <CustomerId id={customer.id} />
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{customer.name}</p>
                        {customer.company && (
                          <p className="text-xs text-muted-foreground">{customer.company}</p>
                        )}
                      </TableCell>
                      <TableCell className="tabular text-right text-muted-foreground">
                        {formatPKR(customer.total_charged_pkr)}
                      </TableCell>
                      <TableCell className="tabular text-right text-muted-foreground">
                        {formatPKR(customer.total_paid_pkr)}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        <BalanceCell balance={customer.balance_pkr} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="py-10 text-center">
              <p className="text-sm font-medium">No accounts here yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {search || status !== 'all'
                  ? 'Nothing matches that search.'
                  : 'Accounts appear as customers are weighed.'}
              </p>
            </div>
          )}

          {customers.data && customers.data.total > 0 && (
            <p className="text-xs text-muted-foreground">
              {customers.data.total} account{customers.data.total === 1 ? '' : 's'}
              {status !== 'all' && (
                <Badge variant="secondary" className="ml-2">
                  {STATUS_TABS.find((t) => t.key === status)?.label}
                </Badge>
              )}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
