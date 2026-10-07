/**
 * The persistent live-weight panel (brief §9): large, always visible, with the
 * indicator's state next to the number so the operator never has to wonder
 * whether what they are looking at is current.
 *
 * Stripped back to the number. The label, the stability hint and the row of
 * reassurances along the bottom — "Cloud connected", "Everything synced",
 * "Weighing works offline" — all said something true and none of it changed
 * what the operator does, while costing the readout a third of the panel.
 *
 * What survives is only what is WRONG: a refused record, an indicator fault,
 * a queue that is not draining. Those show up when they happen and take no
 * room when they do not.
 */

import { Badge, Card, cn } from '@suarza/ui';
import { formatKg } from '@suarza/shared';
import { TriangleAlert } from 'lucide-react';
import type { LiveWeightResult } from '../hooks/use-live-weight.js';
import { presentIndicatorState } from '../lib/indicator-state.js';

interface LiveWeightPanelProps {
  live: LiveWeightResult;
  /** Shown only while it is non-zero; silence means the outbox is empty. */
  pendingSyncCount: number;
  /** Records the cloud permanently refused; they are NOT in pendingSyncCount. */
  blockedSyncCount: number;
}

export function LiveWeightPanel({
  live,
  pendingSyncCount,
  blockedSyncCount,
}: LiveWeightPanelProps) {
  const presentation = presentIndicatorState(live.state);
  const signalLost = live.state === 'AGENT_DOWN' || live.state === 'DISCONNECTED';

  return (
    <Card className="relative overflow-hidden">
      {/* Floated over the number rather than given a row of its own, so the
          readout starts at the top of the card. Still says whether the
          reading has settled, which is the one thing that decides whether
          the capture button will accept it. */}
      <div className="absolute right-3 top-3 z-10 flex flex-wrap items-center justify-end gap-2">
        {live.simulated && (
          // Loud on purpose: nobody should ever mistake a simulated run for
          // a real weighing, least of all during on-site training.
          <Badge variant="warning">Simulator</Badge>
        )}
        <Badge variant={presentation.tone}>{presentation.label}</Badge>
      </div>

      <div className="flex flex-col gap-3 px-6 py-5">
        <div
          className={cn(
            'tabular text-weight transition-colors',
            signalLost ? 'text-muted-foreground/40' : 'text-foreground',
          )}
          // Announced politely so a screen reader isn't interrupted every 300ms.
          aria-live="polite"
          aria-atomic="true"
        >
          {signalLost ? '—' : formatKg(live.weightKg)}
        </div>

        {live.indicatorError && <p className="text-sm text-destructive">{live.indicatorError}</p>}

        {/* Only while the outbox has something in it. "Everything synced" was
            a line of text that said nothing was happening. */}
        {pendingSyncCount > 0 && (
          <p className="text-sm text-muted-foreground">{pendingSyncCount} waiting to sync</p>
        )}

        {/* A refused record is out of the retry loop, so nothing else on this
            screen would ever mention it again. Silence here would read as
            "all well" while a weighing sat on this PC alone. */}
        {blockedSyncCount > 0 && (
          <p className="flex items-center gap-2 text-sm font-medium text-destructive">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            {blockedSyncCount} record{blockedSyncCount === 1 ? '' : 's'} the cloud refused
          </p>
        )}
      </div>
    </Card>
  );
}
