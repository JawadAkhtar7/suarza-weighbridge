/**
 * Net weight, in kg and Mann (brief §2, §7.2).
 *
 * kg leads because that is what the indicator reports and what the net is
 * computed in. Mann is the conversion the trade actually uses locally —
 * 1 Mann = 40 kg — and it is the only other unit on the printed slip, so it
 * is the only other unit here. Ton was shown too and nobody weighs in it; a
 * third figure to read past is a cost with no reader.
 */

import { Card, CardContent } from '@suarza/ui';
import { formatKg, formatMaund, type NetWeight } from '@suarza/shared';

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
            <p className="tabular text-lg font-semibold">{formatMaund(net.maund)}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
