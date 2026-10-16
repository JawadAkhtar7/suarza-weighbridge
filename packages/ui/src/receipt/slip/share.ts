/**
 * Sending a slip to WhatsApp from the app that just printed it.
 *
 * THE WAY IT WORKS: the slip goes on the clipboard and WhatsApp Desktop is
 * launched by its own protocol link. The operator picks a chat and presses
 * Ctrl+V. One keystroke, and in exchange it is the same every single time.
 *
 * `navigator.share` was tried first and abandoned. It needs no pasting, but
 * on this machine the first share of each session does not open the Windows
 * chooser at all: the system spins for the best part of a minute, fails with
 * `AbortError: Share Error`, holds Chrome's own share lock throughout — so
 * every press meanwhile earns `InvalidStateError` — and only then does the
 * next press work. None of that is reachable from a page: the warm-up needs
 * a real share call, a share call needs a press, and a second call inside
 * one press is refused. An operator with a driver at the window cannot be
 * given a button that behaves differently the first time.
 *
 * WHAT NOTHING CAN DO: open WhatsApp with the file already attached. There is
 * no URL and no API for it — `wa.me`, `api.whatsapp.com/send`,
 * `web.whatsapp.com/send` and `whatsapp://send` all carry text and a phone
 * number, never a picture — and no page may put a file into another app's
 * composer. The clipboard is as close as a browser gets.
 *
 * The paste does not consume it, which is the quiet virtue of this route: one
 * press, then Ctrl+V into as many chats and groups as the slip needs to go
 * to. It stays until something else is copied.
 *
 * The picture is the slip the screen is already showing, drawn into a canvas
 * — the same markup, the same artwork, the same Urdu. A second renderer could
 * not promise that, which is why this is worth the twenty kilobytes of
 * html-to-image rather than an image built on the server.
 */

import * as htmlToImage from 'html-to-image';
import { PAGE_MM } from './layout.js';

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

/**
 * WhatsApp Desktop's own protocol link.
 *
 * `whatsapp://` rather than any of the http ones: those open the website, or
 * ask the browser to decide, and this machine has the app and wants it. No
 * query at all — a `text=` would prefill a message the operator did not type,
 * and the picture is going in by paste anyway.
 */
export const WHATSAPP_APP_URL = 'whatsapp://send';

/**
 * Put the picture on the clipboard.
 *
 * The blob is handed to `ClipboardItem` as a PROMISE rather than awaited
 * first: browsers tie a clipboard write to the click that caused it, and
 * drawing or encoding takes long enough to lose that claim. The promise form
 * is what the API provides for exactly this.
 *
 * PNG, because Chrome's clipboard takes `image/png` and nothing else.
 */
export async function copyImageToClipboard(blob: Promise<Blob> | Blob): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** Open WhatsApp Desktop. Silent if the app is not installed. */
export function openWhatsAppApp(): void {
  /*
   * Through a link rather than by setting `location`. An unregistered scheme
   * assigned to `location` can leave Chrome showing an error page where the
   * weighing screen was; a click on an anchor that nothing handles simply
   * does nothing, which is the right failure for a button beside a till.
   */
  const link = document.createElement('a');
  link.href = WHATSAPP_APP_URL;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Save the file, for a machine whose clipboard refuses pictures. */
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
