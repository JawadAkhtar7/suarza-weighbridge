/**
 * Net weight in all three units (brief §2, §7.2).
 *
 * kg leads because that is what the indicator reports and what the net is
 * computed in; ton and maund are conversions of it. Maund is here because it is
 * how the trade actually talks about a load locally — 1 maund = 40 kg.
 */

import { Card, CardContent } from '@suarza/ui';
import { formatKg, formatMaund, formatTon, type NetWeight } from '@suarza/shared';

interface NetWeightDisplayProps {
  net: NetWeight;
  /** Dimmed until the second weight is captured — there is no net yet. */
  pending?: boolean;
}

export function NetWeightDisplay({ net, pending = false }: NetWeightDisplayProps) {
  return (
    <Card className={pending ? 'border-dashed' : 'border-primary'}>
      <CardContent className="space-y-3 p-6">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Net weight
        </p>

        {pending ? (
          <p className="text-2xl font-medium text-muted-foreground">Capture the second weight</p>
        ) : (
          <>
            <p className="tabular text-5xl font-bold leading-none">{formatKg(net.kg)}</p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-lg">
              <span className="tabular font-semibold">{formatTon(net.ton)}</span>
              <span className="tabular font-semibold">{formatMaund(net.maund)}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
