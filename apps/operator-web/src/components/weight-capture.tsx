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

import { useRef, useState } from 'react';
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
import { agentApi } from '../lib/api.js';
import { HOTKEYS } from '../lib/constants.js';

export interface CapturedWeight {
  kg: number;
  source: 'SERIAL' | 'MANUAL';
  /**
   * The photographs taken at this moment, waiting for the save to claim them.
   *
   * Null on a station with no cameras, and on the rare occasion the agent
   * could not be asked. Neither stops a weighing: the slip falls back to the
   * placeholder, as it did before any of this existed.
   */
  captureId?: string | null;
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

/**
 * Photograph the bridge at this instant, and come back with the token.
 *
 * Awaited, because the agent answers before the cameras do — it hands back a
 * token and takes the pictures in the background — so this costs a few
 * milliseconds over the loopback and nothing more.
 *
 * Null on any failure at all. A weighing has never depended on a photograph
 * and must not start now: an operator with a truck on the plate and a camera
 * that will not answer needs the weight captured, not an error.
 */
async function photographNow(): Promise<string | null> {
  try {
    return (await agentApi.captureNow()).capture_id;
  } catch {
    return null;
  }
}

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
  /**
   * The photographs taken when Capture was clicked, while this reading is
   * being confirmed.
   *
   * Taken at the click rather than at the confirmation, because the click is
   * when the operator looked at the bridge. Confirming can take several
   * seconds — the whole point of the step is that somebody checks the
   * indicator's own display — and the truck does not wait.
   */
  const pendingCaptureId = useRef<string | null>(null);
  const [manualValue, setManualValue] = useState('');

  const captureAllowed = canCapture(live.state);

  /**
   * Hand the weight up, with its photographs' token once it arrives.
   *
   * The weight goes up FIRST and the token follows a moment later, so the
   * screen never waits on the agent: the operator sees the captured figure
   * immediately, which is what they clicked for.
   */
  const capturePhotographsAnd = async (weight: CapturedWeight) => {
    onCapture(weight);
    const captureId = await photographNow();
    if (captureId) onCapture({ ...weight, captureId });
  };

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
      pendingCaptureId.current = null;
      void photographNow().then((id) => {
        pendingCaptureId.current = id;
      });
      return;
    }

    void capturePhotographsAnd({ kg: snapshot, source: 'SERIAL' });
    toast.success(`Captured ${formatKg(snapshot)}`);
  };

  useHotkeys({ [HOTKEYS.capture]: handleCapture }, mode === 'idle' && !captured);

  const confirmPending = () => {
    /* Already photographed, when Capture was clicked. */
    onCapture({ kg: pendingKg, source: 'SERIAL', captureId: pendingCaptureId.current });
    pendingCaptureId.current = null;
    setMode('idle');
    toast.success(`Captured ${formatKg(pendingKg)}`);
  };

  /** Abandon a reading being confirmed, and the photographs taken with it. */
  const cancelPending = () => {
    const id = pendingCaptureId.current;
    pendingCaptureId.current = null;
    if (id) void agentApi.discardCapture(id).catch(() => undefined);
    setMode('idle');
  };

  const applyManual = () => {
    const kg = Number.parseFloat(manualValue);
    if (!Number.isFinite(kg) || kg < 0) {
      toast.error('Enter a valid weight in kilograms');
      return;
    }
    /* A typed weight is photographed too: the truck is on the bridge either
       way, and which of the two the figure came from is a separate question
       the slip already answers with its MANUAL marker. */
    void capturePhotographsAnd({ kg, source: 'MANUAL' });
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
            <Button variant="brand" onClick={confirmPending} className="flex-1">
              <Check />
              Confirm
            </Button>
            <Button variant="outline" onClick={cancelPending} className="flex-1">
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
            <Label htmlFor="manual-weight" className="sr-only">
              Weight in kilograms
            </Label>
            <NumberInput
              id="manual-weight"
              autoFocus
              value={manualValue}
              min={0}
              step="1"
              placeholder="Weight in kilograms"
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
            <Button variant="brand" onClick={applyManual} className="flex-1">
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
      {/* No heading. "Capture first weight" sat above a button that already
          says Capture weight, on a screen where the pass is chosen by a tab
          two inches away. */}
      <CardContent className="space-y-3 pt-6">
        <Button
          variant="brand"
          size="xl"
          className="w-full"
          onClick={handleCapture}
          disabled={!captureAllowed}
        >
          <Camera />
          Capture weight
          <kbd className="ml-1 rounded bg-brand-foreground/20 px-1.5 py-0.5 text-xs font-medium">
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
