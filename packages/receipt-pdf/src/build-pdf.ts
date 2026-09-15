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
  KG_PER_MAUND,
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

export interface BuildPdfOptions {
  weighment: Weighment;
  company: PdfCompany;
  /** Encoded into the QR. Omitted when the public domain isn't configured. */
  receiptUrl?: string | null;
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
 * The company logo, shipped with this package.
 *
 * It lives here rather than being passed in by each caller because both Node
 * tiers need the same image and PDFKit needs a file, not a URL — wiring a path
 * through two apps would be two more things to get wrong on a deploy.
 */
function findLogo(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../assets/logo.png'),
    resolve(here, '../../assets/logo.png'),
    resolve(here, 'assets/logo.png'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** Maunds as a trader reads them: `253`, not `253.000`. */
function mann(maund: number): string {
  return maund.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export async function buildReceiptPdf({
  weighment,
  company,
  receiptUrl,
}: BuildPdfOptions): Promise<Buffer> {
  const net = netWeightAllUnits(weighment.first_weight_kg, weighment.second_weight_kg);
  const isComplete = weighment.status === 'COMPLETED';

  // Rendered before the document opens: PDFKit's stream is synchronous once
  // writing begins, and this is the only asynchronous step.
  const qr = receiptUrl
    ? await QRCode.toBuffer(receiptUrl, { margin: 0, width: 240, errorCorrectionLevel: 'M' })
    : null;

  const doc = new PDFDocument({ size: 'A5', margin: MARGIN, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((done, fail) => {
    doc.on('end', () => done(Buffer.concat(chunks)));
    doc.on('error', fail);
  });

  const left = MARGIN;
  const right = doc.page.width - MARGIN;
  const width = right - left;
  let y = MARGIN;

  /* ── helpers ─────────────────────────────────────────────────────────── */

  const box = (x: number, top: number, w: number, h: number, filled = false) => {
    doc.roundedRect(x, top, w, h, RADIUS);
    if (filled) doc.fillColor(BRAND).fill();
    else doc.lineWidth(0.8).strokeColor(BRAND).stroke();
  };

  /** A card's dark title strip, as in the HTML. */
  const cardHead = (x: number, top: number, w: number, h: number, title: string) => {
    doc.save();
    doc.roundedRect(x, top, w, h, RADIUS).clip();
    doc.rect(x, top, w, h).fillColor(BRAND).fill();
    doc.restore();
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor('#ffffff')
      .text(title.toUpperCase(), x, top + h / 2 - 3.5, { width: w, align: 'center', characterSpacing: 0.4 });
  };

  /* ── branded header ──────────────────────────────────────────────────── */

  const logo = findLogo();
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

  const slipH = 30;
  // Filled, to match the screen: the PDF is the soft form. Only the printed pad
  // stays plain ink.
  box(left, y, width, slipH, true);
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(PAPER).text('SLIP NO.', left + 10, y + 7, { characterSpacing: 0.5 });
  doc.font('Helvetica-Bold').fontSize(15).fillColor(PAPER).text(weighment.slip_number, left + 10, y + 14);

  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(PAPER).text('DATE & TIME IN', left, y + 7, {
    width: width - 10,
    align: 'right',
    characterSpacing: 0.5,
  });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PAPER).text(formatDateTimePkt(weighment.first_weight_at), left, y + 16, {
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

  const rows: [string, string][] = [
    ['Customer Name', weighment.customer_name],
    ['Company', weighment.customer_company],
    ['Vehicle Number', weighment.vehicle_plate],
    ['Vehicle Type', vehicleTypeLabel(weighment.vehicle_type)],
    ['Container Number', weighment.container_number ?? '—'],
    ['Phone', weighment.customer_phone ?? '—'],
    ['Product', weighment.product],
  ];

  const rowH = 13;
  const detailH = rows.length * rowH + 10;
  box(left, y, detailW, detailH);

  rows.forEach(([label, value], index) => {
    const rowY = y + 6 + index * rowH;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK).text(label, left + 9, rowY, { width: 72, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(7.5).text(':', left + 84, rowY);
    doc.font('Helvetica').fontSize(8).fillColor(INK).text(value, left + 91, rowY, {
      width: detailW - 100,
      lineBreak: false,
      ellipsis: true,
    });
  });

  const panelH = 30;
  box(panelX, y, panelW, panelH);
  doc.font('Helvetica-Bold').fontSize(6).fillColor(BRAND).text('DATE & TIME OUT', panelX, y + 6, {
    width: panelW,
    align: 'center',
    characterSpacing: 0.5,
  });
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(INK)
    .text(
      weighment.second_weight_at ? formatDateTimePkt(weighment.second_weight_at) : 'Pending',
      panelX,
      y + 16,
      { width: panelW, align: 'center' },
    );

  if (isComplete) {
    const amountY = y + panelH + GAP;
    box(panelX, amountY, panelW, panelH);
    doc.font('Helvetica-Bold').fontSize(6).fillColor(BRAND).text('AMOUNT CHARGED', panelX, amountY + 6, {
      width: panelW,
      align: 'center',
      characterSpacing: 0.5,
    });
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(INK)
      .text(`${formatPKR(weighment.amount_charged)}/-`, panelX, amountY + 15, {
        width: panelW,
        align: 'center',
      });
  }

  y += detailH + GAP;

  /* ── the three weights ───────────────────────────────────────────────── */

  const cardW = (width - GAP * 2) / 3;
  const cardH = isComplete ? 74 : 56;
  const headH = 15;

  const weightCard = (
    x: number,
    title: string,
    at: string | null,
    kg: number | null,
    manual: boolean,
  ) => {
    box(x, y, cardW, cardH);
    cardHead(x, y, cardW, headH, title);
    doc.font('Helvetica').fontSize(6.5).fillColor(MUTED).text(at ? formatDateTimePkt(at) : '—', x, y + headH + 6, {
      width: cardW,
      align: 'center',
    });
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor(INK)
      .text(kg === null ? 'pending' : formatKg(kg), x, y + headH + 16, { width: cardW, align: 'center' });
    if (manual) {
      // Flagged on the paper, not just in the database — the audit trail is no
      // use to someone holding the receipt.
      doc.font('Helvetica-Bold').fontSize(5.5).fillColor(INK).text('(MANUAL ENTRY)', x, y + headH + 32, {
        width: cardW,
        align: 'center',
      });
    }
  };

  weightCard(left, 'First Weight', weighment.first_weight_at, weighment.first_weight_kg, weighment.first_weight_src === 'MANUAL');
  weightCard(left + cardW + GAP, 'Second Weight', weighment.second_weight_at, weighment.second_weight_kg, weighment.second_weight_src === 'MANUAL');

  const netX = left + (cardW + GAP) * 2;
  box(netX, y, cardW, cardH);
  cardHead(netX, y, cardW, headH, 'Net Weight');

  if (isComplete) {
    doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(formatKg(net.kg), netX, y + headH + 6, {
      width: cardW,
      align: 'center',
    });
    doc
      .moveTo(netX + 8, y + headH + 26)
      .lineTo(netX + cardW - 8, y + headH + 26)
      .lineWidth(0.5)
      .strokeColor(BRAND)
      .stroke();
    doc.font('Helvetica-Bold').fontSize(5.5).fillColor(MUTED).text(`NET WEIGHT PER ${KG_PER_MAUND} KG`, netX, y + headH + 30, {
      width: cardW,
      align: 'center',
      characterSpacing: 0.3,
    });
    doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(`${mann(net.maund)} Mann`, netX, y + headH + 38, {
      width: cardW,
      align: 'center',
    });
    doc.font('Helvetica').fontSize(6.5).fillColor(MUTED).text(formatTon(net.ton), netX, y + headH + 51, {
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

  const footH = 52;
  box(left, y, width, footH);

  if (qr) {
    doc.image(qr, left + 9, y + 9, { width: 34 });
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(INK).text('SCAN TO VERIFY', left + 49, y + 14, { characterSpacing: 0.4 });
    doc.font('Helvetica').fontSize(5.5).fillColor(MUTED).text(
      `Operator: ${weighment.operator_username}  ·  Station ${weighment.station_id}`,
      left + 49,
      y + 24,
    );
  } else {
    doc.font('Helvetica').fontSize(6).fillColor(MUTED).text(
      `Operator: ${weighment.operator_username}  ·  Station ${weighment.station_id}`,
      left + 9,
      y + 20,
    );
  }

  const signX = left + width * 0.52;
  const signW = width * 0.48 - 10;
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(INK).text('WEIGHING OFFICER SIGNATURE', signX, y + 12, {
    width: signW,
    align: 'center',
    characterSpacing: 0.4,
  });
  doc
    .moveTo(signX + 6, y + 38)
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
