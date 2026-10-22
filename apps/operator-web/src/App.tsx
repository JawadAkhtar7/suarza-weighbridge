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

import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, ThemeToggle, toast } from '@suarza/ui';
import type { NetWeight, Weighment } from '@suarza/shared';
import { HandCoins, LogOut, Settings } from 'lucide-react';
import { LiveWeightPanel } from './components/live-weight-panel.js';
import { WeightCapture, type CapturedWeight } from './components/weight-capture.js';
import { NewWeighmentForm } from './components/new-weighment-form.js';
import { SavedWeighment } from './components/saved-weighment.js';
import { ReturnWeighment } from './components/return-weighment.js';
import { NetWeightDisplay } from './components/net-weight-display.js';
import { CameraPanel } from './components/camera-panel.js';
import { SettingsPanel } from './components/settings-panel.js';
import { ModeSwitch, type WeighingMode } from './components/mode-switch.js';
import { useLiveWeight, useSyncStatus } from './hooks/use-live-weight.js';
import { agentApi, type AgentWarning } from './lib/api.js';
import { useShift } from './components/shift-provider.js';
import { ShiftCashDialog } from './components/shift-cash-dialog.js';
import type { ShiftCashMovement } from '@suarza/shared';

/**
 * Whether this shift has already been asked about its opening cash.
 *
 * Per session id, so a reload does not ask twice and the next shift is asked
 * afresh. Guarded like every other storage read: a browser that refuses it
 * simply asks again, which is the harmless failure.
 */
const CASH_ASKED_PREFIX = 'suarza.shift.cash-asked.';

function readCashAsked(sessionId: string): boolean {
  try {
    return window.localStorage.getItem(CASH_ASKED_PREFIX + sessionId) === '1';
  } catch {
    return false;
  }
}

function rememberCashAsked(sessionId: string): void {
  try {
    window.localStorage.setItem(CASH_ASKED_PREFIX + sessionId, '1');
  } catch {
    // Asking again after a reload is the harmless failure.
  }
}

