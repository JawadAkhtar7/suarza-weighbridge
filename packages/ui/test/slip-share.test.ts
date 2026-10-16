/**
 * The two guards that stand between a slip and a blank white picture.
 *
 * Both exist because of the same failure, seen on site: the operator app
 * opens the print tab by itself when a slip is saved, the weighing window
 * goes behind it, the browser throttles the work there to a crawl — and
 * html-to-image hands back a sheet of the background colour with no error
 * anywhere to say anything went wrong. What was sent to the customer on
 * WhatsApp was a white rectangle.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  hasSlipShape,
  isBlank,
  openWhatsAppApp,
  renderSlipCanvas,
  WHATSAPP_APP_URL,
} from '../src/receipt/slip/share.js';

/** A canvas that reports whatever pixels the test asks for. */
function canvasOf(pixel: [number, number, number], size = 64): HTMLCanvasElement {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = pixel[0];
    data[i + 1] = pixel[1];
    data[i + 2] = pixel[2];
    data[i + 3] = 255;
  }
  return {
    width: size,
    height: size,
    getContext: () => ({ getImageData: () => ({ data }) }),
  } as unknown as HTMLCanvasElement;
}

afterEach(() => vi.restoreAllMocks());

describe('isBlank', () => {
  it('calls a sheet of white blank', () => {
    expect(isBlank(canvasOf([255, 255, 255]))).toBe(true);
  });

  it('calls a sheet of nearly-white blank too', () => {
    // The background colour the renderer paints is #ffffff, but a canvas
    // scaled or composited can come back a shade off it.
    expect(isBlank(canvasOf([252, 253, 252]))).toBe(true);
  });

  it('does not call a drawn slip blank', () => {
    expect(isBlank(canvasOf([27, 94, 52]))).toBe(false);
  });

  it('says nothing about a canvas it cannot read', () => {
    // No 2d context — an old browser, or a canvas already transferred. Not a
    // reason to refuse to send; only a reason not to claim it is blank.
    const opaque = {
      width: 10,
      height: 10,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    expect(isBlank(opaque)).toBe(false);
  });
});

describe('hasSlipShape', () => {
  const shaped = (width: number, height: number) =>
    ({ width, height }) as unknown as HTMLCanvasElement;

  it('accepts the paper the slip is printed on', () => {
    // 140 x 200 at two pixels per CSS pixel, which is what the renderer makes.
    expect(hasSlipShape(shaped(1058, 1512))).toBe(true);
  });

  it('refuses a picture measured from the wrapper instead of the sheet', () => {
    /*
     * The shape of the bug this exists for: drawn from a card that is wider
     * than the slip, the picture comes out with the slip adrift in it and a
     * column missing off the right edge. It is not blank and nothing throws,
     * so without this it would be sent to a customer.
     */
    expect(hasSlipShape(shaped(2000, 1512))).toBe(false);
  });

  it('refuses a picture of nothing', () => {
    expect(hasSlipShape(shaped(0, 0))).toBe(false);
  });
});

describe('renderSlipCanvas', () => {
  it('refuses to draw while the window is behind another', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    await expect(renderSlipCanvas(document.createElement('div'))).rejects.toThrow(/in front/i);
  });

  it('refuses to draw while the tab is hidden', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await expect(renderSlipCanvas(document.createElement('div'))).rejects.toThrow(/in front/i);
  });
});

describe('openWhatsAppApp', () => {
  it("launches the desktop app's own protocol, not a web address", () => {
    /*
     * The distinction this whole route rests on. `wa.me`,
     * `api.whatsapp.com/send` and `web.whatsapp.com/send` all end up in a
     * browser — which is where the slip is NOT, since it is on the clipboard
     * and the app is what takes a paste. Only `whatsapp://` reaches the
     * installed app directly.
     */
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.getAttribute('href') ?? '');
    });

    openWhatsAppApp();

    expect(click).toHaveBeenCalledTimes(1);
    expect(clicked).toEqual([WHATSAPP_APP_URL]);
    expect(WHATSAPP_APP_URL.startsWith('whatsapp://')).toBe(true);
  });

  it('leaves nothing behind in the page', () => {
    // A link left in the document would be a stray focus stop on a screen an
    // operator drives with the keyboard.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    openWhatsAppApp();
    expect(document.querySelectorAll('a[href^="whatsapp:"]')).toHaveLength(0);
  });
});
