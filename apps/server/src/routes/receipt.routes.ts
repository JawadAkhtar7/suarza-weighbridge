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
import { COMPANY, SHIFT_LABELS, normalizeSlipNumber, shiftAt } from '@suarza/shared';
import type { Weighment } from '@suarza/shared';
import type { ServerConfig } from '../config.js';
import { findBySlip } from '../services/weighment.service.js';
import { renderNotFoundPage } from '../receipt/render-page.js';
import { cameraFramingForStation } from '../services/station.service.js';
import { operatorNamesByUsername, shiftTimings } from '../services/roster.service.js';
import { renderSlipPage, slipValues } from '@suarza/ui';
import { createReadStream, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findCapture,
  imagesForWeighment,
  resolveCapturePath,
  captureFileExists,
} from '../services/capture.service.js';

/** Where the slip page's share and download scripts are served from. */
const SHARE_SCRIPTS = {
  library: '/r-assets/html-to-image.js',
  share: '/r-assets/slip-share.js',
} as const;

/* html-to-image's single-file browser build, straight from its package. */
const HTML_TO_IMAGE_FILE = createRequire(import.meta.url).resolve(
  'html-to-image/dist/html-to-image.js',
);

/*
 * public/slip-share.js, found from wherever this module runs: src/routes/ in
 * development, the bundled dist/ in production — or the working directory.
 */
const SLIP_SHARE_FILE = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  return (
    [
      resolve(process.cwd(), 'public', 'slip-share.js'),
      resolve(here, '..', 'public', 'slip-share.js'),
      resolve(here, '..', '..', 'public', 'slip-share.js'),
    ].find((path) => existsSync(path)) ?? null
  );
})();

/**
 * Who weighed this slip, as the soft copy names them.
 *
 * Two lookups rather than one because they answer different questions: the
 * roster turns the record's username into a person, and the shift hours turn
 * the record's own clock into a shift. Null for a slip from before anybody
 * signed in at the bridge, and the line is then simply absent.
 */
async function operatorForSlip(
  weighment: Weighment,
): Promise<{ name: string; shift: string } | null> {
  const names = await operatorNamesByUsername();
  const name = names.get(weighment.operator_username.trim().toLowerCase());
  if (!name) return null;

  const hours = await shiftTimings();
  return { name, shift: SHIFT_LABELS[shiftAt(new Date(weighment.first_weight_at), hours)] };
}

