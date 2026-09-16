/**
 * Public QR receipt routes (brief §8, §13-M5).
 *
 * Deliberately unauthenticated: the audience is a driver holding a paper slip
 * with a QR on it, who has no account and never will. The slip number is the
 * only thing they have, so it is the only thing required — and it is why these
 * routes are read-only, expose no list, and are marked noindex.
 *
 * Nothing is persisted: both routes rebuild from the database record on every
 * request (brief §15 — no file storage, by design).
 */

import { Router, type Response } from 'express';
import { normalizeSlipNumber } from '@suarza/shared';
import type { ServerConfig } from '../config.js';
import { findBySlip } from '../services/weighment.service.js';
import { renderNotFoundPage } from '../receipt/render-page.js';
import { buildReceiptPdf, pdfFileName } from '@suarza/receipt-pdf';
import { companyForStation, paperForStation } from '../services/station.service.js';

export function receiptRouter(config: ServerConfig): Router {
  const router = Router();

  /** Used until the station that made the slip has told us its own details. */
  const fallbackCompany = {
    name: config.COMPANY_NAME,
    address: config.COMPANY_ADDRESS,
    phone: config.COMPANY_PHONE,
    // The bundled logo is the default; COMPANY_LOGO_URL overrides it.
    logoUrl: config.COMPANY_LOGO_URL || '/logo.png',
  };

  /**
   * A tighter CSP than the rest of the server runs, for the one page the whole
   * internet can open.
   *
   * It became possible only when the print button went: the page now has no
   * JavaScript at all, so it can say so. `script-src 'none'` means that even if
   * something were ever injected into this markup, there is nothing to execute
   * it. The allowances that remain are exactly what the page uses — its inline
   * stylesheet, the logo, and the QR as a data URI.
   */
  const lockDown = (res: Response) =>
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        "img-src 'self' data:",
        "style-src 'unsafe-inline'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    );

  const pageUrl = (slip: string) =>
    `${config.APP_DOMAIN.replace(/\/+$/, '')}/r/${encodeURIComponent(slip)}`;

  /**
   * What a scanned QR code leads to: the PDF itself.
   *
   * A redirect rather than a page with a download button. The driver scanned a
   * code to get their receipt, and a page in between was a step that only ever
   * had one thing on it worth pressing.
   */
  router.get('/r/:slip', async (req, res) => {
    const slip = normalizeSlipNumber(req.params.slip);
    const weighment = slip ? await findBySlip(slip) : null;

    if (!weighment) {
      // 404 with a page, not a bare status: this is read on a phone by someone
      // who just scanned a code, and "not synced yet" is a normal answer that
      // deserves an explanation rather than a browser error.
      lockDown(res);
      res
        .status(404)
        .type('html')
        .set('Cache-Control', 'no-store')
        .send(renderNotFoundPage(slip || req.params.slip, fallbackCompany.name));
      return;
    }

    // 302, not 301: a slip corrected in the cloud must not keep being served
    // from a redirect a phone cached permanently.
    res
      .set('Cache-Control', 'no-store')
      .redirect(302, `/r/${encodeURIComponent(weighment.slip_number)}/pdf`);
  });

  router.get('/r/:slip/pdf', async (req, res) => {
    const slip = normalizeSlipNumber(req.params.slip);
    const weighment = slip ? await findBySlip(slip) : null;

    if (!weighment) {
      lockDown(res);
      res
        .status(404)
        .type('html')
        .send(renderNotFoundPage(slip || req.params.slip, fallbackCompany.name));
      return;
    }

    const pdf = await buildReceiptPdf({
      weighment,
      company: await companyForStation(weighment.station_id, fallbackCompany),
      receiptUrl: pageUrl(weighment.slip_number),
      paperSize: await paperForStation(weighment.station_id),
    });

    res
      .status(200)
      .type('application/pdf')
      .set('Content-Disposition', `attachment; filename="${pdfFileName(weighment)}"`)
      .set('Content-Length', String(pdf.byteLength))
      .set('Cache-Control', 'no-store')
      .send(pdf);
  });

  return router;
}