export function App() {
  const live = useLiveWeight();
  const sync = useSyncStatus();
  const shift = useShift();

  /*
   * The cash form, at both ends of the shift.
   *
   * `null` is the ordinary state — the weighing screen, with nothing in
   * front of it. The start form appears once when a shift begins and can be
   * put off; the end form appears when the operator asks to go home.
   */
  const [cashStage, setCashStage] = useState<'start' | 'end' | null>(null);
  const [cashBusy, setCashBusy] = useState(false);

  /* Asked once per shift. The flag is kept per session id, so a reload — or
     the print tab stealing focus — does not ask again, and the next shift
     is asked afresh. */
  useEffect(() => {
    const id = shift.session?.session_id;
    if (!id) return;
    if (readCashAsked(id)) return;
    setCashStage('start');
  }, [shift.session?.session_id]);

  /* Who is on the other shift, as the likely person on the other side of the
     handover. A guess the operator can type over, not an answer. */
  const directory = useQuery({
    queryKey: ['operator-directory'],
    queryFn: agentApi.operatorDirectory,
    staleTime: 5 * 60_000,
    retry: false,
    enabled: Boolean(shift.session),
  });

  /* Everybody but the person filling the form in: the handover is with
     somebody else, and offering an operator their own name is noise. */
  const operatorNames = (directory.data?.operators ?? [])
    .filter((operator) => operator.username !== shift.session?.username)
    .map((operator) => operator.name);

  const counterpart =
    directory.data?.operators.find(
      (operator) => operator.slot !== 'ADMIN' && operator.slot !== shift.session?.slot,
    )?.name ?? '';

  /* What this shift has written down already. Listed in the form, because
     an operator about to type a figure needs to know whether they have
     typed it already. */
  const recorded = useQuery({
    queryKey: ['shift-cash', shift.session?.session_id],
    queryFn: agentApi.shiftCash,
    enabled: Boolean(shift.session) && cashStage !== null,
    retry: false,
  });

  const closeCash = (id: string | undefined) => {
    if (id) rememberCashAsked(id);
    setCashStage(null);
  };

  const submitCash = (cash: ShiftCashMovement) => {
    const id = shift.session?.session_id;
    setCashBusy(true);

    if (cashStage === 'start') {
      void agentApi
        .recordShiftCash({ ...cash, stage: 'START' })
        .then(() => {
          void recorded.refetch();
          toast.success('Cash written down');
        })
        .catch(() =>
          toast.error('Could not save the cash', {
            description: 'Your shift has started; tell the manager what you were given.',
          }),
        )
        .finally(() => {
          setCashBusy(false);
          closeCash(id);
        });
      return;
    }

    void shift
      .endShift(cash)
      .then(() => toast.success('Shift ended'))
      .finally(() => {
        setCashBusy(false);
        setCashStage(null);
      });
  };

  const [mode, setMode] = useState<WeighingMode>('first');
  const [captured, setCaptured] = useState<CapturedWeight | null>(null);

  /**
   * Let go of the weight, and of the photographs taken with it.
   *
   * Housekeeping rather than correctness — the agent forgets a token by
   * itself after ten minutes — but a busy morning of abandoned forms would
   * otherwise push a live token out of a store full of dead ones.
   *
   * Reads the current capture through the setter rather than closing over it,
   * so this can be called from anywhere without going stale.
   */
  const clearCaptured = useCallback(() => {
    setCaptured((current) => {
      if (current?.captureId)
        void agentApi.discardCapture(current.captureId).catch(() => undefined);
      return null;
    });
  }, []);
  const [saved, setSaved] = useState<Weighment | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    clearCaptured();
    setSaved(null);
    setSecondNet(null);
    setMode(next);
  };

  const handleSaved = (weighment: Weighment, warnings: AgentWarning[]) => {
    setSaved(weighment);
    /* The save has already quoted the token; the agent dropped it when it
       claimed the pictures, so this only clears the screen. */
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

          {/* Whose shift it is, beside the way out of it. Named rather than
              implied: two people use this machine and the records carry
              whoever is signed in. */}
          {shift.session && (
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium">{shift.session.name}</p>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">On shift</p>
            </div>
          )}

          <ThemeToggle />

          {/* Opens the same form the shift started with. The start form can
              be put off, and an operator who put it off needs a way back to
              it that is not signing out and in again. */}
          {shift.session && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCashStage('start')}
              title="Write down the cash you took or gave at the start of your shift"
            >
              <HandCoins className="h-4 w-4" />
              Shift cash
            </Button>
          )}

          {shift.session && (
            <Button variant="outline" size="sm" onClick={() => setCashStage('end')}>
              <LogOut className="h-4 w-4" />
              End shift
            </Button>
          )}

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

      <main className="mx-auto max-w-[120rem] px-4 py-6 sm:px-6">
        {/*
         * Two columns, and the scale starts at the very top.
         *
         * The mode tabs used to span the full width above everything, which
         * pushed the live readout a tab-row down the screen for no reason —
         * the operator looks at the weight far more often than they switch
         * pass. The tabs now head the right-hand column instead, so the
         * readout sits level with the header and the cameras come back
         * underneath it where the eye already is.
         */}
        <div className="grid gap-6 lg:items-start lg:grid-cols-[28rem_minmax(0,1fr)] 2xl:grid-cols-[30rem_minmax(0,1fr)]">
          <div className="space-y-4 lg:sticky lg:top-6">
            <LiveWeightPanel
              live={live}
              pendingSyncCount={sync.pendingCount}
              blockedSyncCount={sync.blockedCount}
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
                onClear={clearCaptured}
                pass={mode === 'first' ? 'first' : 'second'}
              />
            )}

            {mode === 'second' && secondNet && (
              <NetWeightDisplay net={secondNet.net} pending={secondNet.pending} />
            )}

            {/* Back under the weights, where the eye already is: the operator
                glances at the live view to check the truck is squarely on the
                bridge, and that is the same glance as reading the scale.
                Draws nothing on a bridge with no cameras, and the column
                simply closes up. */}
            <CameraPanel />
          </div>

          <div className="space-y-6">
            {/* Heading this column rather than the whole page. Switching pass
                is something an operator does once a truck, not once a glance,
                so it does not deserve a full-width row above the readout. */}
            <ModeSwitch mode={mode} onChange={switchMode} />

            {mode === 'second' ? (
              <ReturnWeighment
                captured={captured}
                onClearCapture={clearCaptured}
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

      <ShiftCashDialog
        open={cashStage !== null}
        stage={cashStage ?? 'start'}
        operatorNames={operatorNames}
        counterpartName={counterpart}
        recorded={recorded.data?.entries ?? []}
        busy={cashBusy}
        onSubmit={submitCash}
        onSkip={() => {
          /* At the start this is "later"; at the end it is "go home anyway".
             Neither is a failure, and neither keeps the operator here. */
          if (cashStage === 'end') {
            void shift.endShift().then(() => toast.success('Shift ended'));
            setCashStage(null);
            return;
          }
          closeCash(shift.session?.session_id);
        }}
      />

      <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
