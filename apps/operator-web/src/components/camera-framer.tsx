/**
 * A camera's live picture, framed by hand.
 *
 * The operator zooms (wheel, or the buttons) and drags the picture until the
 * part of the bridge worth showing fills the box, and that framing is what
 * every slip shows: this preview, the slip on screen, the printed sheet, the
 * PDF and the page behind the QR. One stored framing per view, drawn
 * everywhere by the same transform (viewFrameTransform) in a box of the same
 * shape — which is why this preview is the slip box's ~2:1 rather than the
 * camera's 16:9.
 *
 * Saved to the station settings on its own a moment after the operator stops,
 * without a toast: nobody pressed Save, so nobody should be told they did.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampViewFrame,
  DEFAULT_FRONT_VIEW_FRAME,
  DEFAULT_SIDE_VIEW_FRAME,
  VIEW_FRAME_ZOOM,
  viewFrameTransform,
  type ViewFrame,
} from '@suarza/shared';
import { Button, VIEW_ASPECT } from '@suarza/ui';
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { useReceiptSettings } from '../hooks/use-receipt-settings.js';
import type { ReceiptSettings } from '../lib/receipt-settings.js';

/** One wheel notch or button press; about ten presses take 1x to the 10x ceiling. */
const ZOOM_STEP = 1.25;
/** Long enough that a drag is one save, not forty. */
const SAVE_AFTER_MS = 800;

/** Where each view's framing lives, what it starts from, and its box's shape. */
const VIEWS = {
  FRONT: {
    key: 'front_view_frame',
    reset: DEFAULT_FRONT_VIEW_FRAME,
    resetLabel: 'Back to the standard crop',
    aspect: VIEW_ASPECT['front-view'],
  },
  SIDE: {
    key: 'side_view_frame',
    reset: DEFAULT_SIDE_VIEW_FRAME,
    resetLabel: 'Show the whole picture',
    aspect: VIEW_ASPECT['side-view'],
  },
} as const satisfies Record<
  'FRONT' | 'SIDE',
  { key: keyof ReceiptSettings; reset: ViewFrame; resetLabel: string; aspect: number }
>;

/**
 * Zoom to `zoom` keeping the picture point under (u, v) where it is.
 *
 * (u, v) is measured from the box centre as a fraction of the box. The
 * picture is drawn as scale(z) translate(t), so a point p of it lands at
 * z * (p + t); holding that fixed across z -> z' gives t' = u/z' - u/z + t.
 */
export function zoomAbout(frame: ViewFrame, zoom: number, u = 0, v = 0): ViewFrame {
  const next = clampViewFrame({ ...frame, zoom });
  return clampViewFrame({
    zoom: next.zoom,
    x: u / next.zoom - u / frame.zoom + frame.x,
    y: v / next.zoom - v / frame.zoom + frame.y,
  });
}

function sameFrame(a: ViewFrame, b: ViewFrame): boolean {
  return a.zoom === b.zoom && a.x === b.x && a.y === b.y;
}

interface CameraFramerProps {
  view: 'FRONT' | 'SIDE';
  src: string;
  alt: string;
  onError: () => void;
}

export function CameraFramer({ view, src, alt, onError }: CameraFramerProps) {
  const config = VIEWS[view];
  const { settings, update, isLoaded } = useReceiptSettings();
  const saved: ViewFrame = settings[config.key] ?? config.reset;

  const [frame, setFrame] = useState<ViewFrame>(saved);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; from: ViewFrame } | null>(null);

  /* The latest of everything, for the timer and the unmount to read. */
  const latest = useRef({ frame, settings, dirty: false });
  latest.current.frame = frame;
  latest.current.settings = settings;
  const timer = useRef<number | undefined>(undefined);

  const save = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!latest.current.dirty) return;
    latest.current.dirty = false;
    update({ ...latest.current.settings, [config.key]: latest.current.frame }, { quiet: true });
  }, [update, config.key]);

  /* Follow the stored framing — another tab, Restore defaults — unless the
     operator is part-way through changing it here. */
  useEffect(() => {
    if (!latest.current.dirty) setFrame(saved);
  }, [saved.zoom, saved.x, saved.y]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Leaving the screen mid-adjustment must not lose it. */
  useEffect(() => save, [save]);

  /*
   * Never before the settings have loaded: until then they are the schema's
   * defaults, and saving them would wipe the station's real settings — print
   * alignment and all — to frame one picture.
   */
  const change = useCallback(
    (next: ViewFrame) => {
      if (!isLoaded) return;
      setFrame(next);
      latest.current.dirty = true;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(save, SAVE_AFTER_MS);
    },
    [isLoaded, save],
  );

  /* The wheel needs a non-passive listener to stop the page scrolling, which
     React's onWheel cannot give. */
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (event: WheelEvent) => {
      if (!isLoaded) return;
      event.preventDefault();
      const rect = box.getBoundingClientRect();
      const u = (event.clientX - rect.left) / rect.width - 0.5;
      const v = (event.clientY - rect.top) / rect.height - 0.5;
      const current = latest.current.frame;
      const zoom = event.deltaY < 0 ? current.zoom * ZOOM_STEP : current.zoom / ZOOM_STEP;
      change(zoomAbout(current, zoom, u, v));
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, [change, isLoaded]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isLoaded || frame.zoom <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, from: frame };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId || !boxRef.current) return;
    const rect = boxRef.current.getBoundingClientRect();
    /* A drag of d moves the picture d on screen, which is z times its own
       shift: the shift is applied before the scale. */
    change(
      clampViewFrame({
        zoom: start.from.zoom,
        x: start.from.x + (event.clientX - start.x) / rect.width / start.from.zoom,
        y: start.from.y + (event.clientY - start.y) / rect.height / start.from.zoom,
      }),
    );
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer === event.pointerId) drag.current = null;
  };

  return (
    <div className="space-y-1.5">
      <div
        ref={boxRef}
        className={`relative w-full touch-none select-none overflow-hidden rounded-md border border-border/70 bg-muted ${
          frame.zoom > 1 ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
        style={{ aspectRatio: config.aspect }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          onError={onError}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          style={{ transform: viewFrameTransform(frame) }}
        />
      </div>

      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-7 w-7"
          aria-label="Zoom out"
          disabled={!isLoaded || frame.zoom <= VIEW_FRAME_ZOOM.min}
          onClick={() => change(zoomAbout(frame, frame.zoom / ZOOM_STEP))}
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-7 w-7"
          aria-label="Zoom in"
          disabled={!isLoaded || frame.zoom >= VIEW_FRAME_ZOOM.max}
          onClick={() => change(zoomAbout(frame, frame.zoom * ZOOM_STEP))}
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label={config.resetLabel}
          title={config.resetLabel}
          disabled={!isLoaded || sameFrame(frame, config.reset)}
          onClick={() => change(config.reset)}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <span className="ml-1 text-[11px] tabular-nums text-muted-foreground">
          {frame.zoom.toFixed(1)}×
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Scroll to zoom, drag to move — prints as shown
        </span>
      </div>
    </div>
  );
}
