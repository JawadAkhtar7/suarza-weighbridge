import { describe, expect, it } from 'vitest';
import type { Weighment } from '@suarza/shared';
import { openDatabase } from '../src/db/connection.js';
import { CaptureService } from '../src/cameras/capture-service.js';
import type { CameraClient, Snapshot } from '../src/cameras/camera-client.js';

/** A camera that answers only when the test says so. */
function slowCameras() {
  let answer!: (shots: Snapshot[]) => void;
  const cameras = {
    enabled: true,
    snapshotAll: () => new Promise<Snapshot[]>((done) => (answer = done)),
  } as unknown as CameraClient;
  return { cameras, answer: (shots: Snapshot[]) => answer(shots) };
}

const weighment = { id: 'w-1', slip_number: '202640' } as Weighment;

describe('CaptureService — pending', () => {
  it('is pending from the moment capture starts until the cameras answer', async () => {
    const { cameras, answer } = slowCameras();
    const service = new CaptureService({
      db: openDatabase({ path: ':memory:' }),
      cameras,
      directory: './data/test-captures',
      keepDays: 60,
    });

    const running = service.capture(weighment, 'SECOND');
    // Synchronously, before any await: the print tab may ask this soon.
    expect(service.isPending('w-1')).toBe(true);

    answer([]);
    await running;
    expect(service.isPending('w-1')).toBe(false);
  });

  it('is never pending when no camera is configured', async () => {
    const service = new CaptureService({
      db: openDatabase({ path: ':memory:' }),
      cameras: { enabled: false } as unknown as CameraClient,
      directory: './data/test-captures',
      keepDays: 60,
    });

    await service.capture(weighment, 'FIRST');
    expect(service.isPending('w-1')).toBe(false);
  });
});
