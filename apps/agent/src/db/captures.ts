/**
 * Camera stills: the rows. The files live under CAPTURE_PATH.
 *
 * The row and the file can disagree — a disk filling up, a folder deleted by
 * hand, a prune that ran halfway. Everything that reads a capture therefore
 * treats a missing file as a missing picture rather than an error, and the
 * prune removes the row and the file together.
 */

import type { Db } from './connection.js';
import type { CameraView } from '../cameras/camera-client.js';

export const CAPTURE_PASSES = ['FIRST', 'SECOND'] as const;
export type CapturePass = (typeof CAPTURE_PASSES)[number];

export interface CaptureRow {
  id: string;
  weighment_id: string;
  slip_number: string;
  pass: CapturePass;
  view: CameraView;
  path: string;
  bytes: number;
  taken_at: string;
  synced: number;
}

export interface NewCapture {
  id: string;
  weighment_id: string;
  slip_number: string;
  pass: CapturePass;
  view: CameraView;
  path: string;
  bytes: number;
  taken_at: string;
}

export class CaptureRepository {
  constructor(private readonly db: Db) {}

  /**
   * Record a still, replacing any previous one for the same slot.
   *
   * Replace rather than ignore: if a capture is retried, the newer picture is
   * the one worth keeping, and the unique index would otherwise reject it.
   */
  insert(capture: NewCapture): void {
    this.db
      .prepare(
        `INSERT INTO captures
           (id, weighment_id, slip_number, pass, view, path, bytes, taken_at, synced)
         VALUES
           (@id, @weighment_id, @slip_number, @pass, @view, @path, @bytes, @taken_at, 0)
         ON CONFLICT (weighment_id, pass, view) DO UPDATE SET
           id       = excluded.id,
           path     = excluded.path,
           bytes    = excluded.bytes,
           taken_at = excluded.taken_at,
           synced   = 0`,
      )
      .run(capture);
  }

  forWeighment(weighmentId: string): CaptureRow[] {
    return this.db
      .prepare(`SELECT * FROM captures WHERE weighment_id = ? ORDER BY taken_at`)
      .all(weighmentId) as CaptureRow[];
  }

  byId(id: string): CaptureRow | undefined {
    return this.db.prepare(`SELECT * FROM captures WHERE id = ?`).get(id) as
      | CaptureRow
      | undefined;
  }

  /**
   * The pictures a slip should print.
   *
   * The LAST one taken for each view wins, whichever pass it came from. On a
   * completed weighing that is the second pass — the loaded truck, which is
   * the state the slip describes. On a slip printed after pass one it is the
   * only one there is.
   */
  latestByView(weighmentId: string): Partial<Record<CameraView, CaptureRow>> {
    const rows = this.forWeighment(weighmentId);
    const out: Partial<Record<CameraView, CaptureRow>> = {};
    for (const row of rows) {
      const seen = out[row.view];
      if (!seen || row.taken_at >= seen.taken_at) out[row.view] = row;
    }
    return out;
  }

  unsynced(limit = 20): CaptureRow[] {
    return this.db
      .prepare(`SELECT * FROM captures WHERE synced = 0 ORDER BY taken_at LIMIT ?`)
      .all(limit) as CaptureRow[];
  }

  markSynced(ids: string[]): void {
    if (ids.length === 0) return;
    const statement = this.db.prepare(`UPDATE captures SET synced = 1 WHERE id = ?`);
    const run = this.db.transaction((all: string[]) => {
      for (const id of all) statement.run(id);
    });
    run(ids);
  }

  /**
   * Rows older than a cut-off, for the prune.
   *
   * Only ones already synced: the cloud is the archive, and deleting a local
   * picture that never reached it would lose it outright.
   */
  prunable(before: string, limit = 500): CaptureRow[] {
    return this.db
      .prepare(`SELECT * FROM captures WHERE taken_at < ? AND synced = 1 LIMIT ?`)
      .all(before, limit) as CaptureRow[];
  }

  deleteByIds(ids: string[]): void {
    if (ids.length === 0) return;
    const statement = this.db.prepare(`DELETE FROM captures WHERE id = ?`);
    const run = this.db.transaction((all: string[]) => {
      for (const id of all) statement.run(id);
    });
    run(ids);
  }
}
