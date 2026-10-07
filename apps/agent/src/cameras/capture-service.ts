/**
 * Taking the pictures and filing them.
 *
 * Fired AFTER a weighing is committed, never inside the transaction. A camera
 * that takes two seconds to answer must not hold a database write open, and a
 * camera that never answers must not roll a weighing back. The record is the
 * thing that matters; the picture is evidence attached to it afterwards.
 *
 * Nothing here is awaited by the caller either. By the time the slip is being
 * printed the stills are usually already on disk — they take a few hundred
 * milliseconds on a local network — but if they are not, the slip prints the
 * placeholder rather than making the operator wait at the window.
 */

import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Weighment } from '@suarza/shared';
import type { CameraClient } from './camera-client.js';
import { CaptureRepository, type CapturePass } from '../db/captures.js';
import type { Db } from '../db/connection.js';

export interface CaptureServiceOptions {
  db: Db;
  cameras: CameraClient;
  /** Root folder for stills. Resolved once, at construction. */
  directory: string;
  /** Local stills older than this are pruned once the cloud has them. */
  keepDays: number;
  onLog?: (level: 'info' | 'warn', message: string) => void;
}

export class CaptureService {
  private readonly captures: CaptureRepository;
  private readonly root: string;

  constructor(private readonly options: CaptureServiceOptions) {
    this.captures = new CaptureRepository(options.db);
    this.root = resolve(options.directory);
  }

  get enabled(): boolean {
    return this.options.cameras.enabled;
  }

  /** `2026/10/20265-SECOND-FRONT.jpg` — dated folders make the prune a walk. */
  private relativePath(weighment: Weighment, pass: CapturePass, view: string): string {
    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, '0');
    // The slip number is safe in a filename by construction — it is digits —
    // but it is sanitised anyway, because a filename built from a record is
    // the kind of thing that quietly becomes user input later.
    const slip = weighment.slip_number.replace(/[^A-Za-z0-9_-]/g, '');
    return join(year, month, `${slip}-${pass}-${view}.jpg`);
  }

  /**
   * Photograph the truck for one pass of one weighing.
   *
   * Returns nothing and throws nothing: callers treat it as fire-and-forget,
   * and a failure here is a slip without a picture, not a failed weighing.
   */
  async capture(weighment: Weighment, pass: CapturePass): Promise<void> {
    if (!this.enabled) return;

    try {
      const shots = await this.options.cameras.snapshotAll();
      if (shots.length === 0) {
        this.options.onLog?.('warn', `No camera answered for slip ${weighment.slip_number}`);
        return;
      }

      for (const shot of shots) {
        const relative = this.relativePath(weighment, pass, shot.view);
        const absolute = join(this.root, relative);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, shot.body);

        this.captures.insert({
          id: randomUUID(),
          weighment_id: weighment.id,
          slip_number: weighment.slip_number,
          pass,
          view: shot.view,
          path: relative,
          bytes: shot.body.byteLength,
          taken_at: shot.takenAt,
        });
      }

      this.options.onLog?.(
        'info',
        `Captured ${shots.length} image(s) for slip ${weighment.slip_number} (${pass})`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.options.onLog?.('warn', `Could not store images for ${weighment.slip_number}: ${reason}`);
    }
  }

  /** Absolute path of a stored still, for serving it. */
  absolutePath(relative: string): string {
    return join(this.root, relative);
  }

  repository(): CaptureRepository {
    return this.captures;
  }

  /**
   * The bytes of a stored still, or null if the file has gone.
   *
   * Null rather than a throw because the sync worker's answer to a missing
   * file is to give up on that picture and move on, not to stop.
   */
  async readFile(row: { path: string }): Promise<Buffer | null> {
    try {
      return await readFile(this.absolutePath(row.path));
    } catch {
      return null;
    }
  }

  /**
   * Delete local stills the cloud already has and nobody is likely to reprint.
   *
   * Only synced rows are eligible, so a bridge that has been offline for a
   * month keeps everything until it has caught up.
   */
  async prune(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.options.keepDays * 86_400_000).toISOString();
    const rows = this.captures.prunable(cutoff);
    if (rows.length === 0) return 0;

    for (const row of rows) {
      // A file already gone is the normal case on a second run, not an error.
      await unlink(this.absolutePath(row.path)).catch(() => undefined);
    }
    this.captures.deleteByIds(rows.map((row) => row.id));
    this.options.onLog?.('info', `Pruned ${rows.length} stored image(s)`);
    return rows.length;
  }
}
