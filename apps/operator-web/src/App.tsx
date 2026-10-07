/**
 * Operator app shell.
 *
 * Two modes, exactly as the brief describes them (§9): a truck is either
 * arriving for its first weighing or coming back with a slip. The live-weight
 * panel never leaves the screen, so whichever mode is open the operator can
 * always see whether the number they are about to commit is real.
 *
 * Only the active mode is mounted — both modes bind the same function keys, and
 * leaving the inactive one alive would make F9 ambiguous.
 */

import { useCallback, useState } from 'react';
import { Button, ThemeToggle, cn, toast } from '@suarza/ui';
import type { NetWeight, Weighment } from '@suarza/shared';
import { Settings } from 'lucide-react';
import { LiveWeightPanel } from './components/live-weight-panel.js';
import { WeightCapture, type CapturedWeight } from './components/weight-capture.js';
import { NewWeighmentForm } from './components/new-weighment-form.js';
import { SavedWeighment } from './components/saved-weighment.js';
import { ReturnWeighment } from './components/return-weighment.js';
import { NetWeightDisplay } from './components/net-weight-display.js';
import { CameraPanel, useCameras } from './components/camera-panel.js';
import { SettingsPanel } from './components/settings-panel.js';
import { ModeSwitch, type WeighingMode } from './components/mode-switch.js';
import { useLiveWeight, useSyncStatus } from './hooks/use-live-weight.js';
import type { AgentWarning } from './lib/api.js';

export function App() {
  const live = useLiveWeight();
  const sync = useSyncStatus();

  const [mode, setMode] = useState<WeighingMode>('first');
  const [captured, setCaptured] = useState<CapturedWeight | null>(null);
  const [saved, setSaved] = useState<Weighment | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /* Decides whether the middle column exists at all — an empty one would
     hold its width open and leave a gap on a bridge with no cameras. */
  const cameras = useCameras();
  /* The pass-two net, reported up by ReturnWeighment so it can be shown in
     the left column directly under the capture card — the net belongs beside
     the weight it is computed from, not further down a separate column.
     Stable identity via useCallback: the flow reports this from an effect,
     and a new function each render would make that effect fire forever. */
  const [secondNet, setSecondNet] = useState<{ net: NetWeight; pending: boolean } | null>(null);
  const reportSecondNet = useCallback(
    (net: NetWeight | null, pending: boolean) => setSecondNet(net ? { net, pending } : null),
    [],
  );

  const switchMode = (next: WeighingMode) => {
    if (next === mode) return;
    // A captured weight belongs to the pass it was taken for; carrying it
    // across modes is how a first weight ends up recorded as a second one.
    setCaptured(null);
    setSaved(null);
    setSecondNet(null);
    setMode(next);
  };

  const handleSaved = (weighment: Weighment, warnings: AgentWarning[]) => {
    setSaved(weighment);
    setCaptured(null);

    toast.success(`Saved — slip ${weighment.slip_number}`, {
      description: [weighment.customer_name, weighment.vehicle_plate].filter(Boolean).join(' · '),
    });

    // Advice, not an error: a second open ticket for the same plate is
    // unusual but legitimate, so it is surfaced and the save still stands.
    for (const warning of warnings) {
      toast.warning(warning.message, { duration: 8000 });
    }
  };

  return (
    <div className="min-h-full bg-muted/30">
      {/* The orange rule picks up the logo's second brand colour and gives the
          screen an edge of colour without tinting anything that carries data. */}
      <header className="border-b-[3px] border-b-brand bg-background">
        <div className="mx-auto flex max-w-[120rem] flex-wrap items-center gap-3 px-4 py-2.5 sm:px-6">
          {/* The logo is the whole identity here — `mr-auto` moved onto it now
              that the wording beside it is gone, so the nav still sits right. */}
          <img
            src="/logo.png"
            srcSet="/logo.png 1x, /logo@3x.png 3x"
            alt="Suarza International"
            className="mr-auto h-12 w-auto"
          />

          <ThemeToggle />

          <Button
            variant="ghost"
            size="icon"
            aria-label="Printing and receipt settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-[120rem] space-y-6 px-4 py-6 sm:px-6">
        {/* Above everything: what is happening at the gate decides the rest of
            the screen, and a returning truck is the moment an operator needs to
            find this without hunting. */}
        <ModeSwitch mode={mode} onChange={switchMode} />

        {/*
          * Three columns on a wide screen: the scale, what it sees, and the
          * paperwork. The cameras used to sit under the live weight, which
          * squeezed them into half a narrow column and pushed the form down.
          * In their own column they are big enough to actually check a truck
          * is squarely on the bridge, and the page uses the width a desktop
          * PC has instead of leaving it as margin.
          *
          * Two columns below xl, where a third would make all of them too
          * narrow to read.
          */}
        <div
          className={cn(
            'grid gap-6 lg:items-start lg:grid-cols-[minmax(300px,24rem)_1fr]',
            /* Two steps, because the weighbridge PC may be a 1366-wide screen:
               at xl the camera column takes what it can without squeezing the
               form into one column of fields, and only on a genuinely wide
               monitor does it grow. */
            cameras.enabled &&
              'xl:grid-cols-[minmax(300px,21rem)_minmax(260px,22rem)_1fr] 2xl:grid-cols-[minmax(320px,22rem)_minmax(320px,28rem)_1fr]',
          )}
        >
          <div className="space-y-4 lg:sticky lg:top-6">
            <LiveWeightPanel
              live={live}
              pendingSyncCount={sync.pendingCount}
              blockedSyncCount={sync.blockedCount}
              online={sync.online}
            />

            {/* One place for this control, in every mode: under the live
                reading, beside the scale it reads from. It used to sit inside
                the second-weight flow instead, next to the record it belonged
                to, which meant the operator's hand went to a different part
                of the screen depending on which pass they were on.

                It no longer waits for a slip to be found, either. The truck is
                on the bridge while the operator is still typing the slip
                number, and the weight is the thing that cannot wait. Saving is
                still gated on the record, inside the flow.

                The one-visit flow weighs the LOADED truck, so it is labelled
                for pass two even though the form beside it is the pass-one
                form.

                Hidden in the fourth flow: both of its weights come off an
                earlier slip, nothing is weighed, and a capture button there
                would be a control with nothing to do. The live reading stays
                above it, because the operator still wants to see the bridge. */}
            {!saved && mode !== 'fourth' && (
              <WeightCapture
                live={live}
                captured={captured}
                onCapture={setCaptured}
                onClear={() => setCaptured(null)}
                pass={mode === 'first' ? 'first' : 'second'}
              />
            )}

            {mode === 'second' && secondNet && (
              <NetWeightDisplay net={secondNet.net} pending={secondNet.pending} />
            )}

          </div>

          {/* The middle column: what the cameras see. Sticky like the scale
              beside it, because the operator looks at both while filling in
              the form in the third column. */}
          {cameras.enabled && (
            <div className="lg:sticky lg:top-6">
              <CameraPanel />
            </div>
          )}

          <div>
            {mode === 'second' ? (
              <ReturnWeighment
                captured={captured}
                onClearCapture={() => setCaptured(null)}
                onNetChange={reportSecondNet}
              />
            ) : saved ? (
              <SavedWeighment
                weighment={saved}
                onNext={() => {
                  setSaved(null);
                  setCaptured(null);
                }}
              />
            ) : (
              <NewWeighmentForm
                captured={captured}
                onSaved={handleSaved}
                flow={mode === 'third' ? 'third' : mode === 'fourth' ? 'fourth' : 'first'}
              />
            )}
          </div>
        </div>
      </main>

      <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
