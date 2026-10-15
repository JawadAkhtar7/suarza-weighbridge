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
import { PAGE_MM } from './layout.js';

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
/**
 * The sheet itself, whatever was handed in.
 *
 * Callers pass a ref, and a ref points at whatever element happened to be
 * convenient — a card with padding, a scrolling box narrower than the slip, a
 * centred column in a wide page. html-to-image sizes its drawing from the
 * node it is given, so every one of those wrappers is a different way for the
 * picture to come out cropped or adrift, and a slip sent with its right-hand
 * column missing is worse than one not sent.
 *
 * SlipA5 marks its own root with `data-slip-view`, and that root is exactly
 * 140 mm by 200 mm with nothing round it. Finding it here means no caller has
 * to know this, and a future one cannot forget.
 */
function sheetWithin(node: HTMLElement): HTMLElement {
  if (node.matches('[data-slip-view]')) return node;
  return node.querySelector<HTMLElement>('[data-slip-view]') ?? node;
}

export async function renderSlipCanvas(node: HTMLElement): Promise<HTMLCanvasElement> {
  /*
   * Refused outright rather than drawn badly. A hidden or unfocused tab has
   * its timers throttled to a crawl by the browser, and html-to-image's
   * off-screen image never finishes painting: what comes back is a white
   * sheet with nothing wrong with it that any check could see at the time.
   *
   * This is not theoretical. The operator app opens the print tab by itself
   * the moment a slip is saved, which backgrounds the window a few hundred
   * milliseconds before this used to run.
   */
  if (document.visibilityState !== 'visible' || !document.hasFocus()) {
    throw new Error('The window must be in front for the slip to be drawn');
  }

  const sheet = sheetWithin(node);
  await waitForContent(sheet);

  const options = {
    pixelRatio: PIXEL_RATIO,
    /*
     * Said rather than inferred. Left to work it out, html-to-image measures
     * the node as the page has laid it out — inside whatever is scrolling,
     * centring or clipping it. `offsetWidth` is the element's own box and
     * ignores any transform an ancestor has applied, which is what the slip
     * is: 140 mm by 200 mm, wherever it happens to be sitting.
     */
    width: sheet.offsetWidth,
    height: sheet.offsetHeight,
    /* The clone is drawn on its own, so anything the page did to place it —
       a centring margin, a preview's scale — has to be undone or it is drawn
       into the picture as empty space. */
    style: { margin: '0', transform: 'none', transformOrigin: 'top left' },
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
  await htmlToImage.toCanvas(sheet, options);
  const canvas = await htmlToImage.toCanvas(sheet, options);

  // Belt and braces: whatever went wrong, a blank sheet is never the answer.
  if (isBlank(canvas)) throw new Error('The slip came out blank');
  if (!hasSlipShape(canvas)) throw new Error('The slip came out the wrong shape');
  return canvas;
}

/**
 * Whether what came out is the shape of a slip.
 *
 * A picture of the right size can still be the wrong picture: measured from a
 * wrapper rather than the sheet, it comes out with the slip adrift in it and
 * a column missing off the edge. The paper is 140 by 200, and nothing else
 * this draws is anywhere near that ratio — so one comparison catches every
 * version of that mistake, including the next one.
 */
export function hasSlipShape(canvas: HTMLCanvasElement): boolean {
  if (canvas.height === 0) return false;
  const wanted = PAGE_MM.width / PAGE_MM.height;
  return Math.abs(canvas.width / canvas.height - wanted) < 0.02;
}

/**
 * Whether what came out is a blank sheet.
 *
 * Checked on every drawing, because every way this fails fails the same way:
 * html-to-image copies the element into an off-screen image, and anything
 * that stops that image being painted — a throttled background tab above
 * all — yields a canvas of the background colour with no error at all. A
 * white picture looks like a bug in the slip to whoever receives it, and is
 * the one outcome worth refusing to send.
 *
 * A real slip is about half ink. Sampling every few hundred pixels is plenty
 * to tell half from none, and costs a millisecond.
 */
export function isBlank(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return false;

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let ink = 0;
  let looked = 0;
  // A prime stride, so a regular pattern in the picture cannot line up with it.
  for (let i = 0; i < data.length; i += 4 * 37) {
    looked += 1;
    if (data[i]! < 240 || data[i + 1]! < 240 || data[i + 2]! < 240) ink += 1;
  }

  return looked === 0 || ink / looked < 0.01;
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
