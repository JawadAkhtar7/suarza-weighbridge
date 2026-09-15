/**
 * Minimal print settings (brief §13-M4).
 *
 * Everything here exists to make the central block land inside the blank area
 * of a pre-printed pad. The client has not yet supplied the printer model or
 * the pad dimensions (brief §14), so the defaults are a guess — A5, no offset —
 * and the test print is how they get corrected on site in about a minute.
 *
 * Settings are stored by the AGENT, not the browser, so a calibration or an
 * edited rate card survives a cleared browser profile and is the same in every
 * browser on that PC.
 */

import { useEffect, useRef, useState } from 'react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  buildTestPrintStyle,
  cn,
} from '@suarza/ui';
import {
  VEHICLE_TYPE_DEFS,
  formatPKR,
  paperSizeSchema,
  priceFor,
  type PaperSize,
} from '@suarza/shared';
import { Loader2, Printer, RotateCcw } from 'lucide-react';
import { useReceiptSettings } from '../hooks/use-receipt-settings.js';
import { defaultReceiptSettings, type ReceiptSettings } from '../lib/receipt-settings.js';
import { TestPrintSheet } from './test-print-sheet.js';

const PAPER_LABELS: Record<PaperSize, string> = {
  A5: 'A5 (148 × 210 mm)',
  A4: 'A4 (210 × 297 mm)',
  LETTER: 'Letter (216 × 279 mm)',
  CUSTOM: 'Custom size',
};

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsPanel({ open, onOpenChange }: SettingsPanelProps) {
  const { settings, update, isSaving } = useReceiptSettings();
  const [draft, setDraft] = useState<ReceiptSettings>(settings);
  const testRef = useRef<HTMLDivElement>(null);

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

  const setPrint = (patch: Partial<ReceiptSettings['print']>) =>
    setDraft((current) => ({ ...current, print: { ...current.print, ...patch } }));

  const save = () => {
    // The provider owns the toast, because it is the thing that knows whether
    // the agent actually accepted the save.
    update(draft);
    onOpenChange(false);
  };

  const restoreDefaults = () => setDraft(defaultReceiptSettings());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Printing &amp; receipt settings</DialogTitle>
          <DialogDescription>These apply to this weighbridge PC and its printer.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Paper &amp; alignment</h3>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Paper size</Label>
                <Select
                  value={draft.print.paper_size}
                  onValueChange={(value) => setPrint({ paper_size: paperSizeSchema.parse(value) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAPER_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="scale">Scale (%)</Label>
                <NumberInput
                  id="scale"
                  min={50}
                  max={150}
                  step="1"
                  value={draft.print.scale_percent}
                  onChange={(event) => setPrint({ scale_percent: Number(event.target.value) })}
                />
              </div>
            </div>

            {draft.print.paper_size === 'CUSTOM' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="paper-width">Width (mm)</Label>
                  <NumberInput
                    id="paper-width"
                    min={50}
                    max={500}
                    value={draft.print.custom_width_mm}
                    onChange={(event) => setPrint({ custom_width_mm: Number(event.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="paper-height">Height (mm)</Label>
                  <NumberInput
                    id="paper-height"
                    min={50}
                    max={500}
                    value={draft.print.custom_height_mm}
                    onChange={(event) => setPrint({ custom_height_mm: Number(event.target.value) })}
                  />
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="offset-top">Top offset (mm)</Label>
                <NumberInput
                  id="offset-top"
                  min={-50}
                  max={200}
                  value={draft.print.offset_top_mm}
                  onChange={(event) => setPrint({ offset_top_mm: Number(event.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="offset-left">Left offset (mm)</Label>
                <NumberInput
                  id="offset-left"
                  min={-50}
                  max={200}
                  value={draft.print.offset_left_mm}
                  onChange={(event) => setPrint({ offset_left_mm: Number(event.target.value) })}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" onClick={() => testPrint()}>
                <Printer />
                Test print
              </Button>
              <p className="text-xs text-muted-foreground">
                Prints a dashed outline onto a blank pad sheet. Measure the gap and adjust the
                offsets until it sits inside the blank area.
              </p>
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

          <Separator />

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Receipt details</h3>
            <p className="text-xs text-muted-foreground">
              Shown on the on-screen preview and on the web page behind the QR code. The printed
              slip takes its header and footer from the pre-printed pad instead.
            </p>

            <div className="space-y-2">
              <Label htmlFor="company-name">Company name</Label>
              <Input
                id="company-name"
                value={draft.company_name}
                onChange={(event) => setDraft({ ...draft, company_name: event.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="company-address">Address</Label>
              <Input
                id="company-address"
                value={draft.company_address}
                onChange={(event) => setDraft({ ...draft, company_address: event.target.value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="company-phone">Phone</Label>
                <Input
                  id="company-phone"
                  value={draft.company_phone}
                  onChange={(event) => setDraft({ ...draft, company_phone: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company-logo">Logo URL</Label>
                <Input
                  id="company-logo"
                  value={draft.company_logo_url}
                  placeholder="Optional"
                  onChange={(event) => setDraft({ ...draft, company_logo_url: event.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="receipt-base">Receipt web address</Label>
              <Input
                id="receipt-base"
                value={draft.receipt_base_url}
                placeholder="https://weighbridge.example.com"
                onChange={(event) => setDraft({ ...draft, receipt_base_url: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                The QR code points at <code>{draft.receipt_base_url || '…'}/r/SI-000123</code>.
                Leave it as it is unless the receipt page is served from a different address than
                the cloud server — this defaults to the cloud the station already syncs to.
              </p>
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Pricing</h3>
            <p className="text-xs text-muted-foreground">
              The rate that auto-fills when a vehicle type is chosen. The amount on the weighing
              form stays editable regardless.
            </p>

            <div className="grid gap-2 sm:grid-cols-2">
              {VEHICLE_TYPE_DEFS.map((def) => {
                const value = draft.pricing[def.key] ?? priceFor(def.key);
                const isCustom = value !== def.defaultPrice;
                return (
                  <div key={def.key} className="flex items-center gap-2">
                    <Label htmlFor={`price-${def.key}`} className="flex-1 text-sm font-normal">
                      {def.label}
                    </Label>
                    <div className="relative w-28 shrink-0">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        Rs
                      </span>
                      <NumberInput
                        id={`price-${def.key}`}
                        min={0}
                        step="1"
                        value={value}
                        className={cn('h-9 pl-8', isCustom && 'border-primary')}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            pricing: { ...current.pricing, [def.key]: Number(event.target.value) },
                          }))
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Highlighted fields differ from the shipped defaults (a truck ships at{' '}
              {formatPKR(priceFor('truck'))}).
            </p>
          </section>

          <Separator />

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Station &amp; sync</h3>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="station-id">Station ID</Label>
                <Input
                  id="station-id"
                  value={draft.station_id}
                  onChange={(event) => setDraft({ ...draft, station_id: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Recorded on every weighment. Only matters with more than one bridge.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sync-interval">Sync check (seconds)</Label>
                <NumberInput
                  id="sync-interval"
                  min={30}
                  max={3600}
                  step="30"
                  value={draft.sync_interval_seconds}
                  onChange={(event) =>
                    setDraft({ ...draft, sync_interval_seconds: Number(event.target.value) })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  A backstop only — records already sync the moment they are saved.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
              <div className="space-y-2">
                <Label htmlFor="backup-path">Backup folder</Label>
                <Input
                  id="backup-path"
                  value={draft.backup_path}
                  placeholder="e.g. D:\\weighbridge-backups  (blank disables backups)"
                  onChange={(event) => setDraft({ ...draft, backup_path: event.target.value })}
                />
              </div>
              <div className="space-y-2">
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
              A safe copy of the weighment database, taken while the agent keeps running. The last
              14 copies are kept. Changing the folder takes effect when the agent next starts.
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
          <Button type="button" onClick={save} disabled={isSaving}>
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
  );
}
