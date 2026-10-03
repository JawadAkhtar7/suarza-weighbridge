/**
 * Confirmation after pass 1.
 *
 * The slip number is the biggest thing on the screen because it is the one
 * piece of data the whole second pass depends on: the driver carries it back,
 * and the operator types it in to fetch the record.
 */

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@suarza/ui';
import {
  formatDateTimePkt,
  formatKg,
  formatPKR,
  vehicleTypeLabel,
  type Weighment,
} from '@suarza/shared';
import { CircleCheck, Plus } from 'lucide-react';
import { ReceiptPanel } from './receipt-panel.js';

interface SavedWeighmentProps {
  weighment: Weighment;
  onNext: () => void;
}

export function SavedWeighment({ weighment, onNext }: SavedWeighmentProps) {
  /*
   * The one-visit flow lands here too, already finished.
   *
   * Read off the record rather than passed in as a prop: whether a weighing is
   * done is a fact about the weighing, and a screen that has to be told risks
   * being told wrong.
   */
  const isComplete = weighment.status === 'COMPLETED';

  return (
    <div className="space-y-4">
      <Card className="border-success">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-success">
            <CircleCheck className="h-5 w-5" />
            {isComplete ? 'Weighing complete' : 'First weight saved'}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="rounded-lg border bg-muted/40 p-6 text-center">
            <p className="text-sm font-medium text-muted-foreground">Slip number</p>
            <p className="tabular mt-1 text-5xl font-bold tracking-tight">
              {weighment.slip_number}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              {isComplete
                ? 'Nothing further is due on this slip — the driver can go.'
                : 'The driver needs this to complete the second weighing.'}
            </p>
          </div>

          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Detail label="Customer" value={weighment.customer_name || '—'} />
            <Detail label="Company" value={weighment.customer_company || '—'} />
            <Detail
              label="Vehicle"
              value={`${vehicleTypeLabel(weighment.vehicle_type, weighment.vehicle_type_label)} · ${weighment.vehicle_plate}`}
            />
            <Detail label="Product" value={weighment.product || '—'} />
            <Detail
              label="First weight"
              value={
                <span className="flex items-center gap-2">
                  <span className="tabular font-semibold">
                    {formatKg(weighment.first_weight_kg)}
                  </span>
                  {weighment.first_weight_src === 'MANUAL' && (
                    <Badge variant="warning">Manual</Badge>
                  )}
                </span>
              }
            />
            {/* Only once there is one: an open ticket has no second weight
                and no net, and showing "0 kg" would read as a real figure. */}
            {isComplete && weighment.second_weight_kg !== null && (
              <Detail
                label="Second weight"
                value={
                  <span className="flex items-center gap-2">
                    <span className="tabular font-semibold">
                      {formatKg(weighment.second_weight_kg)}
                    </span>
                    {weighment.second_weight_src === 'MANUAL' && (
                      <Badge variant="warning">Manual</Badge>
                    )}
                  </span>
                }
              />
            )}
            {isComplete && (
              <Detail
                label="Net weight"
                value={
                  <span className="tabular font-semibold">{formatKg(weighment.net_weight_kg)}</span>
                }
              />
            )}
            <Detail
              label="Amount"
              value={
                <span className="flex items-center gap-2">
                  {formatPKR(weighment.amount_charged)}
                  {isComplete && (
                    <Badge variant={weighment.payment_status === 'PAID' ? 'success' : 'warning'}>
                      {weighment.payment_status === 'PAID' ? 'Paid' : 'On account'}
                    </Badge>
                  )}
                </span>
              }
            />
            <Detail label="Time" value={formatDateTimePkt(weighment.first_weight_at)} />
            <Detail label="Status" value={<Badge variant="secondary">{weighment.status}</Badge>} />
          </dl>

          <Button size="xl" className="w-full" onClick={onNext} autoFocus>
            <Plus />
            Start next weighing
          </Button>
        </CardContent>
      </Card>

      {/* Receipt #1 of the two printed per transaction (brief §3) — or the
          only one, when the weighing was done in a single visit, which is why
          the "1 of 2" numbering is dropped in that case. */}
      <ReceiptPanel
        weighment={weighment}
        variant={isComplete ? 'SECOND' : 'FIRST'}
        title={isComplete ? 'Weighing receipt' : undefined}
        autoPrint
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
