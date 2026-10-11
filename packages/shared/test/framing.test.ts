import { describe, expect, it } from 'vitest';
import {
  clampViewFrame,
  viewFrameTransform,
  stationSettingsSchema,
  stationProfileSchema,
} from '../src/index.js';

describe('camera view framing', () => {
  it('never pans further than the zoomed picture overhangs its box', () => {
    // At 2x the picture overhangs by a quarter of the box on each side.
    expect(clampViewFrame({ zoom: 2, x: 0.4, y: -0.4 })).toEqual({ zoom: 2, x: 0.25, y: -0.25 });
    // The whole frame has no room to pan at all.
    expect(clampViewFrame({ zoom: 1, x: 0.2, y: 0.1 })).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it('holds the zoom to what the stored still can stand', () => {
    expect(clampViewFrame({ zoom: 25, x: 0, y: 0 }).zoom).toBe(10);
    expect(clampViewFrame({ zoom: 10, x: 0.45, y: 0 })).toEqual({ zoom: 10, x: 0.45, y: 0 });
    expect(clampViewFrame({ zoom: 0.5, x: 0, y: 0 }).zoom).toBe(1);
  });

  it('draws a framing as scale then shift, and a centred one as the old plain crop', () => {
    expect(viewFrameTransform({ zoom: 1, x: 0, y: 0 })).toBeUndefined();
    expect(viewFrameTransform(undefined)).toBeUndefined();
    // Exactly what a front zoom drew before it could be panned.
    expect(viewFrameTransform({ zoom: 1.3, x: 0, y: 0 })).toBe('scale(1.3)');
    expect(viewFrameTransform({ zoom: 2, x: 0.1, y: -0.05 })).toBe(
      'scale(2) translate(10.000%, -5.000%)',
    );
  });

  it("starts each view from its own default: the design's front crop, the whole side", () => {
    const settings = stationSettingsSchema.parse({});
    expect(settings.front_view_frame).toEqual({ zoom: 1.3, x: 0, y: 0 });
    expect(settings.side_view_frame).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it('clamps what a station sends, and accepts a profile from before front framing', () => {
    const profile = stationProfileSchema.parse({
      station_id: 'A',
      updated_at: '2026-10-11T00:00:00.000Z',
      front_view_frame: { zoom: 2, x: -0.5, y: 0 },
      side_view_frame: { zoom: 2, x: 0.5, y: 0 },
    });
    expect(profile.front_view_frame).toEqual({ zoom: 2, x: -0.25, y: 0 });
    expect(profile.side_view_frame).toEqual({ zoom: 2, x: 0.25, y: 0 });

    const older = stationProfileSchema.parse({
      station_id: 'A',
      updated_at: '2026-10-11T00:00:00.000Z',
      front_view_zoom: 1.45,
    });
    expect(older.front_view_frame).toBeUndefined();
    expect(older.front_view_zoom).toBe(1.45);
  });
});
