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
    for (const url of [CAMERA_FRONT_URL, CAMERA_SIDE_URL]) {
      expect(url).toMatch(/^https?:\/\//);
      expect(url).not.toContain('example.com');
    }
  });
});
