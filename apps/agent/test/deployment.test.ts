/**
 * Where the weighbridge syncs to.
 *
 * The point of these: the operator PC must take its cloud address from the
 * code, so a change can be pushed to a machine nobody can visit. Anything that
 * quietly reintroduced a dependency on that machine's .env would mean a drive.
 */

import { describe, expect, it } from 'vitest';
import { CLOUD_API_KEY, CLOUD_API_URL, cloudSettings } from '../src/deployment.js';

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

  it('ships a real address, not the example placeholder', () => {
    expect(CLOUD_API_URL).toMatch(/^https?:\/\//);
    expect(CLOUD_API_URL).not.toContain('example.com');
  });
});
