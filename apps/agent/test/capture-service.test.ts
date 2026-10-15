import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Weighment } from '@suarza/shared';
import { openDatabase } from '../src/db/connection.js';
import { CaptureService } from '../src/cameras/capture-service.js';
import type { CameraClient, Snapshot } from '../src/cameras/camera-client.js';
import type { PendingCaptureStore } from '../src/cameras/pending-captures.js';

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

    /*
     * One tick before the cameras are reached: capture now asks the held
     * photographs first — the ones taken when the operator captured the
     * weight — and only falls through to the cameras when there are none.
     */
    await Promise.resolve();
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

describe('CaptureService — where the pictures come from', () => {
  const shot = (view: 'FRONT' | 'SIDE', body: string): Snapshot => ({
    view,
    body: Buffer.from(body),
    contentType: 'image/jpeg',
    takenAt: '2026-10-16T08:00:00.000Z',
  });

  /** A service writing into a directory of its own, with a held-picture store. */
  async function serviceIn(held?: Snapshot[]) {
    const directory = await mkdtemp(join(tmpdir(), 'captures-'));

    /*
     * Captures reference a weighment row, and these tests have none: the
     * subject here is which picture gets filed, not whether SQLite enforces
     * its keys, and building four full weighings to prove a copy would hide
     * the thing being proved.
     */
    const db = openDatabase({ path: ':memory:' });
    db.pragma('foreign_keys = OFF');

    const warnings: string[] = [];

    const cameras = {
      enabled: true,
      snapshotAll: async () => [shot('FRONT', 'live front'), shot('SIDE', 'live side')],
    } as unknown as CameraClient;

    const pending = held
      ? ({ claim: async () => held, enabled: true } as unknown as PendingCaptureStore)
      : undefined;

    const service = new CaptureService({
      db,
      cameras,
      directory,
      keepDays: 60,
      pending,
      /* Collected rather than ignored: this service swallows its failures on
         purpose — a picture must never fail a weighing — so without reading
         the warnings a broken capture looks exactly like one with nothing to
         do. */
      onLog: (level, message) => {
        if (level === 'warn') warnings.push(message);
      },
    });
    return { service, directory, warnings };
  }

  it('prefers the photographs held from the moment of the capture', async () => {
    /*
     * The whole point of holding them. The cameras here would answer with a
     * different picture — the bridge as it is at save time, which is a minute
     * later and usually an empty plate or the next lorry.
     */
    const { service, directory, warnings } = await serviceIn([shot('FRONT', 'held front')]);

    await service.capture(weighment, 'SECOND', { captureId: 'held-1' });

    expect(warnings).toEqual([]);
    const rows = service.repository().forWeighment('w-1');
    expect(rows).toHaveLength(1);
    expect(await readFile(join(directory, rows[0]!.path), 'utf8')).toBe('held front');
  });

  it('photographs the bridge when the held pictures have gone', async () => {
    // An agent restarted between the capture and the save, a form left open
    // past the holding time: a picture a minute late beats no picture.
    const { service, directory, warnings } = await serviceIn([]);

    await service.capture(weighment, 'SECOND', { captureId: 'expired' });

    // Said out loud: a slip whose pictures are a minute late is worth knowing.
    expect(warnings.join(' ')).toMatch(/no held photographs/i);
    const rows = service.repository().forWeighment('w-1');
    expect(rows).toHaveLength(2);
    expect(await readFile(join(directory, rows[0]!.path), 'utf8')).toContain('live');
  });

  it("copies an earlier slip's photographs rather than photographing nothing", async () => {
    /*
     * The fourth-weight flow: both figures come off a slip in the driver's
     * hand and no truck is on the bridge, so a live picture would show an
     * empty plate. The honest picture is the one taken when this truck was
     * last weighed.
     */
    const { service, directory, warnings } = await serviceIn();
    const source = { id: 'w-0', slip_number: '202600' } as Weighment;
    await service.capture(source, 'SECOND');

    const repeat = { id: 'w-2', slip_number: '202699' } as Weighment;
    await service.capture(repeat, 'SECOND', { copyFromSlip: '202600' });

    expect(warnings).toEqual([]);
    const rows = service.repository().forWeighment('w-2');
    expect(rows.map((row) => row.view).sort()).toEqual(['FRONT', 'SIDE']);

    // The bytes are copied, not the row pointed at the source's file: the
    // prune would otherwise delete a file the other row still needs.
    const sourcePaths = service.repository().forWeighment('w-0').map((row) => row.path);
    for (const row of rows) {
      expect(sourcePaths).not.toContain(row.path);
      expect(await readFile(join(directory, row.path), 'utf8')).toContain('live');
    }
    // The moment the camera saw, not the moment of the copy.
    expect(rows[0]!.taken_at).toBe('2026-10-16T08:00:00.000Z');
  });

  it('leaves a repeat slip without pictures when the source has none', async () => {
    const { service, warnings } = await serviceIn();
    const repeat = { id: 'w-3', slip_number: '202698' } as Weighment;

    await service.capture(repeat, 'SECOND', { copyFromSlip: '202697' });

    // Not the cameras: there is no truck on the bridge to photograph.
    expect(service.repository().forWeighment('w-3')).toEqual([]);
    expect(warnings.join(' ')).toMatch(/no photographs to copy/i);
  });
});
