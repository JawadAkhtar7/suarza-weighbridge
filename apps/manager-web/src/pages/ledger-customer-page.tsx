/**
 * One customer's account: the balance, and every entry that made it.
 *
 * Laid out as a statement — oldest first, running balance down the right — so
 * it can be read aloud to a customer who disputes a figure. That is the actual
 * use: the manager needs to point at a line and say where the number came from.
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
  NumberInput,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  cn,
  toast,
} from '@suarza/ui';
import {
  LEDGER_KIND_LABELS,
  balanceLabel,
  balanceState,
  formatDateTimePkt,
  formatPKR,
  type LedgerDirection,
  type LedgerEntryWithBalance,
} from '@suarza/shared';
import { ArrowLeft, Ban, Banknote, SlidersHorizontal } from 'lucide-react';
import { api, ApiError } from '../lib/api.js';

/**
 * The one dialog for both manual entries.
 *
 * A payment and an adjustment ask for the same four things; two dialogs would
 * have been the same form twice, drifting apart on the next change.
 */
function EntryDialog({
  customerId,
  mode,
  open,
  onOpenChange,
}: {
  customerId: string;
  mode: 'payment' | 'adjustment';
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isPayment = mode === 'payment';
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [direction, setDirection] = useState<LedgerDirection>('DEBIT');
  const queryClient = useQueryClient();

  const close = () => {
    onOpenChange(false);
    setAmount('');
    setNote('');
    setDirection('DEBIT');
  };

  const add = useMutation({
    mutationFn: () =>
      api.addLedgerEntry(customerId, {
        // A payment is always a credit; only an adjustment can go either way.
        direction: isPayment ? 'CREDIT' : direction,
        kind: isPayment ? 'PAYMENT' : 'ADJUSTMENT',
        amount_pkr: Number(amount),
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ledger'] });
      toast.success(isPayment ? 'Payment recorded' : 'Adjustment recorded');
      close();
    },
    onError: (error) =>
      toast.error('Could not save the entry', {
        description: error instanceof ApiError ? error.message : 'Unexpected error.',
      }),
  });

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isPayment ? 'Record a payment' : 'Add an adjustment'}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {isPayment
            ? 'Money received from the customer. This reduces what they owe.'
            : 'A correction — a discount, a write-off, or a charge that was missed.'}
        </p>

        <div className="space-y-3">
          {!isPayment && (
            <div className="space-y-2">
              <Label>Which way?</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDirection('DEBIT')}
                  className={cn(
                    'rounded-md border-2 px-3 py-2 text-left text-sm transition-colors',
                    direction === 'DEBIT' ? 'border-destructive bg-destructive/5' : 'border-muted',
                  )}
                >
                  <span className="font-semibold">Charge</span>
                  <span className="block text-xs text-muted-foreground">
                    Customer owes more
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setDirection('CREDIT')}
                  className={cn(
                    'rounded-md border-2 px-3 py-2 text-left text-sm transition-colors',
                    direction === 'CREDIT' ? 'border-success bg-success/5' : 'border-muted',
                  )}
                >
                  <span className="font-semibold">Credit</span>
                  <span className="block text-xs text-muted-foreground">Customer owes less</span>
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="entry-amount">Amount (Rs)</Label>
            <NumberInput
              id="entry-amount"
              min={0}
              step="1"
              autoFocus
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="entry-note">
              Note <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="entry-note"
              rows={2}
              placeholder={isPayment ? 'e.g. cash, received by Imran' : 'e.g. discount agreed'}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={() => add.mutate()} disabled={!valid || add.isPending}>
            {isPayment ? 'Record payment' : 'Save adjustment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({
  customerId,
  entry,
  onClose,
}: {
  customerId: string;
  entry: LedgerEntryWithBalance | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const queryClient = useQueryClient();

  const voidIt = useMutation({
    mutationFn: () => api.voidLedgerEntry(customerId, entry!.id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ledger'] });
      toast.success('Entry voided');
      setReason('');
      onClose();
    },
    onError: (error) =>
      toast.error('Could not void the entry', {
        description: error instanceof ApiError ? error.message : 'Unexpected error.',
      }),
  });

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void this entry</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          The entry stays in the history, marked as voided, and stops counting towards the balance.
          Nothing is deleted.
        </p>

        {entry && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <span className="font-medium">{LEDGER_KIND_LABELS[entry.kind]}</span> ·{' '}
            {formatPKR(entry.amount_pkr)} · {formatDateTimePkt(entry.at)}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="void-reason">Reason</Label>
          <Input
            id="void-reason"
            autoFocus
            placeholder="e.g. entered twice"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => voidIt.mutate()}
            disabled={!reason.trim() || voidIt.isPending}
          >
            Void entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LedgerCustomerPage() {
  const { customerId = '' } = useParams();
  const [dialog, setDialog] = useState<'payment' | 'adjustment' | null>(null);
  const [voiding, setVoiding] = useState<LedgerEntryWithBalance | null>(null);

  const account = useQuery({
    queryKey: ['ledger', 'customer', customerId],
    queryFn: () => api.ledgerCustomer(customerId),
  });

  if (account.isLoading) {
    return (
      <div className="mx-auto max-w-[70rem] space-y-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (account.isError || !account.data) {
    return (
      <div className="mx-auto max-w-md rounded-lg border bg-background p-8 text-center">
        <p className="font-medium">That account could not be loaded</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {account.error instanceof ApiError ? account.error.message : 'Unexpected error.'}
        </p>
        <Button variant="outline" className="mt-4" asChild>
          <Link to="/ledger">Back to the ledger</Link>
        </Button>
      </div>
    );
  }

  const { customer, entries } = account.data;
  const state = balanceState(customer.balance_pkr);

  return (
    <div className="mx-auto max-w-[70rem] space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to="/ledger">
            <ArrowLeft className="h-4 w-4" />
            Ledger
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 p-5">
          <div className="mr-auto min-w-0">
            <h1 className="truncate text-xl font-semibold">{customer.name}</h1>
            <p className="truncate text-sm text-muted-foreground">
              {customer.company || 'No company'}
              {customer.phone ? ` · ${customer.phone}` : ''}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {balanceLabel(customer.balance_pkr)}
            </p>
            <p
              className={cn(
                'tabular text-3xl font-bold leading-tight',
                state === 'owing' && 'text-destructive',
                state === 'credit' && 'text-success',
              )}
            >
              {formatPKR(Math.abs(customer.balance_pkr))}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setDialog('payment')}>
              <Banknote className="h-4 w-4" />
              Record payment
            </Button>
            <Button variant="outline" onClick={() => setDialog('adjustment')}>
              <SlidersHorizontal className="h-4 w-4" />
              Adjustment
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Charged for weighings</p>
            <p className="tabular mt-1 text-lg font-semibold">
              {formatPKR(customer.total_charged_pkr)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Paid</p>
            <p className="tabular mt-1 text-lg font-semibold">
              {formatPKR(customer.total_paid_pkr)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Entries</p>
            <p className="tabular mt-1 text-lg font-semibold">{customer.entry_count}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5">
          <h2 className="mb-3 text-sm font-semibold">Statement</h2>

          {entries.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium">Nothing on this account yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Charges appear as weighings are completed.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id} className={cn(entry.voided && 'opacity-50')}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatDateTimePkt(entry.at)}
                      </TableCell>

                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{LEDGER_KIND_LABELS[entry.kind]}</span>
                          {entry.slip_number && (
                            <Badge variant="secondary" className="tabular">
                              {entry.slip_number}
                            </Badge>
                          )}
                          {entry.voided && <Badge variant="destructive">Voided</Badge>}
                        </div>
                        {entry.note && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{entry.note}</p>
                        )}
                        {entry.voided && entry.void_reason && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Voided: {entry.void_reason}
                          </p>
                        )}
                      </TableCell>

                      <TableCell className="tabular text-right">
                        {entry.direction === 'DEBIT' ? formatPKR(entry.amount_pkr) : ''}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {entry.direction === 'CREDIT' ? formatPKR(entry.amount_pkr) : ''}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'tabular text-right font-medium',
                          entry.balance_after_pkr < 0 && 'text-destructive',
                        )}
                      >
                        {formatPKR(Math.abs(entry.balance_after_pkr))}
                        {entry.balance_after_pkr < 0 && (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            owed
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {/* A weighing charge is only voidable by voiding the
                            slip itself, so it offers no button here. */}
                        {!entry.voided && entry.kind !== 'WEIGHING' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Void entry"
                            onClick={() => setVoiding(entry)}
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <EntryDialog
        customerId={customerId}
        mode={dialog ?? 'payment'}
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
      />
      <VoidDialog customerId={customerId} entry={voiding} onClose={() => setVoiding(null)} />
    </div>
  );
}
