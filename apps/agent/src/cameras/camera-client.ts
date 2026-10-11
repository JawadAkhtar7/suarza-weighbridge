/**
 * The two cameras watching the bridge.
 *
 * Every method here is failure-tolerant on purpose. A camera is the least
 * reliable thing on this network — it shares a switch with the indicator, it
 * is outdoors, and its power comes off the same supply that has already shut
 * this PC down mid-install once. None of that may ever stop a truck being
 * weighed, so a camera that is slow, unplugged or wrong simply yields no
 * picture and the slip prints the placeholder.
 */

import { fetchWithDigest } from './digest.js';

export const CAMERA_VIEWS = ['FRONT', 'SIDE'] as const;
export type CameraView = (typeof CAMERA_VIEWS)[number];

/**
 * Which picture is wanted.
 *
 * `still` is the one that is stored and printed, and comes off the main
 * stream. `live` feeds the operator's panel several times a second and comes
 * off the sub-stream, which is a fraction of the bytes — see deployment.ts.
 */
export type CameraPurpose = 'still' | 'live';

export interface CameraClientOptions {
  frontUrl: string;
  sideUrl: string;
  frontLiveUrl: string;
  sideLiveUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
  onLog?: (level: 'info' | 'warn', message: string) => void;
}

export interface Snapshot {
  view: CameraView;
  body: Buffer;
  contentType: string;
  takenAt: string;
}

export class CameraClient {
  constructor(private readonly options: CameraClientOptions) {}

  private urlFor(view: CameraView, purpose: CameraPurpose = 'still'): string {
    const { frontUrl, sideUrl, frontLiveUrl, sideLiveUrl } = this.options;
    if (purpose === 'live') {
      // A camera configured for stills but not for live falls back rather
      // than going dark: a lower-resolution live view is the optimisation,
      // not the requirement.
      const live = view === 'FRONT' ? frontLiveUrl : sideLiveUrl;
      if (live.trim() !== '') return live.trim();
    }
    return (view === 'FRONT' ? frontUrl : sideUrl).trim();
  }

  /** Which cameras are configured at all. */
  configuredViews(): CameraView[] {
    return CAMERA_VIEWS.filter((view) => this.urlFor(view) !== '');
  }

  get enabled(): boolean {
    return this.configuredViews().length > 0;
  }

  /**
   * One still, or null.
   *
   * Null rather than a throw: every caller's answer to a failed camera is the
   * same — carry on without the picture — and making each of them write a
   * try/catch to say so invites one of them forgetting.
   */
  async snapshot(view: CameraView, purpose: CameraPurpose = 'still'): Promise<Snapshot | null> {
    const url = this.urlFor(view, purpose);
    if (!url) return null;

    try {
      const { body, contentType } = await fetchWithDigest(url, {
        username: this.options.username,
        password: this.options.password,
        timeoutMs: this.options.timeoutMs,
      });
      return { view, body, contentType, takenAt: new Date().toISOString() };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.options.onLog?.('warn', `${view} camera: ${reason}`);
      return null;
    }
  }

  /**
   * Both cameras at once.
   *
   * In parallel because they are independent and the operator is waiting:
   * done one after the other, two cameras on a bad day would add twice the
   * timeout to the save.
   */
  async snapshotAll(): Promise<Snapshot[]> {
    const results = await Promise.all(
      this.configuredViews().map((view) => this.snapshot(view)),
    );
    return results.filter((shot): shot is Snapshot => shot !== null);
  }
}
