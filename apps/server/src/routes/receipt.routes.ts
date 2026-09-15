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
import { buildReceiptPdf, pdfFileName, type PdfPaperSize } from '@suarza/receipt-pdf';
import { StationModel } from '../models/station.model.js';

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
   * The company details as the station that produced this slip knows them.
   *
   * They come from the agent's Settings screen and arrive with the sync
   * batches, so the page behind a QR code shows exactly what is printed on the
   * paper the customer is holding. COMPANY_* remains only as the answer for a
   * station that has never synced.
   *
   * Each field falls back independently: a station that has filled in an
   * address but not a phone should show the real address, not be pushed wholly
   * back to placeholders.
   */
  async function companyFor(stationId: string | null | undefined) {
    if (!stationId) return fallbackCompany;

    const station = await StationModel.findById(stationId).lean();
    if (!station) return fallbackCompany;

    return {
      name: station.company_name || fallbackCompany.name,
      address: station.company_address || fallbackCompany.address,
      phone: station.company_phone || fallbackCompany.phone,
      logoUrl: station.company_logo_url || fallbackCompany.logoUrl,
    };
  }

  /** The paper this slip's station prints on; A5 until it has told us. */
  async function paperFor(stationId: string | null | undefined): Promise<PdfPaperSize> {
    if (!stationId) return 'A5';
    const station = await StationModel.findById(stationId).lean();
    return (station?.paper_size as PdfPaperSize | undefined) ?? 'A5';
  }

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
        .send(renderNotFoundPage(slip || req.params.slip, fallbackCompany.name));
      return;
    }

    const company = await companyFor(weighment.station_id);

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
        .send(renderNotFoundPage(slip || req.params.slip, fallbackCompany.name));
      return;
    }

    const pdf = await buildReceiptPdf({
      weighment,
      company: await companyFor(weighment.station_id),
      receiptUrl: pageUrl(weighment.slip_number),
      paperSize: await paperFor(weighment.station_id),
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
