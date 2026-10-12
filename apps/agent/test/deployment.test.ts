/**
 * Where the weighbridge syncs to.
 *
 * The point of these: the operator PC must take its cloud address from the
 * code, so a change can be pushed to a machine nobody can visit. Anything that
 * quietly reintroduced a dependency on that machine's .env would mean a drive.
 */

import { describe, expect, it } from 'vitest';
import {
  CAMERA_FRONT_URL,
  CAMERA_SIDE_URL,
  CAMERA_FRONT_LIVE_URL,
  CAMERA_SIDE_LIVE_URL,
  CLOUD_API_KEY,
  CLOUD_API_URL,
  CLOUD_DISABLED,
  cameraSettings,
  cloudSettings,
} from '../src/deployment.js';

describe('cloudSettings', () => {
  it('uses the values in the code when the environment says nothing', () => {
    // This is the operator PC: install.bat writes a .env with the COM port in
    // it and nothing about the cloud.
    expect(cloudSettings({})).toEqual({ url: CLOUD_API_URL, apiKey: CLOUD_API_KEY });
  });

  it('lets a developer point at a local server without editing the code', () => {
    const settings = cloudSettings({
      CLOUD_API_URL: 'http://127.0.0.1:4000',
      CLOUD_API_KEY: 'local-key',
    });
    expect(settings).toEqual({ url: 'http://127.0.0.1:4000', apiKey: 'local-key' });
  });

  it('ignores blank entries rather than treating them as "no cloud"', () => {
    // A .env copied from the example with the lines emptied out must not
    // silently disable sync on site.
    expect(cloudSettings({ CLOUD_API_URL: '   ', CLOUD_API_KEY: '' })).toEqual({
      url: CLOUD_API_URL,
      apiKey: CLOUD_API_KEY,
    });
  });

  it('switches sync off only when somebody says so in as many words', () => {
    /*
     * The preview droplet runs an operator app for checking slip layouts, and
     * its practice weighings must not land in the real records. That needs a
     * value nobody arrives at by accident - hence a word rather than a blank,
     * which the test above pins to the opposite behaviour.
     */
    expect(cloudSettings({ CLOUD_API_URL: CLOUD_DISABLED })).toEqual({ url: '', apiKey: '' });
    expect(cloudSettings({ CLOUD_API_URL: ' NONE ' })).toEqual({ url: '', apiKey: '' });
  });

  it('drops the key as well, so nothing can sync with a stale one', () => {
    expect(cloudSettings({ CLOUD_API_URL: 'none', CLOUD_API_KEY: 'left-over' })).toEqual({
      url: '',
      apiKey: '',
    });
  });

  it('ships a real address, not the example placeholder', () => {
    expect(CLOUD_API_URL).toMatch(/^https?:\/\//);
    expect(CLOUD_API_URL).not.toContain('example.com');
  });
});

describe('cameraSettings', () => {
  it('uses the values in the code when the environment says nothing', () => {
    // The weighbridge PC. install.bat writes a .env with the COM port in it
    // and nothing about the cameras, which is the whole point of them being
    // here: moving a camera is a push, not a drive.
    const settings = cameraSettings({});
    expect(settings.frontUrl).toBe(CAMERA_FRONT_URL);
    expect(settings.sideUrl).toBe(CAMERA_SIDE_URL);
  });

  it('lets a developer point at something else without editing the code', () => {
    const settings = cameraSettings({ CAMERA_FRONT_URL: 'http://127.0.0.1:9000/snap' });
    expect(settings.frontUrl).toBe('http://127.0.0.1:9000/snap');
    // Only what was overridden moves; the other camera keeps the real address.
    expect(settings.sideUrl).toBe(CAMERA_SIDE_URL);
  });

  it('ignores a blank or nonsense number rather than running with it', () => {
    // A timeout of zero would make every capture fail instantly, and the
    // operator would see "no camera" on a bridge whose cameras are fine.
    expect(cameraSettings({ CAMERA_TIMEOUT_MS: '' }).timeoutMs).toBeGreaterThan(0);
    expect(cameraSettings({ CAMERA_TIMEOUT_MS: 'soon' }).timeoutMs).toBeGreaterThan(0);
    expect(cameraSettings({ CAMERA_LIVE_FPS: '0' }).liveFps).toBeGreaterThan(0);
  });

  it('ships real addresses, not placeholders', () => {
    for (const url of [
      CAMERA_FRONT_URL,
      CAMERA_SIDE_URL,
      CAMERA_FRONT_LIVE_URL,
      CAMERA_SIDE_LIVE_URL,
    ]) {
      expect(url).toMatch(/^https?:\/\//);
      expect(url).not.toContain('example.com');
    }
  });

  it('stores the main stream and streams the sub-stream', () => {
    /*
     * The two differ only by a digit, which is exactly why this is worth
     * pinning: swapping 101 and 102 produces no error anywhere. It shows up
     * months later as a live view that stutters, or as a slip whose number
     * plate cannot be read when somebody finally needs to read it.
     */
    const settings = cameraSettings({});
    expect(settings.frontUrl).toContain('/channels/101/');
    expect(settings.sideUrl).toContain('/channels/101/');
    expect(settings.frontLiveUrl).toContain('/channels/102/');
    expect(settings.sideLiveUrl).toContain('/channels/102/');
  });

  it('sends a developer who overrides one camera to that camera for both', () => {
    // One webcam on a laptop is the ordinary case off site, and needing two
    // environment variables to say so is a trap.
    const settings = cameraSettings({ CAMERA_FRONT_URL: 'http://127.0.0.1:9000/snap' });
    expect(settings.frontLiveUrl).toBe('http://127.0.0.1:9000/snap');
    // ...while the camera they said nothing about keeps both of its own.
    expect(settings.sideLiveUrl).toBe(CAMERA_SIDE_LIVE_URL);
  });

  it("takes the live video from the main stream, never from '103'", () => {
    /*
     * On these cameras 103 is the main stream under another name, and
     * setting it reconfigured what the recorder records (October 2026). The
     * live video only ever READS the main stream; this pins that it is the
     * main stream it reads, and with no credentials written into the URL.
     */
    const settings = cameraSettings({});
    expect(settings.frontVideoUrl).toMatch(/^rtsp:\/\/[\d.]+:554\/Streaming\/Channels\/101$/);
    expect(settings.frontVideoUrl).not.toContain('@');
  });

  it('keeps the side view on the sub-stream stills, as the client asked', () => {
    // No side video, so its live preview is the 640x360 stills it had before
    // the video existed; the front keeps its video.
    const settings = cameraSettings({});
    expect(settings.sideVideoUrl).toBe('');
    expect(settings.sideLiveUrl).toContain('/channels/102/');
    // The side's printed picture is unaffected: still the main stream.
    expect(settings.sideUrl).toContain('/channels/101/');
  });

  it('gives a developer who points a camera elsewhere no site video for it', () => {
    const settings = cameraSettings({ CAMERA_FRONT_URL: 'http://127.0.0.1:9000/snap' });
    expect(settings.frontVideoUrl).toBe('');
    // ...and lets anyone switch the video off and keep the stills.
    expect(cameraSettings({ CAMERA_FRONT_VIDEO_URL: 'none' }).frontVideoUrl).toBe('');
    // ...or give a camera video from their own environment.
    expect(
      cameraSettings({ CAMERA_SIDE_VIDEO_URL: 'rtsp://10.0.0.9:554/Streaming/Channels/101' })
        .sideVideoUrl,
    ).toBe('rtsp://10.0.0.9:554/Streaming/Channels/101');
  });
});
