/**
 * Stable-weight capture (brief §7.1).
 *
 * The operator captures a *frozen snapshot*, never "whatever is streaming when
 * the form is submitted". Three paths in:
 *   - indicator reports stable  → one click captures
 *   - indicator reports nothing → capture, then confirm the exact number
 *   - indicator reports unstable or is silent → capture blocked; manual entry
 *     is always offered instead and is flagged in the record and audit log
 */

import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  NumberInput,
  toast,
} from '@suarza/ui';
import { formatKg } from '@suarza/shared';
import { Camera, Check, Keyboard, RotateCcw, X } from 'lucide-react';
import type { LiveWeightResult } from '../hooks/use-live-weight.js';
import { canCapture, requiresConfirmation } from '../lib/indicator-state.js';
import { useHotkeys } from '../hooks/use-hotkeys.js';
import { HOTKEYS } from '../lib/constants.js';

export interface CapturedWeight {
  kg: number;
  source: 'SERIAL' | 'MANUAL';
}

interface WeightCaptureProps {
  live: LiveWeightResult;
  captured: CapturedWeight | null;
  onCapture: (captured: CapturedWeight) => void;
  onClear: () => void;
  /** Which pass this capture belongs to — drives the wording only. */
  pass?: 'first' | 'second';
}

type Mode = 'idle' | 'confirming' | 'manual';

export function WeightCapture({
  live,
  captured,
  onCapture,
  onClear,
  pass = 'first',
}: WeightCaptureProps) {
  const passLabel = pass === 'first' ? 'First' : 'Second';
  const [mode, setMode] = useState<Mode>('idle');
  const [pendingKg, setPendingKg] = useState(0);
  const [manualValue, setManualValue] = useState('');

  const captureAllowed = canCapture(live.state);

  const handleCapture = () => {
    if (!captureAllowed) {
      toast.error('Cannot capture right now', {
        description:
          live.state === 'UNSTABLE'
            ? 'The reading has not settled. Wait, or enter the weight manually.'
            : 'No reading from the indicator. Enter the weight manually.',
      });
      return;
    }

    // Frozen here, at the moment of the click — not read again later.
    const snapshot = live.weightKg;

    if (requiresConfirmation(live.state)) {
      setPendingKg(snapshot);
      setMode('confirming');
      return;
    }

    onCapture({ kg: snapshot, source: 'SERIAL' });
    toast.success(`Captured ${formatKg(snapshot)}`);
  };

  useHotkeys({ [HOTKEYS.capture]: handleCapture }, mode === 'idle' && !captured);

  const confirmPending = () => {
    onCapture({ kg: pendingKg, source: 'SERIAL' });
    setMode('idle');
    toast.success(`Captured ${formatKg(pendingKg)}`);
  };

  const applyManual = () => {
    const kg = Number.parseFloat(manualValue);
    if (!Number.isFinite(kg) || kg < 0) {
      toast.error('Enter a valid weight in kilograms');
      return;
    }
    onCapture({ kg, source: 'MANUAL' });
    setMode('idle');
    setManualValue('');
    // Said out loud because it is permanent: manual weights are flagged on the
    // record and written to the audit log (brief §7.5).
    toast.warning(`Manual weight ${formatKg(kg)} recorded`, {
      description: 'Manually entered weights are flagged on the receipt and in the audit log.',
    });
  };

  const reset = () => {
    onClear();
    setMode('idle');
    setManualValue('');
  };

  if (captured) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{passLabel} weight captured</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-baseline gap-3">
            <span className="tabular text-4xl font-bold">{formatKg(captured.kg)}</span>
            {captured.source === 'MANUAL' && <Badge variant="warning">Manual entry</Badge>}
          </div>
          <Button variant="outline" onClick={reset} className="w-full">
            <RotateCcw />
            Capture again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (mode === 'confirming') {
    return (
      <Card className="border-warning">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Confirm this weight</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This indicator does not report whether the reading has settled. Check the display and
            confirm.
          </p>
          <div className="tabular text-4xl font-bold">{formatKg(pendingKg)}</div>
          <div className="flex gap-2">
            <Button onClick={confirmPending} className="flex-1">
              <Check />
              Confirm
            </Button>
            <Button variant="outline" onClick={() => setMode('idle')} className="flex-1">
              <X />
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (mode === 'manual') {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Enter weight manually</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="manual-weight">Weight in kilograms</Label>
            <NumberInput
              id="manual-weight"
              autoFocus
              value={manualValue}
              min={0}
              step="1"
              placeholder="0"
              onChange={(event) => setManualValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applyManual();
                }
              }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            This will be flagged as a manual reading on the record and in the audit log.
          </p>
          <div className="flex gap-2">
            <Button onClick={applyManual} className="flex-1">
              <Check />
              Use this weight
            </Button>
            <Button variant="outline" onClick={() => setMode('idle')} className="flex-1">
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Capture {pass} weight</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button size="xl" className="w-full" onClick={handleCapture} disabled={!captureAllowed}>
          <Camera />
          Capture weight
          <kbd className="ml-1 rounded bg-primary-foreground/20 px-1.5 py-0.5 text-xs font-medium">
            {HOTKEYS.capture}
          </kbd>
        </Button>

        {/* Never hidden behind a failure: the indicator being down is exactly
            when the operator needs this, and hunting for it costs time they
            do not have with a truck on the bridge. */}
        <Button variant="outline" className="w-full" onClick={() => setMode('manual')}>
          <Keyboard />
          Enter manually
        </Button>
      </CardContent>
    </Card>
  );
}
