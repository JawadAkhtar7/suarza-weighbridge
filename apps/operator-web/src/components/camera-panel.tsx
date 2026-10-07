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

export function CameraPanel() {
  const status = useQuery({
    queryKey: ['cameras'],
    queryFn: () => agentApi.cameraStatus(),
    // The answer comes from this machine's own .env and cannot change while
    // the app is open, so there is no reason to ask twice.
    staleTime: Infinity,
    retry: false,
  });

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

  const views = status.data?.views ?? [];
  if (!status.data?.enabled || views.length === 0) return null;

  return (
    <Card>
      {/*
        * Side by side, not stacked.
        *
        * The two views are one glance — is the truck squarely on the bridge —
        * and stacking them put the second below the fold of a column that
        * already holds the live weight and the net. Two across keeps both in
        * the same look.
        */}
      <CardContent className="grid grid-cols-2 gap-2 p-3">
        {views.map((view) => (
          <figure key={view} className="space-y-1">
            <figcaption className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {LABELS[view]}
            </figcaption>
            <div className="relative overflow-hidden rounded-md bg-muted">
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
