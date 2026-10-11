/**
 * Which stream each kind of request goes to.
 *
 * The cameras offer the same picture twice: a 4 MP main stream and a 640x360
 * sub-stream. Printing wants the first and the operator's live panel wants the
 * second, and getting that backwards is quiet rather than loud — a live view
 * pulling 4 MP frames several times a second simply stutters, and a slip made
 * from the sub-stream simply prints a number plate nobody can read. Neither
 * fails, so neither shows up without a test.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { CameraClient } from '../src/cameras/camera-client.js';

describe('CameraClient', () => {
  let server: Server;
  let base: string;
  /** Every path the fake camera was asked for, in order. */
  const asked: string[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      asked.push(request.url ?? '');
      response.writeHead(200, { 'content-type': 'image/jpeg' });
      // The body names the channel, so a test can tell the two apart.
      response.end(Buffer.from(`image from ${request.url}`));
    });

    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  const client = () =>
    new CameraClient({
      frontUrl: `${base}/channels/101/picture`,
      sideUrl: `${base}/side/101/picture`,
      frontLiveUrl: `${base}/channels/102/picture`,
      sideLiveUrl: `${base}/side/102/picture`,
      username: 'admin',
      password: 'secret',
      timeoutMs: 2000,
    });

  it('prints from the main stream and streams from the sub-stream', async () => {
    const still = await client().snapshot('FRONT');
    expect(still?.body.toString()).toContain('/channels/101/');

    const live = await client().snapshot('FRONT', 'live');
    expect(live?.body.toString()).toContain('/channels/102/');
  });

  it('defaults to the main stream, so a caller that says nothing gets the slip quality', async () => {
    const shot = await client().snapshot('SIDE');
    expect(shot?.body.toString()).toContain('/side/101/');
  });

  it('falls back to the main stream when no sub-stream is configured', async () => {
    /*
     * A developer pointing at a mock or a webcam sets one URL and expects both
     * to work. A lower-resolution live view is the optimisation here, not the
     * requirement, so its absence must not black out the panel.
     */
    const single = new CameraClient({
      frontUrl: `${base}/only/one/picture`,
      sideUrl: '',
      frontLiveUrl: '',
      sideLiveUrl: '',
      username: 'admin',
      password: 'secret',
      timeoutMs: 2000,
    });

    const live = await single.snapshot('FRONT', 'live');
    expect(live?.body.toString()).toContain('/only/one/');
    // And a camera with no address at all is still simply absent.
    expect(single.configuredViews()).toEqual(['FRONT']);
  });

  it('yields null rather than throwing when a camera does not answer', async () => {
    // Every caller's answer to a failed camera is the same — carry on without
    // the picture — and the weighing must never depend on one.
    const dead = new CameraClient({
      frontUrl: 'http://127.0.0.1:1/picture',
      sideUrl: '',
      frontLiveUrl: '',
      sideLiveUrl: '',
      username: 'admin',
      password: 'secret',
      timeoutMs: 500,
    });

    expect(await dead.snapshot('FRONT')).toBeNull();
    expect(await dead.snapshotAll()).toEqual([]);
  });
});
