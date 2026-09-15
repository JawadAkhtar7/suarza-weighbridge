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

import { Router } from 'express';
import { normalizeSlipNumber } from '@suarza/shared';
import type { ServerConfig } from '../config.js';
import { findBySlip } from '../services/weighment.service.js';
import { renderNotFoundPage, renderReceiptPage } from '../receipt/render-page.js';
import { buildReceiptPdf, pdfFileName } from '@suarza/receipt-pdf';

export function receiptRouter(config: ServerConfig): Router {
  const router = Router();

  const company = {
    name: config.COMPANY_NAME,
    address: config.COMPANY_ADDRESS,
    phone: config.COMPANY_PHONE,
    // The bundled logo is the default; COMPANY_LOGO_URL overrides it.
    logoUrl: config.COMPANY_LOGO_URL || '/logo.png',
  };

  const pageUrl = (slip: string) =>
    `${config.APP_DOMAIN.replace(/\/+$/, '')}/r/${encodeURIComponent(slip)}`;

  /**
   * The public page's only script: one click handler.
   *
   * Served as a file rather than inlined because the page's CSP allows
   * `script-src 'self'`, and loosening that to 'unsafe-inline' for one button
   * on a page anyone on the internet can open is not a trade worth making.
   */
  router.get('/r/receipt-page.js', (_req, res) => {
    res
      .type('application/javascript')
      .set('Cache-Control', 'public, max-age=3600')
      .send("document.getElementById('print-receipt')?.addEventListener('click',()=>window.print());");
  });

  router.get('/r/:slip', async (req, res) => {
    const slip = normalizeSlipNumber(req.params.slip);
    const weighment = slip ? await findBySlip(slip) : null;

    if (!weighment) {
      // 404 with a page, not a bare status: this is read on a phone by someone
      // who just scanned a code, and "not synced yet" is a normal answer.
      res
        .status(404)
        .type('html')
        .send(renderNotFoundPage(slip || req.params.slip, company.name));
      return;
    }

    res
      .type('html')
      // Regenerated every visit; caching it would show a stale receipt after a
      // correction reached the cloud.
      .set('Cache-Control', 'no-store')
      .send(
        renderReceiptPage({
          weighment,
          company,
          pageUrl: weighment.slip_number ? pageUrl(weighment.slip_number) : '',
        }),
      );
  });

  router.get('/r/:slip/pdf', async (req, res) => {
    const slip = normalizeSlipNumber(req.params.slip);
    const weighment = slip ? await findBySlip(slip) : null;

    if (!weighment) {
      res
        .status(404)
        .type('html')
        .send(renderNotFoundPage(slip || req.params.slip, company.name));
      return;
    }

    const pdf = await buildReceiptPdf({
      weighment,
      company,
      receiptUrl: pageUrl(weighment.slip_number),
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
