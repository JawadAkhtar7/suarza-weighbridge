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
  netWeightAllUnits,
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
  return (
    <div className="space-y-4">
      <Card className="border-success">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-success">
            <CircleCheck className="h-5 w-5" />
            First weight saved
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="rounded-lg border bg-muted/40 p-6 text-center">
            <p className="text-sm font-medium text-muted-foreground">Slip number</p>
            <p className="tabular mt-1 text-5xl font-bold tracking-tight">
              {weighment.slip_number}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              The driver needs this to complete the second weighing.
            </p>
          </div>

          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Detail label="Customer" value={weighment.customer_name} />
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
            <Detail label="Amount" value={formatPKR(weighment.amount_charged)} />
            <Detail label="Time" value={formatDateTimePkt(weighment.first_weight_at)} />
            <Detail label="Status" value={<Badge variant="secondary">{weighment.status}</Badge>} />
          </dl>

          <Button size="xl" className="w-full" onClick={onNext} autoFocus>
            <Plus />
            Start next weighing
          </Button>
        </CardContent>
      </Card>

      {/* Receipt #1 of the two printed per transaction (brief §3). */}
      <ReceiptPanel
        weighment={weighment}
        net={netWeightAllUnits(weighment.first_weight_kg, null)}
        variant="FIRST"
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
