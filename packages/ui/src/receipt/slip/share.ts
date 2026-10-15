/**
 * Sending a slip to WhatsApp from the app that just printed it.
 *
 * TWO WAYS, and which one the operator gets depends on the machine:
 *
 *   share sheet   `navigator.share` hands the picture to the system, which
 *                 offers WhatsApp among the apps that accept one. WhatsApp
 *                 then asks which chats to send it to. This is the version
 *                 with no pasting in it, and it needs WhatsApp installed on
 *                 the PC — a browser cannot hand a file to a web page.
 *
 *   clipboard     Failing that, the slip goes on the clipboard and WhatsApp
 *                 Web opens: pick the chat, press Ctrl+V. WhatsApp Web takes
 *                 the paste exactly as if the file had been dragged in.
 *
 * WHAT NEITHER CAN DO: open WhatsApp Web with the file already attached.
 * There is no URL and no API for it — `wa.me` and `web.whatsapp.com/send`
 * carry text and a phone number, never a picture — and no page may put a file
 * into another site's composer. The share sheet is the only route that skips
 * the paste, and it goes through the installed app rather than the website.
 *
 * The picture is the slip the screen is already showing, drawn into a canvas
 * — the same markup, the same artwork, the same Urdu. A second renderer could
 * not promise that, which is why this is worth the twenty kilobytes of
 * html-to-image rather than an image built on the server.
 */

import * as htmlToImage from 'html-to-image';

/** Where the operator picks the conversation, when there is no share sheet. */
export const WHATSAPP_WEB_URL = 'https://web.whatsapp.com';

/**
 * How many image pixels per CSS pixel.
 *
 * Two gives roughly 1060 x 1510 — about 190 dpi across the 140 mm sheet, and
 * near enough WhatsApp's own ceiling that a larger picture would only be
 * downscaled again on the way out.
 */
const PIXEL_RATIO = 2;

/**
 * Draw the slip, once everything in it is actually there.
 *
 * The waiting is the whole function. html-to-image copies the element as it
 * stands at that instant: a photograph still decoding is drawn as nothing, a
 * font still loading is drawn in a fallback or not at all, and what comes out
 * is a white sheet that looks like a bug in the slip rather than a race. Both
 * are waited for here so the caller cannot forget.
 */
export async function renderSlipCanvas(node: HTMLElement): Promise<HTMLCanvasElement> {
  await waitForContent(node);

  const options = {
    pixelRatio: PIXEL_RATIO,
    /*
     * NOT cache-busted. The photographs are served immutable and are already
     * in the browser's cache — they are on the screen being looked at — and a
     * busting query would fetch a megabyte of them again before anything
     * could be sent.
     */
    cacheBust: false,
    /* The sheet is drawn over whatever the app's page background is; without
       this the transparent areas come out as the card's grey. */
    backgroundColor: '#ffffff',
  };

  /*
   * Twice, and the second one is the one that is kept.
   *
   * html-to-image builds an SVG with the page's own styles and images inlined
   * and hands it to the browser to draw. The first attempt routinely lands
   * before every inlined picture has been decoded — a known rough edge, and
   * the reason the public slip page already does this on WebKit. The second
   * draws from everything the first warmed up. It costs a few hundred
   * milliseconds, which is paid before the operator clicks anything.
   */
  await htmlToImage.toCanvas(node, options);
  return await htmlToImage.toCanvas(node, options);
}

/** The canvas as a file WhatsApp will take. */
export async function canvasToFile(
  canvas: HTMLCanvasElement,
  fileName: string,
  type: 'image/png' | 'image/jpeg' = 'image/jpeg',
): Promise<File> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (made) => (made ? resolve(made) : reject(new Error('The slip could not be drawn'))),
      type,
      type === 'image/jpeg' ? 0.92 : undefined,
    ),
  );
  const extension = type === 'image/png' ? 'png' : 'jpg';
  return new File([blob], `${fileName}.${extension}`, { type });
}

/** Whether this machine can hand a file to another app. */
export function canShareFile(file: File): boolean {
  return (
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  );
}

/**
 * Everything drawn in this element: its fonts, and every picture in it.
 *
 * Never rejects and never waits for ever. A photograph that will not load is
 * a slip with a placeholder in it, which is a perfectly good thing to send;
 * hanging the button over it would not be.
 */
async function waitForContent(node: HTMLElement): Promise<void> {
  const deadline = new Promise<void>((resolve) => setTimeout(resolve, 5000));

  const fonts = document.fonts?.ready?.then(() => undefined) ?? Promise.resolve();

  /* Array.from rather than a spread: the server package compiles this file
     without DOM.Iterable, where a NodeList is not iterable. */
  const images = Array.from(node.querySelectorAll('img')).map(
    (img) =>
      new Promise<void>((resolve) => {
        if (img.complete && img.naturalWidth > 0) {
          resolve();
          return;
        }
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      }),
  );

  await Promise.race([Promise.all([fonts, ...images]).then(() => undefined), deadline]);
}

/** Save the file, for a browser that will neither share nor copy it. */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Long enough for the browser to have read it; short enough not to keep a
  // few megabytes alive for the rest of the shift.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
