/**
 * Ledger — every customer account, worst first.
 *
 * The question this page answers is "who owes us money", so that is the default
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
import { LEDGER_URDU, balanceState, formatPKR, type LedgerQuery } from '@suarza/shared';
import { Search } from 'lucide-react';
import { api } from '../lib/api.js';
import { CustomerId, Urdu } from '../components/ledger-bits.js';

const STATUS_TABS: { key: LedgerQuery['status']; label: string; urdu: string }[] = [
  { key: 'all', label: 'All', urdu: LEDGER_URDU.all },
  { key: 'owing', label: 'Owing', urdu: LEDGER_URDU.owes },
  { key: 'credit', label: 'In credit', urdu: LEDGER_URDU.inCredit },
  { key: 'settled', label: 'Settled', urdu: LEDGER_URDU.settled },
];

/** Rs 1,200 — never a bare negative number, which reads as an error. */
function BalanceCell({ balance }: { balance: number }) {
  const state = balanceState(balance);
  if (state === 'settled') {
    return (
      <span className="text-muted-foreground">
        Settled
        <Urdu className="block">{LEDGER_URDU.settled}</Urdu>
      </span>
    );
  }

  return (
    <span className={cn('font-semibold', state === 'owing' ? 'text-destructive' : 'text-success')}>
      {formatPKR(Math.abs(balance))}
      <span className="block text-xs font-normal text-muted-foreground">
        {state === 'owing' ? 'owed' : 'in credit'}
        <Urdu className="ml-1">
          {state === 'owing' ? LEDGER_URDU.owes : LEDGER_URDU.inCredit}
        </Urdu>
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
          <Urdu className="text-lg">{LEDGER_URDU.ledger}</Urdu>
        </h1>
        <p className="text-sm text-muted-foreground">
          What each customer owes, and what they have paid.
        </p>
        <p className="text-xs text-muted-foreground">
          An account opens by itself the first time a customer is weighed.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">
              Total owed to you
              <Urdu className="ml-2">{LEDGER_URDU.totalOwed}</Urdu>
            </p>
            {summary.isLoading ? (
              <Skeleton className="mt-2 h-8 w-32" />
            ) : (
              <p className="tabular mt-1 text-2xl font-bold text-destructive">
                {formatPKR(summary.data?.total_receivable_pkr ?? 0)}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              across {summary.data?.customers_owing ?? 0} customer
              {summary.data?.customers_owing === 1 ? '' : 's'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">
              Held in advance
              <Urdu className="ml-2">{LEDGER_URDU.heldInAdvance}</Urdu>
            </p>
            {summary.isLoading ? (
              <Skeleton className="mt-2 h-8 w-32" />
            ) : (
              <p className="tabular mt-1 text-2xl font-bold text-success">
                {formatPKR(summary.data?.total_advance_pkr ?? 0)}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              across {summary.data?.customers_in_credit ?? 0} customer
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
                  <Urdu className="ml-1.5">{tab.urdu}</Urdu>
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
                      <Urdu className="ml-1.5">{LEDGER_URDU.id}</Urdu>
                    </TableHead>
                    <TableHead>
                      Customer
                      <Urdu className="ml-1.5">{LEDGER_URDU.customer}</Urdu>
                    </TableHead>
                    <TableHead className="text-right">
                      Charged
                      <Urdu className="ml-1.5">{LEDGER_URDU.charged}</Urdu>
                    </TableHead>
                    <TableHead className="text-right">
                      Paid
                      <Urdu className="ml-1.5">{LEDGER_URDU.paid}</Urdu>
                    </TableHead>
                    <TableHead className="text-right">
                      Balance
                      <Urdu className="ml-1.5">{LEDGER_URDU.balance}</Urdu>
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
                <Urdu className="ml-1">{LEDGER_URDU.nothingYet}</Urdu>
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
