/**
 * The rate card: what the operator can choose, and what each one charges.
 *
 * Kept here rather than on the weighbridge so every bridge quotes the same
 * price, and so a rate change does not mean walking to a cabin. Each bridge
 * pulls a copy and works from that, which is what keeps it pricing with the
 * line down.
 *
 * Two rules the screen is built around, both about not breaking history:
 *
 *  - the KEY behind a type never changes, so renaming "Mazda" to "Shehzore"
 *    keeps every slip already weighed as a Mazda pointing at this same type
 *  - removing a type hides it from the operator but leaves old records alone
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
  NumberInput,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@suarza/ui';
import { formatPKR, vehicleTypeKey, type VehicleTypeRecord } from '@suarza/shared';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../lib/api.js';

function TypeDialog({
  type,
  open,
  onOpenChange,
}: {
  /** Null when adding. */
  type: VehicleTypeRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const editing = type !== null;
  const [label, setLabel] = useState(type?.label ?? '');
  const [rate, setRate] = useState(String(type?.rate_pkr ?? 0));
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: () => {
      const body = { label, rate_pkr: Number(rate) };
      return editing ? api.updateVehicleType(type.id, body) : api.createVehicleType(body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicle-types'] });
      toast.success(editing ? 'Vehicle type updated' : 'Vehicle type added', {
        description: 'Sync on the weighbridge to send it there.',
      });
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error('Could not save the vehicle type', {
        description: error instanceof ApiError ? error.message : 'Unexpected error.',
      }),
  });

  const rateValue = Number(rate);
  const valid = label.trim().length > 0 && Number.isFinite(rateValue) && rateValue >= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit vehicle type' : 'Add a vehicle type'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="vt-label">Name</Label>
            <Input
              id="vt-label"
              value={label}
              placeholder="e.g. Shehzore"
              onChange={(event) => setLabel(event.target.value)}
            />
            {editing ? (
              <p className="text-xs text-muted-foreground">
                Saved against <code>{type.key}</code>, which does not change — slips already weighed
                as this type keep working.
              </p>
            ) : (
              label.trim() && (
                <p className="text-xs text-muted-foreground">
                  Will be saved as <code>{vehicleTypeKey(label) || '—'}</code>, permanently.
                </p>
              )
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="vt-rate">Rate (Rs)</Label>
            <NumberInput
              id="vt-rate"
              min={0}
              step="1"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Fills in the amount when the operator picks this type. Zero means they type it in.
              They can always change it on the form.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!valid || save.isPending}>
            {editing ? 'Save changes' : 'Add type'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({ type, onClose }: { type: VehicleTypeRecord | null; onClose: () => void }) {
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: () => api.deleteVehicleType(type!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicle-types'] });
      toast.success('Vehicle type removed', {
        description: 'Sync on the weighbridge to remove it there too.',
      });
      onClose();
    },
    onError: (error) =>
      toast.error('Could not remove the vehicle type', {
        description: error instanceof ApiError ? error.message : 'Unexpected error.',
      }),
  });

  return (
    <Dialog open={type !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove this vehicle type?</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{type?.label}</span> stops appearing on the
          weighbridge once it syncs. Slips already weighed as this type keep their name and their
          amount exactly as printed.
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

export function VehicleTypesPage() {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<VehicleTypeRecord | null>(null);
  const [removing, setRemoving] = useState<VehicleTypeRecord | null>(null);

  const types = useQuery({ queryKey: ['vehicle-types'], queryFn: api.vehicleTypes });

  return (
    <div className="mx-auto max-w-[62rem] space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Vehicle types</h1>
          <p className="text-sm text-muted-foreground">
            What the operator can choose, and what each one charges.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" />
          Add a type
        </Button>
      </div>

      <Card>
        <CardContent className="p-5">
          {types.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((row) => (
                <Skeleton key={row} className="h-11 w-full" />
              ))}
            </div>
          ) : types.data && types.data.vehicle_types.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {types.data.vehicle_types.map((type) => (
                    <TableRow key={type.id}>
                      <TableCell className="font-medium">{type.label}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{type.key}</TableCell>
                      <TableCell className="tabular text-right">
                        {type.rate_pkr > 0 ? (
                          formatPKR(type.rate_pkr)
                        ) : (
                          <span className="text-muted-foreground">Operator types it</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${type.label}`}
                          onClick={() => setEditing(type)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${type.label}`}
                          onClick={() => setRemoving(type)}
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
              <p className="text-sm font-medium">No vehicle types yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add one so the operator has something to choose.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Changes reach a weighbridge when its operator presses sync in Settings. Until then it keeps
        quoting the rates it already has, which is what lets it work offline.
      </p>

      {/* Keyed so the fields re-seed from whichever type is being edited. */}
      <TypeDialog
        key={editing?.id ?? 'new'}
        type={editing}
        open={adding || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAdding(false);
            setEditing(null);
          }
        }}
      />
      <RemoveDialog type={removing} onClose={() => setRemoving(null)} />
    </div>
  );
}
