/**
 * Filing the pictures against the weighing they belong to.
 *
 * Fired AFTER a weighing is committed, never inside the transaction. A camera
 * that takes two seconds to answer must not hold a database write open, and a
 * camera that never answers must not roll a weighing back. The record is the
 * thing that matters; the picture is evidence attached to it afterwards.
 *
 * Nothing here is awaited by the caller either. By the time the slip is being
 * printed the stills are usually already on disk, but if they are not, the
 * slip prints the placeholder rather than making the operator wait.
 *
 * WHERE THE PICTURES COME FROM, in order of preference:
 *
 *   held     taken when the operator captured the weight and kept against a
 *            token until the save quoted it — see PendingCaptureStore for why
 *            that moment and not this one
 *   copied   an earlier slip's, for the fourth-weight flow, where the figures
 *            come off paper and there is no truck on the bridge to photograph
 *   now      the cameras, as it always was, for a save with neither
 */

import { copyFile, mkdir, readFile, stat, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Weighment } from '@suarza/shared';
import type { CameraClient, Snapshot } from './camera-client.js';
import type { PendingCaptureStore } from './pending-captures.js';
import { CaptureRepository, type CapturePass } from '../db/captures.js';
import type { Db } from '../db/connection.js';

export interface CaptureServiceOptions {
  db: Db;
  cameras: CameraClient;
  /** Root folder for stills. Resolved once, at construction. */
  directory: string;
  /** Local stills older than this are pruned once the cloud has them. */
  keepDays: number;
  /** Pictures taken at the moment of capture, waiting for their save. */
  pending?: PendingCaptureStore;
  onLog?: (level: 'info' | 'warn', message: string) => void;
}

/** What a save knows about where this weighing's pictures should come from. */
export interface CaptureSources {
  /** A token from PendingCaptureStore.start, quoted back by the save. */
  captureId?: string | null;
  /** An earlier slip whose pictures this weighing should carry instead. */
  copyFromSlip?: string | null;
}

export class CaptureService {
  private readonly captures: CaptureRepository;
  private readonly root: string;
  /**
   * Weighments whose pictures are still being taken.
   *
   * The print tab opens the moment a weighing is saved, about a second before
   * a main-stream still has arrived. Without this it cannot tell "not taken
   * yet" from "no cameras" — or, on a second pass, from the first pass's
   * pictures — and prints the placeholder.
   */
  private readonly inFlight = new Map<string, number>();

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
  async capture(
    weighment: Weighment,
    pass: CapturePass,
    sources: CaptureSources = {},
  ): Promise<void> {
    /*
     * A copy is possible on a station with no cameras at all — the pictures
     * came from an earlier slip and may have been synced down or taken when
     * the cameras worked — so the enabled check guards only the live path.
     */
    if (!this.enabled && !sources.copyFromSlip) return;

    // Marked before the first await, so it is already set by the time the
    // save's HTTP response reaches the browser and the print tab asks.
    this.inFlight.set(weighment.id, (this.inFlight.get(weighment.id) ?? 0) + 1);

    try {
      if (sources.copyFromSlip) {
        await this.copyFromSlip(sources.copyFromSlip, weighment, pass);
        return;
      }

      const shots = await this.shotsFor(weighment, sources);
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
    } finally {
      const remaining = (this.inFlight.get(weighment.id) ?? 1) - 1;
      if (remaining > 0) this.inFlight.set(weighment.id, remaining);
      else this.inFlight.delete(weighment.id);
    }
  }

  /**
   * The pictures for a live weighing: the ones held from the capture, or
   * failing that, the bridge as it is now.
   *
   * The fallback is what this did before held pictures existed, and it covers
   * every way a token can come to nothing — an agent restarted between the
   * capture and the save, a form left open past the holding time, an operator
   * app too old to send one. None of those is worth failing a weighing over,
   * and a picture of the bridge a minute late still beats no picture.
   */
  private async shotsFor(weighment: Weighment, sources: CaptureSources): Promise<Snapshot[]> {
    const held = await this.options.pending?.claim(sources.captureId);
    if (held && held.length > 0) {
      this.options.onLog?.(
        'info',
        `Using the photographs taken when slip ${weighment.slip_number} was weighed`,
      );
      return held;
    }

    if (sources.captureId) {
      this.options.onLog?.(
        'warn',
        `No held photographs for slip ${weighment.slip_number}; photographing the bridge now`,
      );
    }
    return this.options.cameras.snapshotAll();
  }

  /**
   * Put an earlier slip's photographs onto this one.
   *
   * The bytes are copied, not the row pointed at a shared file. Two rows
   * sharing one path would mean the prune deleting a file the other still
   * needs the moment the first one syncs — and the two slips are separate
   * records that each have to reach the cloud on their own.
   *
   * The LAST picture of each view wins, which on a completed source slip is
   * the second pass: the loaded truck, as it left the bridge. That is the
   * state a repeat slip describes.
   */
  private async copyFromSlip(
    sourceSlip: string,
    weighment: Weighment,
    pass: CapturePass,
  ): Promise<void> {
    const rows = this.captures.forSlipNumber(sourceSlip.trim().toUpperCase());

    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const seen = latest.get(row.view);
      if (!seen || row.taken_at >= seen.taken_at) latest.set(row.view, row);
    }

    if (latest.size === 0) {
      /*
       * Nothing to copy, and nothing to photograph either: there is no truck
       * on the bridge in this flow. The slip prints the placeholder, which is
       * honest — no picture was ever taken of this weighing.
       */
      this.options.onLog?.('warn', `Slip ${sourceSlip} has no photographs to copy`);
      return;
    }

    let copied = 0;
    for (const row of latest.values()) {
      const from = this.absolutePath(row.path);
      // A row whose file has been pruned, or restored without its pictures,
      // is skipped rather than failing the other view with it.
      try {
        await stat(from);
      } catch {
        this.options.onLog?.('warn', `Slip ${sourceSlip}'s ${row.view} picture is no longer here`);
        continue;
      }

      const relative = this.relativePath(weighment, pass, row.view);
      const absolute = join(this.root, relative);
      await mkdir(dirname(absolute), { recursive: true });
      await copyFile(from, absolute);

      this.captures.insert({
        id: randomUUID(),
        weighment_id: weighment.id,
        slip_number: weighment.slip_number,
        pass,
        view: row.view,
        path: relative,
        bytes: row.bytes,
        /*
         * When the picture was TAKEN, not when it was copied. It is the same
         * photograph of the same truck, and a record that claimed a moment
         * the camera never saw would be a small lie told in the one place
         * the pictures exist to be believed.
         *
         * It also decides which year's folder the cloud files the copy in,
         * so a copy of last year's picture is swept with last year's — a
         * year after it was taken, which is what the retention means.
         */
        taken_at: row.taken_at,
      });
      copied += 1;
    }

    this.options.onLog?.(
      'info',
      `Copied ${copied} image(s) from slip ${sourceSlip} to ${weighment.slip_number}`,
    );
  }

  /** True while this weighment's pictures are still being taken. */
  isPending(weighmentId: string): boolean {
    return this.inFlight.has(weighmentId);
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
