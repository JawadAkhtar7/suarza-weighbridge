/**
 * What the cameras see, live, beside the weight they belong to.
 *
 * The stream is an <img> pointed at the agent, which republishes the camera's
 * stills as MJPEG. That is why this is five lines of markup rather than a
 * video player: the browser has understood multipart/x-mixed-replace since
 * long before <video> existed, and nothing has to be decoded on the PC that
 * is also weighing trucks.
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@suarza/ui';
import { CameraOff } from 'lucide-react';
import { agentApi, cameraLiveUrl } from '../lib/api.js';

const LABELS: Record<'FRONT' | 'SIDE', string> = {
  FRONT: 'Front view',
  SIDE: 'Side view',
};

/**
 * Whether this bridge has cameras, and which.
 *
 * A hook rather than a prop because two places need the answer: the panel,
 * to draw itself, and the page, to decide whether to leave a column for it.
 * React Query dedupes on the key, so it is still one request.
 */
export function useCameras() {
  const status = useQuery({
    queryKey: ['cameras'],
    queryFn: () => agentApi.cameraStatus(),
    // The answer comes from this machine's own deployment.ts and cannot change
    // while the app is open, so there is no reason to ask twice.
    staleTime: Infinity,
    retry: false,
  });

  return {
    enabled: Boolean(status.data?.enabled) && (status.data?.views.length ?? 0) > 0,
    views: status.data?.views ?? [],
  };
}

export function CameraPanel() {
  const { enabled, views } = useCameras();

  /*
   * A new nonce per mount, so switching tabs or coming back to the screen
   * starts a fresh stream. Reusing the URL hands the browser a connection it
   * already closed, and the picture sits frozen on its last frame.
   */
  const [nonce] = useState(() => Date.now());

  /* Stop the streams when the tab is hidden. Each one is an open request that
     keeps the agent polling a camera three times a second for a picture
     nobody is looking at. */
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  if (!enabled) return null;

  return (
    <Card>
      {/*
        * Stacked, now that these have a column to themselves.
        *
        * They were side by side for a while, which fitted them into the
        * narrow column under the live weight but left each one too small to
        * judge whether a truck is squarely on the bridge. A column of their
        * own is worth more than a row: full width beats half width.
        */}
      <CardContent className="space-y-3 p-3">
        {views.map((view) => (
          <figure key={view} className="space-y-1">
            <figcaption className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {LABELS[view]}
            </figcaption>
            {/* A hairline round each frame, so the box is visible even with no
                picture in it. On a machine that cannot reach the cameras —
                a laptop off the bridge's network — the stream never loads,
                and without this the panel reads as empty space rather than
                as two views waiting for a signal. */}
            <div className="relative overflow-hidden rounded-md border border-border/70 bg-muted">
              {visible ? (
                <img
                  src={cameraLiveUrl(view, nonce)}
                  alt={`${LABELS[view]} of the weighbridge, live`}
                  /* 16:9, which is what these cameras send. A fixed box stops
                     the panel jumping about while the first frame arrives. */
                  className="aspect-video w-full object-cover"
                />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center text-muted-foreground">
                  <CameraOff className="h-6 w-6" />
                </div>
              )}
            </div>
          </figure>
        ))}
      </CardContent>
    </Card>
  );
}
