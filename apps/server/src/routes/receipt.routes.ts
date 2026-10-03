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
import { COMPANY, normalizeSlipNumber } from '@suarza/shared';
import type { ServerConfig } from '../config.js';
import { findBySlip } from '../services/weighment.service.js';
import { renderNotFoundPage } from '../receipt/render-page.js';
import { renderSlipPage, slipValues } from '@suarza/ui';

export function receiptRouter(config: ServerConfig): Router {
  const router = Router();

  /**
   * A tighter CSP than the rest of the server runs, for the one page the whole
   * internet can open.
   *
   * The page still has no JavaScript at all, so it can say so. `script-src
   * 'none'` means that even if something were ever injected into this markup,
   * there is nothing to execute it.
   *
   * It needs nothing from the network either: the slip's artwork and its four
   * font families travel inside the document as data URIs, which is why
   * `img-src` and `font-src` allow `data:` and nothing else allows anything.
   */
  const lockDown = (res: Response) =>
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        "img-src 'self' data:",
        "font-src data:",
        "style-src 'unsafe-inline'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    );

  const pageUrl = (slip: string) =>
    `${config.APP_DOMAIN.replace(/\/+$/, '')}/r/${encodeURIComponent(slip)}`;

  /**
   * What a scanned QR code leads to: the slip itself, as a page.
   *
   * It used to redirect to a generated PDF. That PDF was drawn a second time by
   * hand with PDFKit, which cannot shape Arabic script — so it silently dropped
   * every Urdu label the client's design is built on, and it could never be
   * made to match the paper slip. This page IS the slip: the same component,
   * the same coordinates, the same artwork. Anyone who wants a file uses their
   * browser's "Save as PDF", which at A5 produces it exactly.
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
        .send(renderNotFoundPage(slip || req.params.slip, COMPANY.name));
      return;
    }

    lockDown(res);
    res
      .status(200)
      .type('html')
      /* Never cached: a slip can be corrected in the cloud, and a phone holding
         yesterday's copy of it is the one thing this page must not do. */
      .set('Cache-Control', 'no-store')
      .send(
        renderSlipPage({
          view: 'soft',
          title: `${weighment.slip_number} — Weight Bridge Slip`,
          values: slipValues({ weighment }),
          verifyUrl: pageUrl(weighment.slip_number),
        }),
      );
  });

  /**
   * The old PDF address, kept working.
   *
   * Every slip printed before today carries a QR that leads to `/r/:slip`, and
   * some of those were served as a redirect to this path — a phone that cached
   * it must still land somewhere useful rather than on a 404.
   */
  router.get('/r/:slip/pdf', (req, res) => {
    res
      .set('Cache-Control', 'no-store')
      .redirect(302, `/r/${encodeURIComponent(req.params.slip)}`);
  });

  return router;
}
