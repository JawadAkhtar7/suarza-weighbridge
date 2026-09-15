/**
 * The persistent live-weight panel (brief §9): large, always visible, with the
 * indicator's state next to the number so the operator never has to wonder
 * whether what they are looking at is current.
 */

import { Badge, Card, cn } from '@suarza/ui';
import { formatKg } from '@suarza/shared';
import { Activity, CloudOff, Cloud, TriangleAlert, WifiOff } from 'lucide-react';
import type { LiveWeightResult } from '../hooks/use-live-weight.js';
import { presentIndicatorState } from '../lib/indicator-state.js';

interface LiveWeightPanelProps {
  live: LiveWeightResult;
  pendingSyncCount: number;
  online: boolean;
}

export function LiveWeightPanel({ live, pendingSyncCount, online }: LiveWeightPanelProps) {
  const presentation = presentIndicatorState(live.state);
  const signalLost = live.state === 'AGENT_DOWN' || live.state === 'DISCONNECTED';

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Activity className="h-4 w-4" />
            Live weight
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {live.simulated && (
              // Loud on purpose: nobody should ever mistake a simulated run for
              // a real weighing, least of all during on-site training.
              <Badge variant="warning">Simulator</Badge>
            )}
            <Badge variant={presentation.tone}>{presentation.label}</Badge>
          </div>
        </div>

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

        {presentation.hint && (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{presentation.hint}</span>
          </p>
        )}

        {live.indicatorError && <p className="text-sm text-destructive">{live.indicatorError}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t bg-muted/40 px-6 py-3 text-sm">
        <span className="flex items-center gap-2">
          {online ? (
            <Cloud className="h-4 w-4 text-success" />
          ) : (
            <CloudOff className="h-4 w-4 text-muted-foreground" />
          )}
          {online ? 'Cloud connected' : 'Cloud offline'}
        </span>

        <span className="flex items-center gap-2 text-muted-foreground">
          {pendingSyncCount > 0 ? (
            <>
              <WifiOff className="h-4 w-4" />
              {pendingSyncCount} waiting to sync
            </>
          ) : (
            'Everything synced'
          )}
        </span>

        {/* Said plainly, because it is the single most reassuring fact on the
            screen when the internet is down and the operator is wondering
            whether to keep weighing. */}
        <span className="ml-auto text-xs text-muted-foreground">
          Weighing works offline — records sync when the connection returns.
        </span>
      </div>
    </Card>
  );
}
