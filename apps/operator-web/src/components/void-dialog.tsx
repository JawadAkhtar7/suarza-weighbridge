/**
 * Voiding an open ticket (brief §3B, §7.6).
 *
 * The common case is a truck that drove in, got weighed, and never came back —
 * the ticket has to be closed out but there is no second weight and no revenue.
 * Nothing is ever deleted: the record stays, the reason is stored, and the
 * whole thing lands in the audit log.
 */

import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
} from '@suarza/ui';
import { Loader2, Ban } from 'lucide-react';

interface VoidDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slipNumber: string;
  onConfirm: (reason: string) => void;
  isPending: boolean;
}

/** Matches the shared voidWeighmentSchema, so the button and the agent agree. */
const MIN_REASON_LENGTH = 3;

export function VoidDialog({
  open,
  onOpenChange,
  slipNumber,
  onConfirm,
  isPending,
}: VoidDialogProps) {
  const [reason, setReason] = useState('');
  const tooShort = reason.trim().length < MIN_REASON_LENGTH;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason('');
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void slip {slipNumber}</DialogTitle>
          <DialogDescription>
            The record is kept and excluded from revenue. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="void-reason">Reason</Label>
          <Textarea
            id="void-reason"
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Truck never returned for the second weighing"
          />
          <p className="text-xs text-muted-foreground">
            This is written to the audit log against your name.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(reason.trim())}
            disabled={tooShort || isPending}
          >
            {isPending ? <Loader2 className="animate-spin" /> : <Ban />}
            Void ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
