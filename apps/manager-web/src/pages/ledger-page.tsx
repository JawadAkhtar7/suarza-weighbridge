/**
 * Ledger — every customer account, worst first.
 *
 * The question this page answers is "who owes us money", so that is the default
 * sort and the first thing on the screen. Everything else is secondary.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  toast,
} from '@suarza/ui';
import { balanceState, formatPKR, type LedgerQuery } from '@suarza/shared';
import { Search, UserPlus } from 'lucide-react';
import { api, ApiError } from '../lib/api.js';

const STATUS_TABS: { key: LedgerQuery['status']; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'owing', label: 'Owing' },
  { key: 'credit', label: 'In credit' },
  { key: 'settled', label: 'Settled' },
];

/** Rs 1,200 — never a bare negative number, which reads as an error. */
function BalanceCell({ balance }: { balance: number }) {
  const state = balanceState(balance);
  if (state === 'settled') return <span className="text-muted-foreground">Settled</span>;

  return (
    <span className={cn('font-semibold', state === 'owing' ? 'text-destructive' : 'text-success')}>
      {formatPKR(Math.abs(balance))}
      <span className="ml-1 text-xs font-normal text-muted-foreground">
        {state === 'owing' ? 'owed' : 'in credit'}
      </span>
    </span>
  );
}

function NewAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: () => api.createLedgerCustomer({ name, company, phone: phone || undefined }),
    onSuccess: ({ customer }) => {
      void queryClient.invalidateQueries({ queryKey: ['ledger'] });
      onOpenChange(false);
      setName('');
      setCompany('');
      setPhone('');
      navigate(`/ledger/${encodeURIComponent(customer.id)}`);
    },
    onError: (error) =>
      toast.error('Could not open the account', {
        description: error instanceof ApiError ? error.message : 'Unexpected error.',
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open an account</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Customers get an account automatically the first time they are weighed. Open one by hand
          only to take a payment in advance.
        </p>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="new-name">Customer name</Label>
            <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-company">
              Company <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="new-company" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-phone">
              Phone <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="new-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            The name and company must match what the operator types on the weighing form, or the
            weighings will land in a second account.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
            Open account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LedgerPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<LedgerQuery['status']>('all');
  const [newOpen, setNewOpen] = useState(false);

  const summary = useQuery({ queryKey: ['ledger', 'summary'], queryFn: api.ledgerSummary });

  const customers = useQuery({
    queryKey: ['ledger', 'customers', search, status],
    queryFn: () => api.ledgerCustomers({ q: search || undefined, status, page_size: 200 }),
  });

  return (
    <div className="mx-auto max-w-[80rem] space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Ledger</h1>
          <p className="text-sm text-muted-foreground">
            What each customer owes, and what they have paid.
          </p>
        </div>
        <Button variant="outline" onClick={() => setNewOpen(true)}>
          <UserPlus className="h-4 w-4" />
          Open an account
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Total owed to you</p>
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
            <p className="text-sm text-muted-foreground">Held in advance</p>
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
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Charged</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
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

      <NewAccountDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
