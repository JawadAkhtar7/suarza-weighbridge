/**
 * Station settings: printing, the receipt's wording, syncing, and backups.
 *
 * Settings are stored by the AGENT, not the browser, so they survive a cleared
 * browser profile and are the same in every browser on that PC.
 *
 * Customers and rates are NOT settings any more — the manager keeps them and
 * this screen only pulls them down. That is why the rate card is a sync button
 * here rather than a table of editable prices: two tiers that can both edit a
 * rate will eventually disagree about what a truck costs.
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useReactToPrint } from 'react-to-print';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NumberInput,
  Separator,
  buildTestPrintStyle,
  toast,
} from '@suarza/ui';
import {
  formatDateTimePkt,
  formatPKR,
  type SyncOutcome,
} from '@suarza/shared';
import { ListChecks, Loader2, Printer, RefreshCw, RotateCcw } from 'lucide-react';
import { agentApi, AgentApiError } from '../lib/api.js';
import { useReceiptSettings } from '../hooks/use-receipt-settings.js';
import { defaultReceiptSettings, type ReceiptSettings } from '../lib/receipt-settings.js';
import { TestPrintSheet } from './test-print-sheet.js';

/**
 * One pullable list.
 *
 * It reports what actually changed rather than just "done": "nothing changed"
 * and "3 rates updated" are different answers, and a button that always claims
 * success teaches an operator to stop believing it.
 */
function SyncRow({
  label,
  lastSyncedAt,
  onSync,
  pending,
  children,
}: {
  label: string;
  lastSyncedAt: string | null;
  onSync: () => void;
  pending: boolean;
  /** Extra controls beside the sync button, such as "View list". */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
      <div className="mr-auto min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {lastSyncedAt ? `Last synced ${formatDateTimePkt(lastSyncedAt)}` : 'Never synced'}
        </p>
      </div>
      {children}
      {/* Orange, like every other action that carries the screen forward. */}
      <Button type="button" variant="brand" onClick={onSync} disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        Sync now
      </Button>
    </div>
  );
}

/**
 * The rate card as this weighbridge currently holds it.
 *
 * Its whole job is to answer "did that sync actually work?" without the
 * operator having to start a weighing to find out — so it reads from the same
 * place the weighing form does, rather than asking the manager again.
 */
function VehicleTypesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const types = useQuery({
    queryKey: ['vehicle-types'],
    queryFn: agentApi.getVehicleTypes,
    enabled: open,
  });

  const rows = types.data?.vehicle_types ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Vehicle types &amp; rates on this weighbridge</DialogTitle>
          <DialogDescription>
            {types.data?.last_synced_at.vehicle_types
              ? `Last synced ${formatDateTimePkt(types.data.last_synced_at.vehicle_types)}.`
              : 'This weighbridge has never synced; these are the types it shipped with.'}
          </DialogDescription>
        </DialogHeader>

        {types.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No vehicle types yet. Press Sync now to fetch them from the manager.
          </p>
        ) : (
          <div className="divide-y rounded-md border">
            {rows.map((type) => (
              <div key={type.key} className="flex items-center gap-3 px-3 py-2">
                <div className="mr-auto min-w-0">
                  <p className="truncate text-sm font-medium">{type.label}</p>
                  <p className="truncate text-xs text-muted-foreground">{type.key}</p>
                </div>
                <span className="tabular shrink-0 text-sm font-semibold">
                  {type.rate_pkr > 0 ? (
                    formatPKR(type.rate_pkr)
                  ) : (
                    <span className="font-normal text-muted-foreground">You type the amount</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {rows.length} type{rows.length === 1 ? '' : 's'} available on the weighing form. Rates are
          set by the manager; the amount stays editable on every weighing.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * What the operator can move on the printed slip, and what each control
 * covers.
 *
 * Named by what is on the paper rather than by anything in the code: an
 * operator holding a slip is looking for "the side view picture", not for a
 * layout group. The front view is deliberately absent — it has never needed
 * moving, and a control nobody uses is one more thing to set wrong.
 *
 * The weight date/time steps in quarter millimetres: it is centred on a
 * pre-printed icon only 3.7 mm tall, where half a millimetre is a visible
 * jump.
 */
const CALIBRATION_GROUPS = [
  {
    key: 'details',
    label: 'Slip number, date/time and customer details',
    x: 'details_offset_x_mm',
    y: 'details_offset_y_mm',
    step: 0.5,
  },
  {
    key: 'weights',
    label: 'First, second and net weight',
    x: 'weights_offset_x_mm',
    y: 'weights_offset_y_mm',
    step: 0.5,
  },
  {
    key: 'weight-times',
    label: 'Date/time beside the calendar icons',
    x: 'weight_times_offset_x_mm',
    y: 'weight_times_offset_y_mm',
    step: 0.25,
  },
  {
    key: 'side-view',
    label: 'Side view picture',
    x: 'side_view_offset_x_mm',
    y: 'side_view_offset_y_mm',
    step: 0.5,
  },
  { key: 'qr', label: 'QR code', x: 'qr_offset_x_mm', y: 'qr_offset_y_mm', step: 0.5 },
] as const;

export function SettingsPanel({ open, onOpenChange }: SettingsPanelProps) {
  const { settings, update, isSaving } = useReceiptSettings();
  const [draft, setDraft] = useState<ReceiptSettings>(settings);
  const testRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const [typesOpen, setTypesOpen] = useState(false);

  // Only while the dialog is open: the rest of the app has no use for this.
  const syncState = useQuery({
    queryKey: ['vehicle-types'],
    queryFn: agentApi.getVehicleTypes,
    enabled: open,
  });

  /** Both buttons behave the same; only the call and the noun differ. */
  const pullList = (noun: string, call: () => Promise<SyncOutcome>) => ({
    mutationFn: call,
    onSuccess: (outcome: SyncOutcome) => {
      void queryClient.invalidateQueries({ queryKey: ['vehicle-types'] });
      void queryClient.invalidateQueries({ queryKey: ['customers'] });

      const changes = [
        outcome.added && `${outcome.added} added`,
        outcome.updated && `${outcome.updated} updated`,
        outcome.removed && `${outcome.removed} removed`,
      ].filter(Boolean);

      toast.success(changes.length > 0 ? `${noun} synced` : `${noun} already up to date`, {
        description:
          changes.length > 0 ? changes.join(', ') : `${outcome.total} on this weighbridge.`,
      });
    },
    onError: (error: unknown) => {
      toast.error(`Could not sync ${noun.toLowerCase()}`, {
        description: error instanceof AgentApiError ? error.message : 'Unexpected error.',
      });
    },
  });

  const syncCustomers = useMutation(pullList('Customers', agentApi.syncCustomers));
  const syncVehicleTypes = useMutation(pullList('Vehicle types', agentApi.syncVehicleTypes));

  /**
   * Re-seed the draft whenever the dialog opens.
   *
   * Two things make this necessary rather than initialising state once: the
   * settings arrive from the agent a moment after mount, and the dialog is
   * opened by the caller setting `open` — which never fires `onOpenChange`.
   * Without this the panel showed the shipped defaults over the top of a
   * saved calibration, and saving would have silently reverted it.
   */
  useEffect(() => {
    if (open) setDraft(settings);
  }, [open, settings]);

  // Calibration has to reflect what the operator just typed, not what was last
  // saved — otherwise every test print is one edit behind.
  const testPrint = useReactToPrint({
    contentRef: testRef,
    documentTitle: 'weighbridge-test-print',
    pageStyle: buildTestPrintStyle(draft.print),
  });

  const save = () => {
    // The provider owns the toast, because it is the thing that knows whether
    // the agent actually accepted the save.
    update(draft);
    onOpenChange(false);
  };

  const restoreDefaults = () => setDraft(defaultReceiptSettings());

  return (
    // The two dialogs are siblings, not nested: a dialog rendered inside
    // another fights the outer one's focus trap, and the list would open behind
    // it or refuse the keyboard.
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Printing &amp; receipt settings</DialogTitle>
            <DialogDescription>
              These apply to this weighbridge PC and its printer.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Customers &amp; rates</h3>
              <SyncRow
                label="Customers"
                lastSyncedAt={syncState.data?.last_synced_at.customers ?? null}
                onSync={() => syncCustomers.mutate()}
                pending={syncCustomers.isPending}
              />

              <SyncRow
                label="Vehicle types & rates"
                lastSyncedAt={syncState.data?.last_synced_at.vehicle_types ?? null}
                onSync={() => syncVehicleTypes.mutate()}
                pending={syncVehicleTypes.isPending}
              >
                <Button type="button" variant="outline" onClick={() => setTypesOpen(true)}>
                  <ListChecks className="h-4 w-4" />
                  View list
                </Button>
              </SyncRow>
            </section>

            <Separator />

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Printing</h3>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={() => testPrint()}>
                  <Printer />
                  Test print
                </Button>
                <p className="text-xs text-muted-foreground">
                  Prints a dashed outline onto a blank pad sheet, so you can check the slip lands
                  inside the blank area before using a real pad
                </p>
              </div>

              {/*
                * Calibration, five groups, paper only.
                *
                * The pads are pre-printed on one press and overprinted on
                * another, and they disagree about where the sheet starts —
                * not by one uniform amount, which is why a single page-wide
                * nudge was tried and withdrawn. Each group that drifts on its
                * own gets moved on its own.
                */}
              <div className="space-y-3 rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">Print alignment</p>
                  <p className="text-xs text-muted-foreground">
                    Moves things on the printed slip only, to line up with your pads. The copy on
                    screen, the PDF and the page behind the QR code never move. Right and down are
                    positive; use a minus for left and up.
                  </p>
                </div>

                {CALIBRATION_GROUPS.map((group) => (
                  <div key={group.key} className="space-y-1.5">
                    <p className="text-xs font-medium">{group.label}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor={`${group.key}-x`} className="text-xs font-normal">
                          Left / right (mm)
                        </Label>
                        <NumberInput
                          id={`${group.key}-x`}
                          step={group.step}
                          min={-20}
                          max={20}
                          value={draft.print[group.x]}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              print: { ...draft.print, [group.x]: Number(event.target.value) },
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`${group.key}-y`} className="text-xs font-normal">
                          Up / down (mm)
                        </Label>
                        <NumberInput
                          id={`${group.key}-y`}
                          step={group.step}
                          min={-20}
                          max={20}
                          value={draft.print[group.y]}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              print: { ...draft.print, [group.y]: Number(event.target.value) },
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                ))}

                {/* Widens, rather than moves: white on BOTH sides of a
                    picture is a box wider than the photo, not an offset. */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">Picture width</p>
                  <p className="text-xs text-muted-foreground">
                    Extra width added to each side of the picture. Raise it if white shows on both
                    sides of a picture; lower it if the picture spills past the green line.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(
                      [
                        ['front_view_extra_width_mm', 'Front view (mm)'],
                        ['side_view_extra_width_mm', 'Side view (mm)'],
                      ] as const
                    ).map(([field, label]) => (
                      <div key={field} className="space-y-1">
                        <Label htmlFor={field} className="text-xs font-normal">
                          {label}
                        </Label>
                        <NumberInput
                          id={field}
                          step="0.25"
                          min={0}
                          max={5}
                          value={draft.print[field]}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              print: { ...draft.print, [field]: Number(event.target.value) },
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={draft.auto_print}
                  onChange={(event) => setDraft({ ...draft, auto_print: event.target.checked })}
                />
                Print automatically after saving or completing a weighing
              </label>
            </section>

            {/*
              * No camera framing here. Both pictures are framed by hand on
              * the live previews (CameraFramer) — zoom and drag — which is
              * where the operator can see what they are choosing. A number
              * typed here and checked on a slip afterwards was the old way.
              */}

            <Separator />

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Backup</h3>
              <p className="text-xs text-muted-foreground">
                A spare copy of all weighing records. If this PC ever fails, the copy is your data.
                Leave the folder blank to switch backups off.
              </p>

              <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                <div className="space-y-2">
                  <Label htmlFor="backup-path" className="sr-only">
                    Backup folder
                  </Label>
                  <Input
                    id="backup-path"
                    value={draft.backup_path}
                    placeholder="Backup folder, e.g. D:\\weighbridge-backups"
                    onChange={(event) => setDraft({ ...draft, backup_path: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  {/* This one keeps its label. The box always holds a number,
                      so a placeholder would never be on screen to read. */}
                  <Label htmlFor="backup-hours">Every (hours)</Label>
                  <NumberInput
                    id="backup-hours"
                    min={1}
                    max={168}
                    value={draft.backup_interval_hours}
                    onChange={(event) =>
                      setDraft({ ...draft, backup_interval_hours: Number(event.target.value) })
                    }
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The last 14 copies are kept. A new folder takes effect next time the agent starts.
              </p>
            </section>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={restoreDefaults} className="mr-auto">
              <RotateCcw />
              Restore defaults
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" variant="brand" onClick={save} disabled={isSaving}>
              {isSaving && <Loader2 className="animate-spin" />}
              Save settings
            </Button>
          </DialogFooter>

          {/* Off-screen: exists only to be the print target. */}
          <div className="hidden">
            <div ref={testRef}>
              <TestPrintSheet settings={draft.print} />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <VehicleTypesDialog open={typesOpen} onOpenChange={setTypesOpen} />
    </>
  );
}
