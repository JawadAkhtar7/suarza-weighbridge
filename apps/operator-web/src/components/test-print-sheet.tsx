/**
 * Calibration sheet (brief §13-M4: "test print").
 *
 * Printed onto a blank sheet from the pre-printed pad. The dashed rectangle is
 * exactly where a receipt's central block will land, so the operator can see at
 * a glance whether it falls inside the pad's blank area and by how much it is
 * out — rather than burning slips to find out.
 */

import { PRINT_BLOCK_CLASS } from '@suarza/ui';
import type { PrintSettings } from '@suarza/shared';

export function TestPrintSheet({ settings }: { settings: PrintSettings }) {
  return (
    <div className="bg-white text-black">
      <div className={`${PRINT_BLOCK_CLASS} px-6 py-5`}>
        <div className="receipt-test-outline w-full max-w-[150mm] border border-dashed border-black p-4">
          <p className="text-lg font-bold uppercase tracking-wide">Test print — alignment</p>
          <p className="mt-1 text-sm">
            This dashed box is where the receipt&apos;s central block will print.
          </p>

          <dl className="mt-4 space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="w-32 font-medium">Paper</dt>
              <dd>
                {settings.paper_size === 'CUSTOM'
                  ? `${settings.custom_width_mm} × ${settings.custom_height_mm} mm`
                  : settings.paper_size}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-32 font-medium">Top offset</dt>
              <dd>{settings.offset_top_mm} mm</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-32 font-medium">Left offset</dt>
              <dd>{settings.offset_left_mm} mm</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-32 font-medium">Scale</dt>
              <dd>{settings.scale_percent}%</dd>
            </div>
          </dl>

          <p className="mt-4 text-xs">
            If the box sits too high, increase the top offset. Too far left, increase the left
            offset. If it does not fit the blank area at all, reduce the scale.
          </p>

          {/* A 100mm rule: the operator can check the printer is not scaling
              the page behind our back, which silently ruins every offset. */}
          <div className="mt-5">
            <div className="h-3 w-[100mm] border-x border-b border-black" />
            <p className="mt-1 text-[10px]">
              This bar should measure exactly 100 mm. If it does not, the printer is scaling the
              page — turn off &quot;fit to page&quot; in the print dialog.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
