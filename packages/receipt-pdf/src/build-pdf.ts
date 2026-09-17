/**
 * Receipt PDF, built in memory from the record (brief §8, §15).
 *
 * Deliberately NOT stored: there is no bucket, no S3, no files on the droplet.
 * Every download regenerates from data, so a PDF can never drift from the
 * record it claims to represent, and there is nothing to back up or leak.
 *
 * The layout deliberately mirrors the HTML receipt in `@suarza/ui` — same
 * order, same proportions, same brand green — so a customer who scans the QR,
 * downloads the PDF and is handed the printed slip sees one document, not
 * three. PDFKit draws rather than renders HTML, so the two are kept in step by
 * hand; change one and change the other.
 *
 * It is always the SOFT form — company header and footer included — because
 * whoever downloads a PDF has no pre-printed pad to put it on.
 *
 * One honest difference from the HTML: no Urdu. PDFKit cannot shape Arabic
 * script, so Urdu would come out as disconnected, reversed glyphs. English
 * only is the truthful option until a shaped font is worth the weight.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import {
  formatDateTimePkt,
  formatKg,
  formatPKR,
  formatTon,
  netWeightAllUnits,
  vehicleTypeLabel,
  type Weighment,
} from '@suarza/shared';

export interface PdfCompany {
  /** Optional: a station that has not set one simply shows address and phone. */
  email?: string;
  name: string;
  address: string;
  phone: string;
}

/** What the station actually feeds its printer, so the PDF matches the paper. */
export type PdfPaperSize = 'A4' | 'A5' | 'LETTER';

export interface BuildPdfOptions {
  weighment: Weighment;
  company: PdfCompany;
  /** Encoded into the QR. Omitted when the public domain isn't configured. */
  receiptUrl?: string | null;
  /**
   * Defaults to A5, the size the slip is laid out for. A station printing A4
   * gets A4: the receipt keeps its width and sits at the top of the sheet,
   * rather than being scaled up and looking like a different document.
   */
  paperSize?: PdfPaperSize;
}

/** Matches the HTML receipt's brand green exactly. */
const BRAND = '#155932';
const INK = '#000000';
const PAPER = '#ffffff';
const MUTED = '#4b5563';

/**
 * Line icons, as SVG path data on a 24×24 grid.
 *
 * Deliberately few and deliberately plain: these are read at 8pt on a slip a
 * driver folds into a pocket, so anything with fine detail becomes a smudge.
 */
const ICONS = {
  user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8z'],
  building: ['M4 21h16M6 21V7l6-3.5L18 7v14', 'M9.5 10h1M9.5 14h1M13.5 10h1M13.5 14h1'],
  truck: ['M2 17V7h11v10', 'M13 10h4l3 3.5V17H13', 'M6.5 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', 'M17 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'],
  tag: ['M20.6 13.4 12 22l-9-9V4h9z', 'M7.5 7.5h.01'],
  box: ['M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z', 'M3 7.5 12 12l9-4.5M12 12v9'],
  phone: ['M6 3h4l2 5-2.5 1.5a12 12 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z'],
  leaf: ['M4 20C4 10 10 4 20 4c0 10-6 16-16 16z', 'M9 15c2-3 5-5 8-6'],
  calendar: ['M4 6h16v15H4z', 'M4 11h16M9 3v5M15 3v5'],
  money: ['M2 6h20v12H2z', 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z', 'M5.5 9h.01M18.5 15h.01'],
  scan: ['M8 2h8v20H8z', 'M11 19h2', 'M10.5 6h3v3h-3z'],
  scale: ['M12 3v18M6 21h12', 'M12 6 5.5 14h13z'],
  weight: ['M7 8h10l2 13H5z', 'M12 3a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z'],
  pen: ['M4 20l1-4L17 4l3 3L8 19z', 'M15 6l3 3'],
  hash: ['M5 9h14M5 15h14M10 3 8 21M16 3l-2 18'],
  mail: ['M3 5h18v14H3z', 'm3 6 9 6.5L21 6'],
  pin: ['M12 21s7-6.8 7-11.5A7 7 0 0 0 5 9.5C5 14.2 12 21 12 21z', 'M12 7a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z'],
} as const;

type IconName = keyof typeof ICONS;

const MARGIN = 28;
const GAP = 7;
const RADIUS = 4;

/**
 * An asset shipped with this package — the logo, the Urdu fonts.
 *
 * They live here rather than being passed in by each caller because both Node
 * tiers need the same files and PDFKit needs a path, not a URL — wiring one
 * through two apps would be two more things to get wrong on a deploy. The
 * candidates cover running from `src` (tsx) and from `dist` (built).
 */
function findAsset(name: string): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, `../assets/${name}`),
    resolve(here, `../../assets/${name}`),
    resolve(here, `assets/${name}`),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * The Urdu labels, in the PDF as well as on screen.
 *
 * Naskh rather than the Nastaliq the screen prefers: Nastaliq's cascading
 * ligatures need shaping this renderer does not do well, and at 7pt it would be
 * unreadable anyway. Naskh joins correctly, and the words are the same words.
 *
 * Registered under stable names so the rest of the file can just ask for
 * `urdu`, and the whole thing degrades to English-only if the file is missing
 * rather than throwing on a deploy that forgot to copy assets.
 */