export function receiptRouter(config: ServerConfig): Router {
  const router = Router();

  /**
   * A tighter CSP than the rest of the server runs, for the one page the whole
   * internet can open.
   *
   * Scripts only from this server, by address — the share and download
   * buttons' two files under /r-assets/ — and never inline, so nothing
   * injected into the markup could run. Those scripts draw the page's own
   * slip into an image: they read its pictures (`connect-src 'self'`, and
   * `data:` for the artwork already inside the page), paint them through a
   * `data:` image, and hand the result over as a `blob:` file.
   *
   * Nothing from anywhere else: the slip's artwork and its four font families
   * travel inside the document as data URIs.
   */
  const lockDown = (res: Response) =>
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        "script-src 'self'",
        "connect-src 'self' data:",
        "img-src 'self' data: blob:",
        'font-src data:',
        "style-src 'unsafe-inline'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    );

  /*
   * The share and download buttons' scripts. Their own short cache: a fixed
   * address, so a phone must not hold on to an old copy for long.
   */
  const assetHeaders = (res: Response) =>
    res.type('application/javascript').set('Cache-Control', 'public, max-age=3600');
  /* `dotfiles: 'allow'` because pnpm keeps packages under node_modules/.pnpm,
     and Express otherwise refuses any path with a dot-folder in it — two
     fixed files named here, never a path taken from a request. */
  router.get(SHARE_SCRIPTS.library, (_req, res) => {
    assetHeaders(res).sendFile(HTML_TO_IMAGE_FILE, { dotfiles: 'allow' });
  });
  router.get(SHARE_SCRIPTS.share, (_req, res) => {
    if (!SLIP_SHARE_FILE) {
      res.status(404).end();
      return;
    }
    assetHeaders(res).sendFile(SLIP_SHARE_FILE, { dotfiles: 'allow' });
  });

  const pageUrl = (slip: string) =>
    `${config.APP_DOMAIN.replace(/\/+$/, '')}/r/${encodeURIComponent(slip)}`;

  /**
   * What a scanned QR code leads to: the slip itself, as a page.
   *
   * It used to redirect to a generated PDF. That PDF was drawn a second time by
   * hand with PDFKit, which cannot shape Arabic script — so it silently dropped
   * every Urdu label the client's design is built on, and it could never be
   * made to match the paper slip. This page IS the slip: the same component,
   * the same coordinates, the same artwork. Its share and download buttons
   * make the PDF and the image from this very page, on the phone
   * (public/slip-share.js), so the files cannot disagree with it either.
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

    /* The truck's own pictures, if the bridge that weighed it has cameras and
       has managed to send them up. Absent is the ordinary case for a slip
       made minutes ago on a bad link, and the placeholder stands in. */
    const images = await imagesForWeighment(weighment.id);
    /* The bridge that weighed this truck decides how its pictures are
       framed, so the page a customer scans shows what the paper shows. */
    const framing = await cameraFramingForStation(weighment.station_id);

    lockDown(res);
    res
      .status(200)
      .type('html')
      /* Never cached: a slip can be corrected in the cloud, and a phone holding
         yesterday's copy of it is the one thing this page must not do. */
      .set('Cache-Control', 'no-store')
      /* Say it out loud: display this, do not save it.
         The content type already says text/html, but some scanner apps open
         their own cut-down webview and hand anything without an explicit
         disposition to the download manager — which is how a page ends up
         saved as a file instead of shown. */
      .set('Content-Disposition', 'inline')
      .send(
        renderSlipPage({
          view: 'soft',
          title: `${weighment.slip_number} — Weight Bridge Slip`,
          /* Who weighed it, on the soft copy the customer scans — resolved
             from the roster, because the record keeps a username and a
             username is not a thing to put in front of a customer. */
          values: slipValues({ weighment, operator: await operatorForSlip(weighment) }),
          verifyUrl: pageUrl(weighment.slip_number),
          frontImageUrl: images.front ? `/captures/${images.front}` : undefined,
          sideImageUrl: images.side ? `/captures/${images.side}` : undefined,
          frontViewFrame: framing.front,
          sideViewFrame: framing.side,
          /* Share as PDF / Download PDF / Share as image / Download image,
             for the customer holding the paper. */
          shareActions: {
            fileName: `Weight-Bridge-Slip-${weighment.slip_number}`,
            scripts: [SHARE_SCRIPTS.library, SHARE_SCRIPTS.share],
          },
        }),
      );
  });

  /**
   * A stored still.
   *
   * Public, like the slip page that embeds it — a driver scanning the QR on
   * his own receipt has no login, and the id is a UUID nobody can guess.
   *
   * A row whose file has gone — pruned, or a disk restored without it — is a
   * 404 rather than a 500. A missing picture is an ordinary state and the
   * slip falls back to the placeholder around it.
   */
  router.get('/captures/:id', async (req, res) => {
    const row = await findCapture(String(req.params['id'] ?? ''));
    if (!row || !(await captureFileExists(row.path))) {
      res.status(404).json({ error: { code: 'NOT_FOUND' } });
      return;
    }

    const absolute = resolveCapturePath(row.path);
    if (!absolute) {
      res.status(404).json({ error: { code: 'NOT_FOUND' } });
      return;
    }

    /* Immutable: the id names one picture and that picture never changes, so
       a phone that has seen it once need never fetch it again. */
    res.status(200).type('image/jpeg').set('Cache-Control', 'public, max-age=31536000, immutable');
    createReadStream(absolute).pipe(res);
  });

  /**
   * The old PDF address, kept working.
   *
   * Every slip printed before today carries a QR that leads to `/r/:slip`, and
   * some of those were served as a redirect to this path — a phone that cached
   * it must still land somewhere useful rather than on a 404.
   */
  router.get('/r/:slip/pdf', (req, res) => {
    res.set('Cache-Control', 'no-store').redirect(302, `/r/${encodeURIComponent(req.params.slip)}`);
  });

  return router;
}
