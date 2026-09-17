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

import { useState } from 'react';
import { Button, ThemeToggle, toast } from '@suarza/ui';
import type { Weighment } from '@suarza/shared';
import { Settings } from 'lucide-react';
import { LiveWeightPanel } from './components/live-weight-panel.js';
import { WeightCapture, type CapturedWeight } from './components/weight-capture.js';
import { NewWeighmentForm } from './components/new-weighment-form.js';
import { SavedWeighment } from './components/saved-weighment.js';
import { ReturnWeighment } from './components/return-weighment.js';
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

  const switchMode = (next: WeighingMode) => {
    if (next === mode) return;
    // A captured weight belongs to the pass it was taken for; carrying it
    // across modes is how a first weight ends up recorded as a second one.
    setCaptured(null);
    setSaved(null);
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
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2.5 sm:px-6">
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

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {/* Above everything: what is happening at the gate decides the rest of
            the screen, and a returning truck is the moment an operator needs to
            find this without hunting. */}
        <ModeSwitch mode={mode} onChange={switchMode} />

        <div className="grid gap-6 lg:grid-cols-[minmax(320px,26rem)_1fr] lg:items-start">
          <div className="space-y-4 lg:sticky lg:top-6">
            <LiveWeightPanel
              live={live}
              pendingSyncCount={sync.pendingCount}
              blockedSyncCount={sync.blockedCount}
              online={sync.online}
            />

            {/* In second-weight mode the capture control lives inside the
                flow, next to the record it belongs to, so it isn't duplicated
                here. */}
            {mode === 'first' && !saved && (
              <WeightCapture
                live={live}
                captured={captured}
                onCapture={setCaptured}
                onClear={() => setCaptured(null)}
              />
            )}
          </div>

          <div>
            {mode === 'first' ? (
              saved ? (
                <SavedWeighment
                  weighment={saved}
                  onNext={() => {
                    setSaved(null);
                    setCaptured(null);
                  }}
                />
              ) : (
                <NewWeighmentForm captured={captured} onSaved={handleSaved} />
              )
            ) : (
              <ReturnWeighment
                live={live}
                captured={captured}
                onCapture={setCaptured}
                onClearCapture={() => setCaptured(null)}
              />
            )}
          </div>
        </div>
      </main>

      <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
