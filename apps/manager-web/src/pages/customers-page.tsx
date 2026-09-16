/**
 * Customers, as the manager keeps them.
 *
 * The same people the ledger accounts belong to — one registry, not two, so a
 * customer added here is the one a weighing finds and the one whose balance the
 * ledger shows.
 *
 * Removal is not a delete. Their weighings and their ledger history still point
 * at them, and a weighbridge that has not synced since has no way to learn about
 * a row that simply vanished. Removed customers stop appearing on the operator's
 * picker, and weighing one again brings them back.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
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
  toast,
} from '@suarza/ui';
import { LEDGER_URDU, type CustomerRecord } from '@suarza/shared';
import { Pencil, Search, Trash2, UserPlus } from 'lucide-react';
import { api, ApiError } from '../lib/api.js';
import { CustomerId, Urdu } from '../components/ledger-bits.js';

/** One dialog for adding and editing: the same three fields either way. */
function CustomerDialog({
  customer,
  open,
  onOpenChange,
}: {
  /** Null when adding. */
  customer: CustomerRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const editing = customer !== null;
  const [name, setName] = useState(customer?.name ?? '');
  const [company, setCompany] = useState(customer?.company ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.updateCustomer(customer.id, { name, company, phone: phone || null })
        : api.createCustomer({ name, company, phone: phone || undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      void queryClient.invalidateQueries({ queryKey: ['ledger'] });
      toast.success(editing ? 'Customer updated' : 'Customer added', {
        description: 'Sync on the weighbridge to send it there.',
      });
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(editing ? 'Could not update the customer' : 'Could not add the customer', {
        description: error instanceof ApiError ? error.message : 'Unexpected error.',
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-baseline gap-2">
            {editing ? 'Edit customer' : 'Add a customer'}
            <Urdu className="text-sm">{LEDGER_URDU.customer}</Urdu>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="c-name" className="flex items-baseline gap-2">
              Customer name <Urdu>{LEDGER_URDU.customer}</Urdu>
            </Label>
            <Input id="c-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-company" className="flex items-baseline gap-2">
              Company <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              <Urdu>{LEDGER_URDU.company}</Urdu>
            </Label>
            <Input
              id="c-company"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-phone" className="flex items-baseline gap-2">
              Phone <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              <Urdu>{LEDGER_URDU.phone}</Urdu>
            </Label>
            <Input id="c-phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </div>

          <p className="text-xs text-muted-foreground">
            The name and company must match what the operator types on the weighing form, or the
            weighings will open a second account.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>
            {editing ? 'Save changes' : 'Add customer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({
  customer,
  onClose,
}: {
  customer: CustomerRecord | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: () => api.deleteCustomer(customer!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer removed', {
        description: 'Sync on the weighbridge to remove them there too.',
      });
      onClose();
    },
    onError: (error) =>
      toast.error('Could not remove the customer', {
        description: error instanceof ApiError ? error.message : 'Unexpected error.',
      }),
  });

  return (
    <Dialog open={customer !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove this customer?</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{customer?.name}</span> stops appearing on
          the weighbridge once it syncs. Their past weighings and ledger history stay exactly as they
          are, and weighing them again brings them back.
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CustomersPage() {
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CustomerRecord | null>(null);
  const [removing, setRemoving] = useState<CustomerRecord | null>(null);

  const customers = useQuery({
    queryKey: ['customers', search],
    queryFn: () => api.customers(search || undefined),
  });

  return (
    <div className="mx-auto max-w-[70rem] space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="flex items-baseline gap-2 text-xl font-semibold">
            Customers
            <Urdu className="text-lg">{LEDGER_URDU.customers}</Urdu>
          </h1>
          <p className="text-sm text-muted-foreground">
            Added here or by being weighed — either way, one account each.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <UserPlus className="h-4 w-4" />
          Add a customer
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search customers"
              placeholder="Search by name, company or phone"
              className="pl-8"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
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
                      ID <Urdu>{LEDGER_URDU.id}</Urdu>
                    </TableHead>
                    <TableHead>
                      Customer <Urdu>{LEDGER_URDU.customer}</Urdu>
                    </TableHead>
                    <TableHead>
                      Phone <Urdu>{LEDGER_URDU.phone}</Urdu>
                    </TableHead>
                    <TableHead className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.data.customers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <CustomerId id={customer.id} />
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{customer.name}</p>
                        {customer.company && (
                          <p className="text-xs text-muted-foreground">{customer.company}</p>
                        )}
                      </TableCell>
                      <TableCell className="tabular text-sm text-muted-foreground">
                        {customer.phone ?? '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${customer.name}`}
                          onClick={() => setEditing(customer)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${customer.name}`}
                          onClick={() => setRemoving(customer)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="py-10 text-center">
              <p className="text-sm font-medium">No customers here</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {search ? 'Nothing matches that search.' : 'Add one, or weigh a truck.'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Changes reach a weighbridge when its operator presses sync in Settings — nothing is pushed,
        so a list never changes under someone mid-weighing.
      </p>

      {/* Keyed so the fields re-seed from whichever customer is being edited. */}
      <CustomerDialog
        key={editing?.id ?? 'new'}
        customer={editing}
        open={adding || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAdding(false);
            setEditing(null);
          }
        }}
      />
      <RemoveDialog customer={removing} onClose={() => setRemoving(null)} />
    </div>
  );
}
