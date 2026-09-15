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

  /** A card's dark title strip, as in the HTML. */
  const cardHead = (x: number, top: number, w: number, h: number, title: string, urdu: string) => {
    doc.save();
    doc.roundedRect(x, top, w, h, RADIUS).clip();
    doc.rect(x, top, w, h).fillColor(BRAND).fill();
    doc.restore();
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor('#ffffff')
      .text(title.toUpperCase(), x, top + 3, { width: w, align: 'center', characterSpacing: 0.4 });
    urduLine(urdu, x, top + 11, { width: w, color: '#ffffff', size: 6.5 });
  };

  /* ── branded header ──────────────────────────────────────────────────── */

  const logo = findAsset('logo.png');
  if (logo) {
    doc.image(logo, left, y, { height: 34 });
  } else {
    doc.font('Helvetica-Bold').fontSize(16).fillColor(BRAND).text(company.name.toUpperCase(), left, y + 8);
  }

  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(MUTED)
    .text(company.address, left + (logo ? 150 : 0), y + 8, { width: width - (logo ? 150 : 0), align: 'right' })
    .text(company.phone, { width: width - (logo ? 150 : 0), align: 'right' });

  y += 42;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(2).strokeColor(BRAND).stroke();
  y += GAP;

  /* ── slip number + time in ───────────────────────────────────────────── */

  const slipH = 34;
  // Filled, to match the screen: the PDF is the soft form. Only the printed pad
  // stays plain ink.
  box(left, y, width, slipH, true);
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(PAPER).text('SLIP NO.', left + 10, y + 6, { characterSpacing: 0.5 });
  urduLine('سلپ نمبر', left + 10, y + 14, { width: 60, align: 'left', color: PAPER, size: 6.5 });
  doc.font('Helvetica-Bold').fontSize(15).fillColor(PAPER).text(weighment.slip_number, left + 72, y + 11);

  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(PAPER).text('DATE & TIME', left, y + 6, {
    width: width - 10,
    align: 'right',
    characterSpacing: 0.5,
  });
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

  const rows: [string, string, string][] = [
    ['Customer Name', 'کسٹمر کا نام', weighment.customer_name],
    ['Company', 'کمپنی', weighment.customer_company || '—'],
    ['Vehicle Number', 'گاڑی نمبر', weighment.vehicle_plate],
    ['Vehicle Type', 'گاڑی کی قسم', vehicleTypeLabel(weighment.vehicle_type)],
    ['Container Number', 'کنٹینر نمبر', weighment.container_number ?? '—'],
    ['Phone', 'فون نمبر', weighment.customer_phone ?? '—'],
    ['Product', 'پروڈکٹ', weighment.product],
  ];

  // Two lines per row once the Urdu is there, so the row has to grow with it.
  const rowH = hasUrdu ? 18 : 13;
  const detailH = rows.length * rowH + 10;
  box(left, y, detailW, detailH);

  rows.forEach(([label, urdu, value], index) => {
    const rowY = y + 6 + index * rowH;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK).text(label, left + 9, rowY, { width: 72, lineBreak: false });
    urduLine(urdu, left + 9, rowY + 8, { width: 72, align: 'left', size: 6, color: MUTED });
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK).text(':', left + 84, rowY);
    doc.font('Helvetica').fontSize(8).fillColor(INK).text(value, left + 91, rowY, {
      width: detailW - 100,
      lineBreak: false,
      ellipsis: true,
    });
  });

  const panelH = hasUrdu ? 54 : 38;
  let panelY = y;

  if (isComplete) {
    box(panelX, panelY, panelW, panelH);
    doc.font('Helvetica-Bold').fontSize(6).fillColor(BRAND).text('AMOUNT CHARGED', panelX, panelY + 6, {
      width: panelW,
      align: 'center',
      characterSpacing: 0.5,
    });
    urduLine('چارج شدہ رقم', panelX, panelY + 15, { width: panelW, size: 7.5 });
    // As big as the net weight: it is read just as often, and by the person
    // paying it.
    doc
      .font('Helvetica-Bold')
      .fontSize(19)
      .fillColor(INK)
      .text(`${formatPKR(weighment.amount_charged)}/-`, panelX, panelY + (hasUrdu ? 30 : 16), {
        width: panelW,
        align: 'center',
      });
    panelY += panelH + GAP;
  }

  // The QR lives under the amount rather than along the foot of the slip: this
  // column has the room, and the space it frees below goes to the weights.
  if (qr) {
    const qrH = hasUrdu ? 72 : 58;
    box(panelX, panelY, panelW, qrH);
    doc.font('Helvetica-Bold').fontSize(6).fillColor(BRAND).text('SCAN TO VERIFY', panelX, panelY + 6, {
      width: panelW,
      align: 'center',
      characterSpacing: 0.5,
    });
    urduLine('تصدیق کے لیے اسکین کریں', panelX, panelY + 15, { width: panelW, size: 7.5 });
    const qrSize = 40;
    doc.image(qr, panelX + (panelW - qrSize) / 2, panelY + (hasUrdu ? 29 : 16), { width: qrSize });
  }

  y += detailH + GAP;

  /* ── the three weights ───────────────────────────────────────────────── */

  const cardW = (width - GAP * 2) / 3;
  const headH = hasUrdu ? 21 : 15;
  const cardH = (isComplete ? 82 : 58) + (hasUrdu ? 14 : 0);

  const weightCard = (
    x: number,
    title: string,
    urdu: string,
    at: string | null,
    kg: number | null,
    manual: boolean,
  ) => {
    box(x, y, cardW, cardH);
    cardHead(x, y, cardW, headH, title, urdu);
    doc.font('Helvetica').fontSize(6.5).fillColor(MUTED).text(at ? formatDateTimePkt(at) : '—', x, y + headH + 6, {
      width: cardW,
      align: 'center',
    });
    doc
      .font('Helvetica-Bold')
      .fontSize(17)
      .fillColor(INK)
      .text(kg === null ? 'pending' : formatKg(kg), x, y + headH + 14, { width: cardW, align: 'center' });
    urduLine('کلوگرام', x, y + headH + 33, { width: cardW, size: 6, color: MUTED });
    if (manual) {
      // Flagged on the paper, not just in the database — the audit trail is no
      // use to someone holding the receipt.
      doc.font('Helvetica-Bold').fontSize(5.5).fillColor(INK).text('(MANUAL ENTRY)', x, y + headH + (hasUrdu ? 45 : 36), {
        width: cardW,
        align: 'center',
      });
    }
  };

  weightCard(left, 'First Weight', 'پہلا وزن', weighment.first_weight_at, weighment.first_weight_kg, weighment.first_weight_src === 'MANUAL');
  weightCard(left + cardW + GAP, 'Second Weight', 'دوسرا وزن', weighment.second_weight_at, weighment.second_weight_kg, weighment.second_weight_src === 'MANUAL');

  const netX = left + (cardW + GAP) * 2;
  box(netX, y, cardW, cardH);
  cardHead(netX, y, cardW, headH, 'Net Weight', 'خالص وزن');

  if (isComplete) {
    doc.font('Helvetica-Bold').fontSize(19).fillColor(INK).text(formatKg(net.kg), netX, y + headH + 4, {
      width: cardW,
      align: 'center',
    });
    urduLine('کلوگرام', netX, y + headH + 25, { width: cardW, size: 6, color: MUTED });
    const ruleY = y + headH + (hasUrdu ? 36 : 28);
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
    urduLine('من', netX, ruleY + 25, { width: cardW, size: 6, color: MUTED });
    doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(formatTon(net.ton), netX, ruleY + (hasUrdu ? 36 : 20), {
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

  /* ── QR + signature ──────────────────────────────────────────────────── */

  const footH = 44;
  box(left, y, width, footH);

  doc.font('Helvetica').fontSize(6).fillColor(MUTED).text(
    `Operator: ${weighment.operator_username}  ·  Station ${weighment.station_id}`,
    left + 9,
    y + 18,
  );

  const signX = left + width * 0.52;
  const signW = width * 0.48 - 10;
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(INK).text('WEIGHING OFFICER SIGNATURE', signX, y + 8, {
    width: signW,
    align: 'center',
    characterSpacing: 0.4,
  });
  urduLine('وزن کرنے والے افسر کے دستخط', signX, y + 17, { width: signW, size: 6.5 });
  doc
    .moveTo(signX + 6, y + 32)
    .lineTo(signX + signW - 6, y + 38)
    .dash(2, { space: 2 })
    .lineWidth(0.6)
    .strokeColor(MUTED)
    .stroke()
    .undash();

  y += footH + GAP;

  /* ── branded footer ──────────────────────────────────────────────────── */

  doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(BRAND).stroke();
  doc.font('Helvetica').fontSize(6.5).fillColor(MUTED).text(`${company.name}  ·  ${company.phone}`, left, y + 6, {
    width,
    align: 'center',
  });
  doc.text(
    'This receipt is generated from the weighbridge record and is valid without a signature.',
    left,
    y + 15,
    { width, align: 'center' },
  );

  doc.end();
  return finished;
}

/** Filename the browser saves it as. */
export function pdfFileName(weighment: Weighment): string {
  return `${weighment.slip_number}-receipt.pdf`;
}
