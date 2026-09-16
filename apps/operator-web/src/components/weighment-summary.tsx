/**
 * The fetched record's details.
 *
 * Identity fields are read-only here (brief §3 step 7): who the customer is and
 * which truck this is were settled at pass 1, and the printed slip in the
 * driver's hand is the evidence. Changing them at pass 2 would quietly make the
 * paper and the database disagree.
 */

import { Badge, Card, CardContent, CardHeader, CardTitle } from '@suarza/ui';
import {
  formatDateTimePkt,
  formatKg,
  vehicleTypeLabel,
  type Weighment,
  type WeighmentStatus,
} from '@suarza/shared';
import { Lock } from 'lucide-react';

const STATUS_VARIANT: Record<WeighmentStatus, 'secondary' | 'success' | 'destructive'> = {
  OPEN: 'secondary',
  COMPLETED: 'success',
  VOID: 'destructive',
};

export function WeighmentSummary({ weighment }: { weighment: Weighment }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="tabular text-2xl">{weighment.slip_number}</CardTitle>
          <Badge variant={STATUS_VARIANT[weighment.status]}>{weighment.status}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Detail label="Customer" value={weighment.customer_name} />
          <Detail label="Company" value={weighment.customer_company || '—'} />
          <Detail
            label="Vehicle"
            value={`${vehicleTypeLabel(weighment.vehicle_type, weighment.vehicle_type_label)} · ${weighment.vehicle_plate}`}
          />
          <Detail label="Product" value={weighment.product || '—'} />
          {weighment.container_number && (
            <Detail label="Container" value={weighment.container_number} />
          )}
          {weighment.customer_phone && <Detail label="Phone" value={weighment.customer_phone} />}
          <Detail
            label="First weight"
            value={
              <span className="flex items-center gap-2">
                <span className="tabular font-semibold">{formatKg(weighment.first_weight_kg)}</span>
                {weighment.first_weight_src === 'MANUAL' && <Badge variant="warning">Manual</Badge>}
              </span>
            }
          />
          <Detail label="First weighed" value={formatDateTimePkt(weighment.first_weight_at)} />

          {weighment.second_weight_kg !== null && (
            <>
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
              {weighment.second_weight_at && (
                <Detail
                  label="Second weighed"
                  value={formatDateTimePkt(weighment.second_weight_at)}
                />
              )}
            </>
          )}
        </dl>

        {weighment.status === 'VOID' && weighment.void_reason && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <span className="font-medium">Voided:</span> {weighment.void_reason}
          </p>
        )}

        {weighment.status === 'OPEN' && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            These details were set at the first weighing and cannot be changed.
          </p>
        )}
      </CardContent>
    </Card>
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
