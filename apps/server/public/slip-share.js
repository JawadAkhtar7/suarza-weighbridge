// @ts-check
/**
 * Share and download for the slip page behind the QR code.
 *
 * Four buttons: share as PDF, download PDF, share as image, download image.
 * Everything happens on the phone, from the slip it is already showing:
 *
 *   image   html-to-image (loaded before this, as the global `htmlToImage`)
 *           draws the page's own slip — artwork, values, pictures, QR — into
 *           a canvas at 3x, about 1590 x 2270 px, saved as a JPEG. The same
 *           markup the customer sees, so it cannot disagree with it, Urdu and
 *           all — which a second renderer on the server could not promise.
 *   pdf     that JPEG, alone on one 140 x 200 mm page, built by jpegToPdf
 *           below: a PDF holding a single JPEG is a few objects and a cross-
 *           reference table, not a library's worth of code.
 *   share   the phone's own share sheet (WhatsApp, email…) through the Web
 *           Share API. A browser that cannot share files — most desktop ones
 *           — downloads the file instead, and says so.
 *
 * Served from this server under the page's content policy, which allows
 * scripts from here and nowhere else.
 */

/** The slip's paper, in PDF points (1/72 inch): 140 x 200 mm. */
const PAGE_PT = { width: (140 / 25.4) * 72, height: (200 / 25.4) * 72 };

/** How many image pixels per CSS pixel: ~290 dpi on the 140 mm sheet. */
const PIXEL_RATIO = 3;

/**
 * A one-page PDF showing one JPEG across the whole page.
 *
 * @param {Uint8Array} jpeg      the JPEG file's bytes (baseline, RGB — what a canvas makes)
 * @param {number} widthPx       its width in pixels
 * @param {number} heightPx      its height in pixels
 * @param {{ width: number, height: number }} [page] page size in points
 * @returns {Uint8Array}
 */
export function jpegToPdf(jpeg, widthPx, heightPx, page = PAGE_PT) {
  const encoder = new TextEncoder();
  /** @type {Uint8Array[]} */
  const chunks = [];
  /** @type {number[]} */
  const offsets = [];
  let length = 0;
  /** @param {string | Uint8Array} part */
  const write = (part) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  /** @param {number} n @param {string} body */
  const object = (n, body) => {
    offsets[n] = length;
    write(`${n} 0 obj\n${body}\nendobj\n`);
  };

  const w = page.width.toFixed(2);
  const h = page.height.toFixed(2);
  const draw = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;

  write('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
      '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
  );
  // The image is the one object with binary data, written around the bytes.
  offsets[4] = length;
  write(
    '4 0 obj\n' +
      `<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} ` +
      '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ' +
      `/Length ${jpeg.length} >>\nstream\n`,
  );
  write(jpeg);
  write('\nendstream\nendobj\n');
  object(5, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);

  const xref = length;
  write('xref\n0 6\n0000000000 65535 f \n');
  for (let n = 1; n <= 5; n += 1) write(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  write(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* The page.                                                                 */
/* ------------------------------------------------------------------------ */

function setUp() {
  const toolbar = document.querySelector('[data-slip-actions]');
  const sheet = /** @type {HTMLElement | null} */ (document.querySelector('[data-slip-view]'));
  /** @type {any} */
  const htmlToImage = /** @type {any} */ (window).htmlToImage;
  if (!toolbar || !sheet || !htmlToImage) return;

  const status = toolbar.querySelector('[data-slip-status]');
  const fileName = toolbar.getAttribute('data-file-name') || 'Weight-Bridge-Slip';
  const title = toolbar.getAttribute('data-title') || document.title;
  const fontCss = document.getElementById('slip-fonts')?.textContent || undefined;
  const buttons = /** @type {HTMLButtonElement[]} */ ([...toolbar.querySelectorAll('button')]);

  /** @param {string} text */
  const say = (text) => {
    if (status) status.textContent = text;
  };

  /* Drawn once and kept: the four buttons share one picture of the slip. */
  /** @type {Promise<{ jpeg: Blob, width: number, height: number }> | null} */
  let rendering = null;
  const render = () => {
    rendering ??= (async () => {
      const options = {
        pixelRatio: PIXEL_RATIO,
        backgroundColor: '#ffffff',
        fontEmbedCSS: fontCss,
        // Lay it out at its own size, whatever the phone has scaled it to.
        style: { transform: 'none' },
      };
      // WebKit can leave pictures out of the first drawing of a page into a
      // canvas; the second, with everything already loaded, has them.
      let canvas = await htmlToImage.toCanvas(sheet, options);
      if (/AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent)) {
        canvas = await htmlToImage.toCanvas(sheet, options);
      }
      const jpeg = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (/** @type {Blob | null} */ blob) => (blob ? resolve(blob) : reject(new Error('No image'))),
          'image/jpeg',
          0.92,
        ),
      );
      return { jpeg, width: canvas.width, height: canvas.height };
    })();
    rendering.catch(() => {
      rendering = null;
    });
    return rendering;
  };

  /** @param {'pdf' | 'image'} kind */
  const makeFile = async (kind) => {
    const { jpeg, width, height } = await render();
    if (kind === 'image') {
      return new File([jpeg], `${fileName}.jpg`, { type: 'image/jpeg' });
    }
    const pdf = jpegToPdf(new Uint8Array(await jpeg.arrayBuffer()), width, height);
    return new File([pdf], `${fileName}.pdf`, { type: 'application/pdf' });
  };

  /** @param {File} file */
  const download = (file) => {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  /** @param {File} file */
  const share = async (file) => {
    const data = { files: [file], title };
    if (navigator.canShare && navigator.canShare(data)) {
      await navigator.share(data);
      return true;
    }
    return false;
  };

  for (const button of buttons) {
    button.disabled = false;
    button.addEventListener('click', async () => {
      const [verb, kind] = (button.getAttribute('data-action') || '').split('-');
      if (kind !== 'pdf' && kind !== 'image') return;

      buttons.forEach((b) => (b.disabled = true));
      say('Preparing…');
      try {
        const file = await makeFile(kind);
        if (verb === 'share') {
          if (await share(file)) {
            say('');
          } else {
            download(file);
            say('This browser cannot share files, so it was downloaded instead.');
          }
        } else {
          download(file);
          say('Downloaded.');
        }
      } catch (error) {
        // Closing the share sheet is not an error.
        if (error instanceof Error && error.name === 'AbortError') say('');
        else say('Could not prepare the file. Please try again.');
      } finally {
        buttons.forEach((b) => (b.disabled = false));
      }
    });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setUp);
  else setUp();
}