function registerUrduFonts(doc: PDFKit.PDFDocument): boolean {
  const regular = findAsset('NotoNaskhArabic-Regular.ttf');
  const bold = findAsset('NotoNaskhArabic-Bold.ttf');
  if (!regular || !bold) return false;

  try {
    doc.registerFont(URDU, regular);
    doc.registerFont(URDU_BOLD, bold);
    return true;
  } catch {
    return false;
  }
}

const URDU = 'Urdu';
const URDU_BOLD = 'Urdu-Bold';

/** Maunds as a trader reads them: `253`, not `253.000`. */
function mann(maund: number): string {
  return maund.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export async function buildReceiptPdf({
  weighment,
  company,
  receiptUrl,
  paperSize = 'A5',
}: BuildPdfOptions): Promise<Buffer> {
  const net = netWeightAllUnits(weighment.first_weight_kg, weighment.second_weight_kg);
  const isComplete = weighment.status === 'COMPLETED';

  // Rendered before the document opens: PDFKit's stream is synchronous once
  // writing begins, and this is the only asynchronous step.
  const qr = receiptUrl
    ? await QRCode.toBuffer(receiptUrl, { margin: 0, width: 240, errorCorrectionLevel: 'M' })
    : null;

  const doc = new PDFDocument({ size: paperSize, margin: MARGIN, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((done, fail) => {
    doc.on('end', () => done(Buffer.concat(chunks)));
    doc.on('error', fail);
  });

  const hasUrdu = registerUrduFonts(doc);

  // Fixed at the A5 content width on every sheet: the receipt is designed at
  // this measure, and stretching it across A4 would make the two copies of one
  // slip disagree about type size, card widths and line lengths.
  const A5_CONTENT_WIDTH = 420 - MARGIN * 2;

  const width = Math.min(A5_CONTENT_WIDTH, doc.page.width - MARGIN * 2);
  // Centred, so an A4 sheet has even margins rather than a column hugging the
  // left edge.
  const left = Math.round((doc.page.width - width) / 2);
  const right = left + width;
  let y = MARGIN;

  /* ── helpers ─────────────────────────────────────────────────────────── */

  const box = (x: number, top: number, w: number, h: number, filled = false) => {
    doc.roundedRect(x, top, w, h, RADIUS);
    if (filled) doc.fillColor(BRAND).fill();
    else doc.lineWidth(0.8).strokeColor(BRAND).stroke();
  };

  /**
   * One Urdu line. A no-op when the font could not be loaded, so a deploy that
   * lost the assets prints an English-only receipt instead of failing.
   *
   * The word order is reversed before handing the string over. PDFKit's line
   * wrapper splits on spaces and lays the pieces out left to right, so an Urdu
   * phrase comes out with its letters joined correctly but its words in the
   * wrong order — `تاریخ و وقت` printing as `وقت و تاریخ`. Reversing here means
   * that left-to-right placement lands them right-to-left on the page. Single
   * words are unaffected, which is why they looked right all along.
   */
  const urduLine = (
    text: string,
    x: number,
    top: number,
    options: { width: number; align?: 'left' | 'center' | 'right'; size?: number; color?: string },
  ) => {
    if (!hasUrdu) return;
    doc
      .font(URDU)
      .fontSize(options.size ?? 6)
      .fillColor(options.color ?? INK)
      .text(text.split(/\s+/).reverse().join(' '), x, top, {
        width: options.width,
        align: options.align ?? 'center',
        // One line, always: a wrap would re-split the words we just ordered.
        lineBreak: false,
      });
  };

  /**
   * A small line icon beside a label.
   *
   * Drawn as vector paths rather than shipped as images: at 8pt a bitmap turns
   * to mush, and an icon font would be a third font to embed for a dozen
   * glyphs. The paths are on a 24×24 grid — the same grid the screens' icons
   * use — so the two tiers stay recognisably the same product.
   *
   * A label the reader cannot place is worse than none, so every icon here
   * names the thing beside it rather than decorating it.
   */
  const icon = (name: IconName, x: number, top: number, size = 8, color = BRAND) => {
    const paths = ICONS[name];
    const scale = size / 24;

    doc.save();
    doc.translate(x, top).scale(scale);
    // Set inside the scaled space, so the stroke thins with the icon instead
    // of staying 1.8pt and turning a 8pt glyph into a blob.
    doc.lineWidth(1.8).strokeColor(color).lineJoin('round').lineCap('round');
    for (const d of paths) doc.path(d).stroke();
    doc.restore();
  };

  /** A card's dark title strip, as in the HTML. */
  const cardHead = (
    x: number,
    top: number,
    w: number,
    h: number,
    title: string,
    urdu: string,
    name: IconName,
  ) => {
    doc.save();
    doc.roundedRect(x, top, w, h, RADIUS).clip();
    doc.rect(x, top, w, h).fillColor(BRAND).fill();
    doc.restore();

    // Measured, so the icon sits against the title rather than at a guessed
    // offset that drifts as soon as a title changes length.
    const label = title.toUpperCase();
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(PAPER);
    const labelWidth = doc.widthOfString(label, { characterSpacing: 0.4 });
    const labelX = x + (w - labelWidth) / 2;
    icon(name, labelX - 11, top + 2, 8, PAPER);
    doc.text(label, labelX, top + 3, { lineBreak: false, characterSpacing: 0.4 });

    urduLine(urdu, x, top + 11, { width: w, color: PAPER, size: 6.5 });
  };

  /* ── branded header ──────────────────────────────────────────────────── */

  const logo = findAsset('logo.png');
  if (logo) {
    doc.image(logo, left, y, { height: 34 });
  } else {
    doc.font('Helvetica-Bold').fontSize(16).fillColor(BRAND).text(company.name.toUpperCase(), left, y + 8);
  }

  /*
   * Contact details, right-aligned, one line each with its own icon.
   *
   * Drawn line by line rather than as a block so each icon can sit against the
   * line it belongs to — and so the email is simply absent, rather than leaving
   * a gap, on a station that has not set one.
   */
  const contactLines: { icon: IconName; text: string }[] = [
    { icon: 'pin', text: company.address },
    { icon: 'phone', text: company.phone },
    ...(company.email ? [{ icon: 'mail' as IconName, text: company.email }] : []),
  ];

  const contactRight = left + width;
  contactLines.forEach((line, index) => {
    const lineY = y + 3 + index * 10;
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
    const textWidth = doc.widthOfString(line.text);
    doc.text(line.text, contactRight - textWidth, lineY, { lineBreak: false });
    icon(line.icon, contactRight - textWidth - 11, lineY - 1, 8);
  });

  y += 42;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(2).strokeColor(BRAND).stroke();
  y += GAP;

  /* ── slip number + time in ───────────────────────────────────────────── */

  const slipH = 34;
  // Filled, to match the screen: the PDF is the soft form. Only the printed pad
  // stays plain ink.
  box(left, y, width, slipH, true);
  icon('hash', left + 9, y + 5, 8, PAPER);
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(PAPER).text('SLIP NO.', left + 20, y + 6, { characterSpacing: 0.5 });
  urduLine('سلپ نمبر', left + 20, y + 14, { width: 60, align: 'left', color: PAPER, size: 6.5 });
  doc.font('Helvetica-Bold').fontSize(15).fillColor(PAPER).text(weighment.slip_number, left + 82, y + 11);

  const dateLabel = 'DATE & TIME';
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(PAPER);
  const dateLabelWidth = doc.widthOfString(dateLabel, { characterSpacing: 0.5 });
  const dateLabelX = left + width - 10 - dateLabelWidth;
  icon('calendar', dateLabelX - 11, y + 5, 8, PAPER);
  doc.text(dateLabel, dateLabelX, y + 6, { lineBreak: false, characterSpacing: 0.5 });
  urduLine('تاریخ و وقت', left, y + 14, { width: width - 10, align: 'right', color: PAPER, size: 6.5 });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PAPER).text(formatDateTimePkt(weighment.first_weight_at), left, y + 23, {
    width: width - 10,
    align: 'right',
  });
  y += slipH + GAP;

  if (weighment.status === 'VOID') {
    const voidH = 16;
    box(left, y, width, voidH);
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(INK)
      .text(`VOIDED — ${weighment.void_reason ?? 'no reason recorded'}`, left, y + 5, {
        width,
        align: 'center',
      });
    y += voidH + GAP;
  }

  /* ── details (left) + commercial panels (right) ──────────────────────── */

  const detailW = width * 0.6;
  const panelX = left + detailW + GAP;
  const panelW = width - detailW - GAP;

  const rows: { icon: IconName; label: string; urdu: string; value: string }[] = [
    {
      icon: 'user',
      label: 'Customer Name',
      urdu: 'کسٹمر کا نام',
      value: weighment.customer_name || '—',
    },
    { icon: 'building', label: 'Company', urdu: 'کمپنی', value: weighment.customer_company || '—' },
    { icon: 'truck', label: 'Vehicle Number', urdu: 'گاڑی نمبر', value: weighment.vehicle_plate },
    {
      icon: 'tag',
      label: 'Vehicle Type',
      urdu: 'گاڑی کی قسم',
      // The label the slip was made with, like every other tier — a type the
      // manager renames later must not change what an old receipt says.
      value: vehicleTypeLabel(weighment.vehicle_type, weighment.vehicle_type_label),
    },
    {
      icon: 'box',
      label: 'Container Number',
      urdu: 'کنٹینر نمبر',
      value: weighment.container_number ?? '—',
    },
    // The number on the slip is the one to ring about this truck, which is the
    // driver's — so the label says so rather than leaving it to be assumed.
    {
      icon: 'phone',
      label: 'Driver Number',
      urdu: 'ڈرائیور نمبر',
      value: weighment.customer_phone ?? '—',
    },
    { icon: 'leaf', label: 'Product', urdu: 'پروڈکٹ', value: weighment.product || '—' },
  ];

  // Two lines per row once the Urdu is there, so the row has to grow with it.
  const rowH = hasUrdu ? 18 : 13;
  const detailH = rows.length * rowH + 10;
  box(left, y, detailW, detailH);

  rows.forEach((row, index) => {
    const rowY = y + 6 + index * rowH;
    icon(row.icon, left + 8, rowY, 8.5);
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(INK)
      .text(row.label, left + 20, rowY, { width: 76, lineBreak: false });
    urduLine(row.urdu, left + 20, rowY + 8, { width: 76, align: 'left', size: 6, color: MUTED });
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK).text(':', left + 99, rowY);
    doc.font('Helvetica').fontSize(8).fillColor(INK).text(row.value, left + 106, rowY, {
      width: detailW - 115,
      lineBreak: false,
      ellipsis: true,
    });
  });

  // No Urdu line under the amount any more, so the panel is back to the height
  // the figure and its paid/unpaid marker actually need.
  const panelH = 48;
  let panelY = y;

  if (isComplete) {
    box(panelX, panelY, panelW, panelH);
    const amountLabel = 'AMOUNT CHARGED';
    doc.font('Helvetica-Bold').fontSize(6).fillColor(BRAND);
    const amountLabelWidth = doc.widthOfString(amountLabel, { characterSpacing: 0.5 });
    const amountLabelX = panelX + (panelW - amountLabelWidth) / 2;
    icon('money', amountLabelX - 11, panelY + 5, 8);
    doc.text(amountLabel, amountLabelX, panelY + 6, { lineBreak: false, characterSpacing: 0.5 });

    // As big as the net weight: it is read just as often, and by the person
    // paying it.
    doc
      .font('Helvetica-Bold')
      .fontSize(19)
      .fillColor(INK)
      .text(`${formatPKR(weighment.amount_charged)}/-`, panelX, panelY + 17, {
        width: panelW,
        align: 'center',
      });

    // Whether it was actually paid — the question that gets argued about later.
    const paid = weighment.payment_status === 'PAID';
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor(paid ? BRAND : INK)
      .text(paid ? 'PAID' : 'ON ACCOUNT', panelX, panelY + 37, {
        width: panelW,
        align: 'center',
        characterSpacing: 0.5,
      });

    panelY += panelH + GAP;
  }

  // The QR lives under the amount rather than along the foot of the slip: this
  // column has the room, and the space it frees below goes to the weights.
  if (qr) {
    /*
     * Stretched to the foot of the details beside it.
     *
     * A fixed height left a gap under this column while the details ran on
     * past it — the two are one band of the slip and should end level, as they
     * do on screen where the browser's grid handles it. Here the arithmetic is
     * ours to do.
     */
    const qrH = Math.max(60, y + detailH - panelY);
    box(panelX, panelY, panelW, qrH);

    const scanLabel = 'SCAN TO VERIFY';
    doc.font('Helvetica-Bold').fontSize(6).fillColor(BRAND);
    const scanWidth = doc.widthOfString(scanLabel, { characterSpacing: 0.5 });
    const scanX = panelX + (panelW - scanWidth) / 2;
    icon('scan', scanX - 11, panelY + 5, 8);
    doc.text(scanLabel, scanX, panelY + 6, { lineBreak: false, characterSpacing: 0.5 });

    const qrSize = 40;
    // Centred in whatever the stretch left under the caption, rather than
    // pinned to the top with the slack all at the bottom.
    const qrTop = panelY + 16 + Math.max(0, (qrH - 16 - qrSize - 6) / 2);
    doc.image(qr, panelX + (panelW - qrSize) / 2, qrTop, { width: qrSize });
  }

  y += detailH + GAP;

  /* ── the three weights ───────────────────────────────────────────────── */

  const cardW = (width - GAP * 2) / 3;
  const headH = hasUrdu ? 21 : 15;
  const cardH = isComplete ? 86 : 52;

  const weightCard = (
    x: number,
    title: string,
    urdu: string,
    at: string | null,
    kg: number | null,
    manual: boolean,
  ) => {
    box(x, y, cardW, cardH);
    cardHead(x, y, cardW, headH, title, urdu, 'scale');
    doc.font('Helvetica').fontSize(6.5).fillColor(MUTED).text(at ? formatDateTimePkt(at) : '—', x, y + headH + 6, {
      width: cardW,
      align: 'center',
    });
    doc
      .font('Helvetica-Bold')
      .fontSize(17)
      .fillColor(INK)
      .text(kg === null ? 'pending' : formatKg(kg), x, y + headH + 14, { width: cardW, align: 'center' });
    if (manual) {
      // Flagged on the paper, not just in the database — the audit trail is no
      // use to someone holding the receipt.
      doc.font('Helvetica-Bold').fontSize(5.5).fillColor(INK).text('(MANUAL ENTRY)', x, y + headH + 34, {
        width: cardW,
        align: 'center',
      });
    }
  };

  weightCard(left, 'First Weight', 'پہلا وزن', weighment.first_weight_at, weighment.first_weight_kg, weighment.first_weight_src === 'MANUAL');
  weightCard(left + cardW + GAP, 'Second Weight', 'دوسرا وزن', weighment.second_weight_at, weighment.second_weight_kg, weighment.second_weight_src === 'MANUAL');

  const netX = left + (cardW + GAP) * 2;
  box(netX, y, cardW, cardH);
  cardHead(netX, y, cardW, headH, 'Net Weight', 'صافی وزن', 'weight');

  if (isComplete) {
    doc.font('Helvetica-Bold').fontSize(19).fillColor(INK).text(formatKg(net.kg), netX, y + headH + 4, {
      width: cardW,
      align: 'center',
    });
    const ruleY = y + headH + 28;
    doc
      .moveTo(netX + 8, ruleY)
      .lineTo(netX + cardW - 8, ruleY)
      .lineWidth(0.5)
      .strokeColor(BRAND)
      .stroke();
    // No "per 40 kg" caption: the `Mann` beside the number already says it.
    doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(`${mann(net.maund)} Mann`, netX, ruleY + 5, {
      width: cardW,
      align: 'center',
    });
    doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(formatTon(net.ton), netX, ruleY + 24, {
      width: cardW,
      align: 'center',
    });
  } else {
    doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED).text('Pending second weighing', netX, y + headH + 16, {
      width: cardW,
      align: 'center',
    });
  }

  y += cardH + GAP;


  /* ── branded footer ──────────────────────────────────────────────────── */

  doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(BRAND).stroke();
  /*
   * The closing line only.
   *
   * No contact details and no operator name: the header carries the first a few
   * centimetres above, and the second was never something the customer's copy
   * needed — it stays recorded against the weighment.
   */
  doc
    .font('Helvetica')
    .fontSize(6.5)
    .fillColor(MUTED)
    .text(
      'This receipt is generated from the weighbridge record and is valid without a signature.',
      left,
      y + 6,
      { width, align: 'center' },
    );

  doc.end();
  return finished;
}

/** Filename the browser saves it as. */
export function pdfFileName(weighment: Weighment): string {
  return `${weighment.slip_number}-receipt.pdf`;
}
