import { describe, expect, it } from 'vitest';
import { zoomAbout } from '../src/components/camera-framer.js';

/** Where a picture point lands on screen, from the box centre, as a fraction of the box. */
const onScreen = (frame: { zoom: number; x: number }, p: number) => frame.zoom * (p + frame.x);

describe('zooming the side view', () => {
  it('keeps the point under the cursor where it is', () => {
    const before = { zoom: 1.5, x: 0.05, y: 0 };
    const u = 0.3; // cursor right of centre
    const p = u / before.zoom - before.x; // the picture point under it

    const after = zoomAbout(before, 2, u, 0);
    expect(after.zoom).toBe(2);
    expect(onScreen(after, p)).toBeCloseTo(u, 10);
  });

  it('zooms about the centre from the buttons', () => {
    expect(zoomAbout({ zoom: 1, x: 0, y: 0 }, 1.25)).toEqual({ zoom: 1.25, x: 0, y: 0 });
  });

  it('pulls the picture back in when zooming out would show an edge', () => {
    // Panned hard right at 3x; at 1.25x the room is only 0.1.
    const after = zoomAbout({ zoom: 3, x: 0.3, y: 0 }, 1.25);
    expect(after.zoom).toBe(1.25);
    expect(after.x).toBeCloseTo(0.1, 10);
    expect(after.y).toBe(0);
  });
});
