/**
 * Pass 2 — the returning truck (brief §3 Scenario A steps 6-11, §3B edge cases).
 *
 * Every edge case here is a thing that happens on a real weighbridge: the slip
 * is mistyped, the driver brings back a slip that was already completed, the
 * truck never comes back at all. None of them may block the operator — each
 * resolves to a clear next action rather than a dead end.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  NumberInput,
  cn,
  toast,
} from '@suarza/ui';
import {
  formatPKR,
  netWeightAllUnits,
  parseAmount,
  type NetWeight,
  type PaymentStatus,
  type Weighment,
} from '@suarza/shared';
import { Ban, CircleCheck, Loader2, Printer, RotateCcw, Save, TriangleAlert } from 'lucide-react';
import { agentApi, AgentApiError, type WeighmentResponse } from '../lib/api.js';
import { SlipSearch } from './slip-search.js';
import { RecentWeighments } from './recent-weighments.js';
import { WeighmentSummary } from './weighment-summary.js';
import { NetWeightDisplay } from './net-weight-display.js';
import { VoidDialog } from './void-dialog.js';
import { WeightCapture, type CapturedWeight } from './weight-capture.js';
import { ReceiptPanel } from './receipt-panel.js';
import type { LiveWeightResult } from '../hooks/use-live-weight.js';
import { DEFAULT_OPERATOR_USERNAME, HOTKEYS } from '../lib/constants.js';
import { useHotkeys } from '../hooks/use-hotkeys.js';
import { useRefreshSyncStatus } from '../hooks/use-refresh-sync-status.js';

interface ReturnWeighmentProps {
  live: LiveWeightResult;
  captured: CapturedWeight | null;
  onCapture: (captured: CapturedWeight) => void;
  onClearCapture: () => void;
}

export function ReturnWeighment({
  live,
  captured,
  onCapture,
  onClearCapture,
}: ReturnWeighmentProps) {
  const [record, setRecord] = useState<WeighmentResponse | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  // Bumped on every reprint so the receipt panel remounts and prints again —
  // a driver asking for a third copy must not be silently ignored.
  const [reprintNonce, setReprintNonce] = useState(0);
  const refreshSyncStatus = useRefreshSyncStatus();

  // Editable at pass 2. Amount is the one the brief requires (§3 step 10);
  // product and container are here because they are genuinely settled at load
  // time, and the agent already accepts corrections to exactly these two.
  const [amount, setAmount] = useState('0');
  // Defaults to paid: taking the money at the gate is the normal case, and the
  // operator should only have to think about it when it is not.
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('PAID');
  const [product, setProduct] = useState('');
  const [containerNumber, setContainerNumber] = useState('');

  const loadRecord = (response: WeighmentResponse, options: { completed?: boolean } = {}) => {
    setRecord(response);
    setJustCompleted(options.completed ?? false);
    setAmount(String(response.weighment.amount_charged));
    setProduct(response.weighment.product);
    setContainerNumber(response.weighment.container_number ?? '');
    setSearchError(null);
    setReprintNonce(0);
  };

  const reset = () => {
    setRecord(null);
    setJustCompleted(false);
    setSearchError(null);
    setReprintNonce(0);
    onClearCapture();
  };

  const search = useMutation({
    mutationFn: (slip: string) => agentApi.getWeighment(slip),
    onSuccess: (response) => {
      onClearCapture();
      loadRecord(response);
      if (response.weighment.status === 'COMPLETED') {
        toast.warning(`Slip ${response.weighment.slip_number} is already completed`, {
          description: 'You can reprint the receipt instead.',
        });
      }
    },
    onError: (error) => {
      if (error instanceof AgentApiError && error.code === 'SLIP_NOT_FOUND') {
        // A mistyped slip is the single most common thing that goes wrong here.
        // It belongs next to the field, not in a dialog the operator must close.
        setSearchError('No weighment found for that slip number. Check the slip and try again.');
        return;
      }
      const message = error instanceof Error ? error.message : 'Could not fetch the slip.';
      setSearchError(message);
      toast.error(message);
    },
  });

  const complete = useMutation({
    mutationFn: () => {
      if (!record || !captured) throw new Error('Nothing to complete');
      return agentApi.completeWeighment(record.weighment.slip_number, {
        second_weight_kg: captured.kg,
        second_weight_src: captured.source,
        amount_charged: parseAmount(amount),
        payment_status: paymentStatus,
        operator_username: DEFAULT_OPERATOR_USERNAME,
        product: product.trim() || undefined,
        container_number: containerNumber.trim() || undefined,
      });
    },
    onSuccess: (response) => {
      onClearCapture();
      refreshSyncStatus();
      loadRecord(response, { completed: true });
      toast.success(`Completed — slip ${response.weighment.slip_number}`, {
        description: `Net ${response.net.kg.toLocaleString()} kg · ${formatPKR(
          response.weighment.amount_charged,
        )}`,
      });
    },
    onError: async (error) => {
      // Someone finished or voided this ticket between our fetch and our save
      // — a second station, or the same operator in another window. Show them
      // what the record actually is now rather than arguing about it.
      if (
        error instanceof AgentApiError &&
        (error.code === 'ALREADY_COMPLETED' || error.code === 'ALREADY_VOID')
      ) {
        toast.warning(error.message);
        if (record) {
          const fresh = await agentApi.getWeighment(record.weighment.slip_number).catch(() => null);
          if (fresh) loadRecord(fresh);
        }
        return;
      }
      toast.error('Could not complete the weighment', {
        description: error instanceof Error ? error.message : 'Unexpected error.',
      });
    },
  });

  const voidTicket = useMutation({
    mutationFn: (reason: string) => {
      if (!record) throw new Error('Nothing to void');
      return agentApi.voidWeighment(record.weighment.slip_number, {
        reason,
        operator_username: DEFAULT_OPERATOR_USERNAME,
      });
    },
    onSuccess: async (response) => {
      setVoidOpen(false);
      refreshSyncStatus();
      toast.success(`Slip ${response.weighment.slip_number} voided`);
      const fresh = await agentApi.getWeighment(response.weighment.slip_number).catch(() => null);
      if (fresh) loadRecord(fresh);
    },
    onError: (error) => {
      setVoidOpen(false);
      toast.error('Could not void the ticket', {
        description: error instanceof Error ? error.message : 'Unexpected error.',
      });
    },
  });

  const reprint = useMutation({
    mutationFn: (receipt: 'FIRST' | 'SECOND') => {
      if (!record) throw new Error('Nothing to reprint');
      return agentApi.reprintWeighment(record.weighment.slip_number, receipt);
    },
    onSuccess: () => {
      setReprintNonce((n) => n + 1);
      toast.success('Reprint sent to the printer');
    },
    onError: (error) =>
      toast.error('Could not record the reprint', {
        description: error instanceof Error ? error.message : 'Unexpected error.',
      }),
  });

  useHotkeys(
    {
      [HOTKEYS.save]: () => {
        if (record?.weighment.status === 'OPEN' && captured && !complete.isPending) {
          complete.mutate();
        }
      },
      [HOTKEYS.reset]: reset,
    },
    record !== null,
  );

  if (!record) {
    return (
      <div className="space-y-4">
        <SlipSearch
          onSearch={(slip) => search.mutate(slip)}
          isSearching={search.isPending}
          error={searchError}
          onErrorCleared={() => setSearchError(null)}
        />

        {/* Faster and less error-prone than reading a dusty slip and typing
            six digits — and it is how a driver with no slip gets found. */}
        <RecentWeighments onPick={(slip) => search.mutate(slip)} />
      </div>
    );
  }

  const weighment = record.weighment;
  const isOpen = weighment.status === 'OPEN';

  // Previewed live from the captured snapshot, so the operator sees the net
  // before committing rather than discovering it on the printed receipt.
  const net: NetWeight = isOpen
    ? netWeightAllUnits(weighment.first_weight_kg, captured?.kg ?? null)
    : record.net;

  return (
    <div className="space-y-4">
      {justCompleted && <CompletedBanner weighment={weighment} />}

      {weighment.status === 'COMPLETED' && !justCompleted && (
        <Notice
          tone="warning"
          icon={<TriangleAlert className="h-5 w-5" />}
          title="This slip is already completed"
          body="It cannot be weighed again. Reprint the receipt if the driver needs another copy."
        />
      )}

      {weighment.status === 'VOID' && (
        <Notice
          tone="destructive"
          icon={<Ban className="h-5 w-5" />}
          title="This ticket was voided"
          body="Voided tickets are kept for the record and excluded from revenue."
        />
      )}

      <WeighmentSummary weighment={weighment} />

      {isOpen && (
        <>
          <WeightCapture
            live={live}
            captured={captured}
            onCapture={onCapture}
            onClear={onClearCapture}
            pass="second"
          />

          <NetWeightDisplay net={net} pending={!captured} />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Confirm the charge</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="complete-amount">Amount charged</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    Rs
                  </span>
                  <NumberInput
                    id="complete-amount"
                    value={amount}
                    min={0}
                    step="1"
                    onChange={(event) => setAmount(event.target.value)}
                    className="h-12 pl-9 text-lg"
                  />
                </div>
              </div>

              {/* Which way the money went. Asked here because this is the
                  moment the customer is standing at the window — and because
                  without it every weighing looked like an unpaid debt in the
                  manager's ledger. */}
              <div className="space-y-2">
                <Label>Payment</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentStatus('PAID')}
                    className={cn(
                      'rounded-md border-2 px-3 py-3 text-left transition-colors',
                      paymentStatus === 'PAID'
                        ? 'border-primary bg-primary/5'
                        : 'border-muted hover:border-muted-foreground/30',
                    )}
                  >
                    <span className="block text-sm font-semibold">Paid now</span>
                    <span className="block text-xs text-muted-foreground">
                      Customer has paid
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentStatus('ON_ACCOUNT')}
                    className={cn(
                      'rounded-md border-2 px-3 py-3 text-left transition-colors',
                      paymentStatus === 'ON_ACCOUNT'
                        ? 'border-warning bg-warning/5'
                        : 'border-muted hover:border-muted-foreground/30',
                    )}
                  >
                    <span className="block text-sm font-semibold">Add to account</span>
                    <span className="block text-xs text-muted-foreground">
                      Customer will pay later
                    </span>
                  </button>
                </div>
              </div>

              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  Correct product or container number
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="complete-product">Product</Label>
                    <Input
                      id="complete-product"
                      value={product}
                      onChange={(event) => setProduct(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="complete-container">Container number</Label>
                    <Input
                      id="complete-container"
                      value={containerNumber}
                      placeholder="Optional"
                      onChange={(event) => setContainerNumber(event.target.value)}
                    />
                  </div>
                </div>
              </details>
            </CardContent>
          </Card>
        </>
      )}

      {/* Completing is the whole point of this screen, so it gets its own row
          and every other action sits below it. Kept apart also stops the row
          from wrapping into an ambiguous jumble on a narrower display. */}
      {isOpen && (
        <Button
          size="xl"
          className="w-full sm:w-auto"
          onClick={() => complete.mutate()}
          disabled={!captured || complete.isPending}
        >
          {complete.isPending ? <Loader2 className="animate-spin" /> : <Save />}
          Complete weighing
          <kbd className="ml-1 rounded bg-primary-foreground/20 px-1.5 py-0.5 text-xs font-medium">
            {HOTKEYS.save}
          </kbd>
        </Button>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          onClick={() => reprint.mutate(isOpen ? 'FIRST' : 'SECOND')}
          disabled={reprint.isPending}
        >
          <Printer />
          Reprint receipt
        </Button>

        {isOpen && (
          <Button variant="ghost" onClick={() => setVoidOpen(true)}>
            <Ban />
            Void ticket
          </Button>
        )}

        <Button variant="ghost" onClick={reset} className="ml-auto">
          <RotateCcw />
          Another slip
          <kbd className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
            {HOTKEYS.reset}
          </kbd>
        </Button>
      </div>

      {/* Receipt #2 — the full receipt, printed once the weighing completes. */}
      {justCompleted && (
        <ReceiptPanel weighment={weighment} net={record.net} variant="SECOND" autoPrint />
      )}

      {reprintNonce > 0 && (
        <ReceiptPanel
          key={reprintNonce}
          weighment={weighment}
          net={record.net}
          variant={weighment.status === 'COMPLETED' ? 'SECOND' : 'FIRST'}
          autoPrint
        />
      )}

      <VoidDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        slipNumber={weighment.slip_number}
        onConfirm={(reason) => voidTicket.mutate(reason)}
        isPending={voidTicket.isPending}
      />
    </div>
  );
}

function CompletedBanner({ weighment }: { weighment: Weighment }) {
  return (
    <Card className="border-success bg-success/5">
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <CircleCheck className="h-5 w-5 text-success" />
        <span className="font-semibold text-success">Weighing completed</span>
        <Badge variant="secondary" className="tabular">
          {weighment.slip_number}
        </Badge>
        <span className="ml-auto font-semibold">{formatPKR(weighment.amount_charged)}</span>
      </CardContent>
    </Card>
  );
}

interface NoticeProps {
  tone: 'warning' | 'destructive';
  icon: React.ReactNode;
  title: string;
  body: string;
}

const NOTICE_TONES = {
  warning: { card: 'border-warning bg-warning/5', icon: 'text-warning' },
  destructive: { card: 'border-destructive bg-destructive/5', icon: 'text-destructive' },
} as const;

function Notice({ tone, icon, title, body }: NoticeProps) {
  const styles = NOTICE_TONES[tone];
  return (
    <Card className={styles.card}>
      <CardContent className="flex gap-3 p-4">
        <span className={styles.icon}>{icon}</span>
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
      </CardContent>
    </Card>
  );
}
