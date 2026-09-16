/**
 * The rate card, as pulled from the manager.
 *
 * A local copy rather than a live lookup: the weighbridge has to price a
 * weighing with the line down, which is the whole premise of the product. The
 * operator can read it and cannot edit it — rates are the manager's to set.
 *
 * Removed types are kept with `deleted = 1` rather than dropped, because
 * weighments already reference them and their labels still have to resolve.
 */

import type { VehicleTypeRecord } from '@suarza/shared';
import type { Db } from './connection.js';

export interface VehicleTypeRow {
  key: string;
  label: string;
  rate_pkr: number;
  deleted: number;
  updated_at: string;
}

export interface VehicleTypeOption {
  key: string;
  label: string;
  rate_pkr: number;
}

export class VehicleTypeRepository {
  constructor(private readonly db: Db) {}

  /** What the operator may choose from: everything not removed. */
  listActive(): VehicleTypeOption[] {
    const rows = this.db
      .prepare(
        'SELECT key, label, rate_pkr FROM vehicle_types WHERE deleted = 0 ORDER BY label COLLATE NOCASE',
      )
      .all() as VehicleTypeOption[];
    return rows;
  }

  /**
   * The label for a key, removed types included.
   *
   * A weighing made last month against a type since removed must still print
   * its name, so this deliberately does not filter on `deleted`.
   */
  labelFor(key: string): string | null {
    const row = this.db.prepare('SELECT label FROM vehicle_types WHERE key = ?').get(key) as
      | { label: string }
      | undefined;
    return row?.label ?? null;
  }

  rateFor(key: string): number | null {
    const row = this.db
      .prepare('SELECT rate_pkr FROM vehicle_types WHERE key = ? AND deleted = 0')
      .get(key) as { rate_pkr: number } | undefined;
    return row?.rate_pkr ?? null;
  }

  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM vehicle_types WHERE deleted = 0')
      .get() as { n: number };
    return row.n;
  }

  /**
   * Applies a pulled catalogue, reporting what actually changed.
   *
   * The counts are for the operator: "nothing changed" and "12 rates updated"
   * are different answers to pressing a sync button, and a button that always
   * says "done" teaches people to distrust it.
   */
  applySync(records: VehicleTypeRecord[]): { added: number; updated: number; removed: number } {
    let added = 0;
    let updated = 0;
    let removed = 0;

    const existing = new Map(
      (this.db.prepare('SELECT key, label, rate_pkr, deleted FROM vehicle_types').all() as
        VehicleTypeRow[]).map((row) => [row.key, row]),
    );

    const upsert = this.db.prepare(
      `INSERT INTO vehicle_types (key, label, rate_pkr, deleted, updated_at)
       VALUES (@key, @label, @rate_pkr, @deleted, @updated_at)
       ON CONFLICT(key) DO UPDATE SET
         label      = excluded.label,
         rate_pkr   = excluded.rate_pkr,
         deleted    = excluded.deleted,
         updated_at = excluded.updated_at`,
    );

    this.db.transaction((batch: VehicleTypeRecord[]) => {
      for (const record of batch) {
        const deleted = record.deleted_at ? 1 : 0;
        const before = existing.get(record.key);

        upsert.run({
          key: record.key,
          label: record.label,
          rate_pkr: record.rate_pkr,
          deleted,
          updated_at: record.updated_at,
        });

        if (!before) {
          // A type that arrives already removed is not news to anyone.
          if (!deleted) added += 1;
        } else if (deleted && before.deleted === 0) {
          removed += 1;
        } else if (
          before.label !== record.label ||
          before.rate_pkr !== record.rate_pkr ||
          before.deleted !== deleted
        ) {
          updated += 1;
        }
      }
    })(records);

    return { added, updated, removed };
  }
}
