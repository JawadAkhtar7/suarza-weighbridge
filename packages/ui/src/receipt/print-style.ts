/**
 * Print CSS for the hard receipt (brief §8).
 *
 * The critical rule: what prints is the CENTRAL BLOCK ONLY. Receipts go onto
 * pre-printed letterhead pads that already carry the company header and footer
 * in colour, so printing our own on top would both waste colour toner and
 * double up the branding. The soft form (screen preview, and the QR page that
 * the driver scans) keeps header and footer.
 *
 * Offsets exist because no two printers agree on where the page starts, and the
 * block has to land inside the pad's blank area. They are plain millimetres,
 * calibrated once per printer against a test print.
 */

import type { PrintSettings } from '@suarza/shared';

/** Hidden when printing — the branded header and footer. */
export const SOFT_ONLY_CLASS = 'receipt-soft-only';
/** The block that actually reaches the paper. */
export const PRINT_BLOCK_CLASS = 'receipt-print-block';

function paperSizeCss(settings: PrintSettings): string {
  switch (settings.paper_size) {
    case 'A4':
      return 'A4';
    case 'A5':
      return 'A5';
    case 'LETTER':
      return 'letter';
    case 'CUSTOM':
      return `${settings.custom_width_mm}mm ${settings.custom_height_mm}mm`;
  }
}

/**
 * Built as a string because react-to-print injects it into the print document,
 * which has no access to the app's stylesheet variables.
 */
/**
 * Breathing room down each side of the printed block.
 *
 * Symmetric on purpose. The right side used to carry this on its own while the
 * left took only the calibration offset — which was fine while an operator was
 * setting that offset, and became a visible lopsided page the moment the
 * offsets were fixed at zero: text hard against the left edge, a gap on the
 * right.
 */
const SIDE_MM = 4;

export function buildPageStyle(settings: PrintSettings): string {
  const scale = settings.scale_percent / 100;

  return `
    @page {
      size: ${paperSizeCss(settings)};
      /* Zero here, then the offsets below position the block. Leaving it to
         the browser's default margin would fight the operator's calibration. */
      margin: 0;
    }

    @media print {
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        background: #fff !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .${SOFT_ONLY_CLASS} {
        display: none !important;
      }

      .${PRINT_BLOCK_CLASS} {
        margin: 0 !important;
        border: 0 !important;
        box-shadow: none !important;
        padding-top: ${settings.offset_top_mm}mm;
        /* The offset is calibration — it shifts the block on the pad — and the
           side margin is layout. Added together so one does not swallow the
           other. */
        padding-left: calc(${settings.offset_left_mm}mm + ${SIDE_MM}mm);
        padding-right: ${SIDE_MM}mm;
        transform: scale(${scale});
        transform-origin: top left;
        /* Splitting a weighment across two sheets of a pre-printed pad would
           put the net weight on a page with no header. */
        break-inside: avoid;
        page-break-inside: avoid;
      }
    }
  `;
}

/** A ruled calibration sheet, so offsets are set by measuring, not guessing. */
export function buildTestPrintStyle(settings: PrintSettings): string {
  return `${buildPageStyle(settings)}
    @media print {
      .receipt-test-outline {
        border: 1px dashed #000 !important;
      }
    }
  `;
}
