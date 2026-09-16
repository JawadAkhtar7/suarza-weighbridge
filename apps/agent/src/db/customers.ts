/**
 * Customer directory (operator feedback: a searchable customer picker).
 *
 * Maintained as a side effect of weighing rather than as its own screen, so it
 * is always current and nobody has to remember to keep it tidy.
 *
 * The merge rule is deliberate: a new weighing FILLS IN details the directory
 * is missing, and refreshes the "last used" ones, but never blanks something
 * that was there before. An operator who leaves the phone box empty today must
 * not erase the number they typed last week.
 */

import type { Customer, CustomerRecord as CustomerSyncRecord, VehicleType } from '@suarza/shared';
import { newId, nowUtc } from '@suarza/shared';
import type { Db } from './connection.js';

interface CustomerRow {
  id: string;
  name: string;
  company: string;
  phone: string | null;
  last_vehicle_type: string | null;
  last_vehicle_plate: string | null;
  last_product: string | null;
  weighment_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

function rowToCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    phone: row.phone,
    last_vehicle_type: (row.last_vehicle_type as VehicleType | null) ?? null,
    last_vehicle_plate: row.last_vehicle_plate,
    last_product: row.last_product,
    weighment_count: row.weighment_count,
    last_seen_at: row.last_seen_at,
  };
}

export interface RememberCustomerInput {
  name: string;
  company: string;
  phone?: string | undefined;
  vehicle_type?: VehicleType | undefined;
  vehicle_plate?: string | undefined;
  product?: string | undefined;
}

const SELECT_ALL = `
  SELECT id, name, company, phone, last_vehicle_type, last_vehicle_plate,
         last_product, weighment_count, first_seen_at, last_seen_at
  FROM customers
`;

/** Everywhere the operator picks a customer, a removed one must not appear. */
const LIVE = 'deleted = 0';

export class CustomerRepository {
  constructor(private readonly db: Db) {}

  /** Insert or merge. Must be called inside the weighment's transaction. */
  remember(input: RememberCustomerInput): void {
    const at = nowUtc();
    const name = input.name.trim();
    const company = input.company.trim();
    if (!name) return;

    this.db
      .prepare(
        `INSERT INTO customers (
           id, name, company, phone, last_vehicle_type, last_vehicle_plate,
           last_product, weighment_count, first_seen_at, last_seen_at
         ) VALUES (@id, @name, @company, @phone, @vehicle_type, @vehicle_plate,
                   @product, 1, @at, @at)
         ON CONFLICT (LOWER(name), LOWER(company)) DO UPDATE SET
           -- COALESCE on the INCOMING value: a blank field today leaves
           -- whatever was recorded before intact.
           phone              = COALESCE(excluded.phone, customers.phone),
           last_vehicle_type  = COALESCE(excluded.last_vehicle_type, customers.last_vehicle_type),
           last_vehicle_plate = COALESCE(excluded.last_vehicle_plate, customers.last_vehicle_plate),
           last_product       = COALESCE(excluded.last_product, customers.last_product),
           -- The spelling the operator used most recently wins, so a name
           -- corrected from "ali raza" to "Ali Raza" sticks.
           name               = excluded.name,
           company            = excluded.company,
           weighment_count    = customers.weighment_count + 1,
           last_seen_at       = excluded.last_seen_at,
           -- Weighing someone the manager had removed un-removes them: the
           -- truck is on the bridge, so the account plainly still exists.
           deleted            = 0`,
      )
      .run({
        id: newId(),
        name,
        company,
        phone: input.phone?.trim() || null,
        vehicle_type: input.vehicle_type ?? null,
        vehicle_plate: input.vehicle_plate?.trim() || null,
        product: input.product?.trim() || null,
        at,
      });
  }

  /** Matches on either name or company, so one box finds both. */
  search(query: string, limit = 20): Customer[] {
    const trimmed = query.trim();

    if (!trimmed) {
      // rowid breaks the tie: several customers created in the same
      // millisecond would otherwise come back in arbitrary order, and the
      // "most recent" list would reshuffle itself between refreshes.
      const rows = this.db
        .prepare(`${SELECT_ALL} WHERE ${LIVE} ORDER BY last_seen_at DESC, rowid DESC LIMIT ?`)
        .all(limit) as CustomerRow[];
      return rows.map(rowToCustomer);
    }

    // LIKE with an escaped pattern: a customer called "100% Traders" must not
    // turn into a wildcard search.
    const pattern = `%${trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = this.db
      .prepare(
        `${SELECT_ALL}
         WHERE ${LIVE}
           AND (name LIKE @pattern ESCAPE '\\' OR company LIKE @pattern ESCAPE '\\')
         ORDER BY
           -- Prefix matches first: someone typing "Ali" wants Ali Raza before
           -- "Muhammad Ali Traders".
           CASE WHEN name LIKE @prefix ESCAPE '\\' OR company LIKE @prefix ESCAPE '\\' THEN 0 ELSE 1 END,
           weighment_count DESC,
           last_seen_at DESC,
           rowid DESC
         LIMIT @limit`,
      )
      .all({
        pattern,
        prefix: `${trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
        limit,
      }) as CustomerRow[];

    return rows.map(rowToCustomer);
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM customers').get() as { n: number };
    return row.n;
  }
}

/**
 * Applies a customer list pulled from the manager.
 *
 * Matched on name+company rather than on the cloud id, because the same person
 * may already exist here from having been weighed before the manager ever
 * entered them — and two rows for one customer is the failure this matching
 * exists to prevent. The cloud id is recorded as it goes, so later syncs can be
 * certain rather than inferring.
 */
export function applyCustomerSync(
  db: Db,
  records: CustomerSyncRecord[],
): { added: number; updated: number; removed: number } {
  let added = 0;
  let updated = 0;
  let removed = 0;

  const find = db.prepare(
    'SELECT id, name, company, phone, deleted FROM customers WHERE LOWER(name) = ? AND LOWER(company) = ?',
  );
  const insert = db.prepare(
    `INSERT INTO customers (
       id, name, company, phone, weighment_count, first_seen_at, last_seen_at,
       cloud_id, deleted
     ) VALUES (@id, @name, @company, @phone, 0, @at, @at, @cloud_id, @deleted)`,
  );
  const update = db.prepare(
    `UPDATE customers
        SET name = @name, company = @company,
            phone = COALESCE(@phone, phone),
            cloud_id = @cloud_id, deleted = @deleted
      WHERE id = @id`,
  );

  db.transaction((batch: CustomerSyncRecord[]) => {
    for (const record of batch) {
      const name = record.name.trim();
      const company = (record.company ?? '').trim();
      if (!name) continue;

      const deleted = record.deleted_at ? 1 : 0;
      const existing = find.get(name.toLowerCase(), company.toLowerCase()) as
        | { id: string; name: string; company: string; phone: string | null; deleted: number }
        | undefined;

      if (!existing) {
        // A customer that arrives already removed is not news to anyone.
        if (deleted) continue;
        insert.run({
          id: newId(),
          name,
          company,
          phone: record.phone?.trim() || null,
          at: nowUtc(),
          cloud_id: record.id,
          deleted,
        });
        added += 1;
        continue;
      }

      const changed =
        existing.name !== name ||
        existing.company !== company ||
        existing.deleted !== deleted ||
        (record.phone != null && existing.phone !== record.phone);

      update.run({
        id: existing.id,
        name,
        company,
        phone: record.phone?.trim() || null,
        cloud_id: record.id,
        deleted,
      });

      if (deleted && existing.deleted === 0) removed += 1;
      else if (changed) updated += 1;
    }
  })(records);

  return { added, updated, removed };
}
