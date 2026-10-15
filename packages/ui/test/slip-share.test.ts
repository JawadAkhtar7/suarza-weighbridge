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
import { isBlank, renderSlipCanvas } from '../src/receipt/slip/share.js';

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
