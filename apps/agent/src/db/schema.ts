/**
 * SQLite schema — the local source of truth (brief §4, §7.3).
 *
 * Column names match the canonical weighment shape in `@suarza/shared` exactly,
 * so a row maps to the DTO and on to the Mongo document with no translation
 * layer that could drift between tiers.
 *
 * Migrations are applied by `user_version`: each entry runs once, in order,
 * inside a transaction. Never edit a shipped migration — append a new one.
 */

import type { Database } from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  up: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial weighments + audit + meta',
    up: `
      CREATE TABLE weighments (
        id                TEXT PRIMARY KEY,
        slip_number       TEXT NOT NULL UNIQUE,
        status            TEXT NOT NULL CHECK (status IN ('OPEN', 'COMPLETED', 'VOID')),
        station_id        TEXT NOT NULL,

        customer_name     TEXT NOT NULL,
        customer_company  TEXT NOT NULL,
        customer_phone    TEXT,
        vehicle_type      TEXT NOT NULL,
        vehicle_plate     TEXT NOT NULL,
        container_number  TEXT,
        product           TEXT NOT NULL,

        first_weight_kg   REAL NOT NULL,
        first_weight_at   TEXT NOT NULL,
        first_weight_src  TEXT NOT NULL CHECK (first_weight_src IN ('SERIAL', 'MANUAL')),
        second_weight_kg  REAL,
        second_weight_at  TEXT,
        second_weight_src TEXT CHECK (second_weight_src IN ('SERIAL', 'MANUAL')),
        net_weight_kg     REAL NOT NULL DEFAULT 0,

        amount_charged    REAL NOT NULL DEFAULT 0,
        currency          TEXT NOT NULL DEFAULT 'PKR',

        operator_username TEXT NOT NULL,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        void_reason       TEXT,
        voided_at         TEXT,

        -- Local-only outbox bookkeeping. Never sent as data (brief §6, §11).
        synced            INTEGER NOT NULL DEFAULT 0,
        sync_attempts     INTEGER NOT NULL DEFAULT 0,
        last_attempt_at   TEXT
      );

      -- Reports and the dashboard filter on the real event time, so this is
      -- the index that matters, not created_at.
      CREATE INDEX idx_weighments_first_weight_at ON weighments (first_weight_at DESC);
      CREATE INDEX idx_weighments_status ON weighments (status);
      -- Drives the "this plate already has an OPEN ticket" warning (brief §3B).
      CREATE INDEX idx_weighments_plate_status ON weighments (vehicle_plate, status);
      -- The outbox sweep: partial index so it stays tiny once records drain.
      CREATE INDEX idx_weighments_unsynced ON weighments (synced) WHERE synced = 0;

      CREATE TABLE audit_log (
        id              TEXT PRIMARY KEY,
        weighment_id    TEXT NOT NULL,
        action          TEXT NOT NULL CHECK (
                          action IN ('CREATED', 'SECOND_WEIGHT', 'COMPLETED',
                                     'VOIDED', 'REPRINTED', 'MANUAL_WEIGHT')),
        actor_username  TEXT NOT NULL,
        detail          TEXT NOT NULL DEFAULT '{}',
        at              TEXT NOT NULL,
        synced          INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (weighment_id) REFERENCES weighments (id)
      );

      CREATE INDEX idx_audit_weighment ON audit_log (weighment_id, at);
      CREATE INDEX idx_audit_unsynced ON audit_log (synced) WHERE synced = 0;

      -- Small key/value store: slip counter, settings, sync bookkeeping.
      CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
];

MIGRATIONS.push({
  version: 2,
  name: 'customer directory',
  up: `
    -- Built up from the weighments themselves: there is no separate "add a
    -- customer" step, so the directory can never be stale or half-filled in.
    -- Identified by name + company, because that is the pair an operator types.
    CREATE TABLE customers (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL,
      company            TEXT NOT NULL,
      phone              TEXT,
      last_vehicle_type  TEXT,
      last_vehicle_plate TEXT,
      last_product       TEXT,
      weighment_count    INTEGER NOT NULL DEFAULT 0,
      first_seen_at      TEXT NOT NULL,
      last_seen_at       TEXT NOT NULL
    );

    -- Case-insensitive, so "ali raza" and "Ali Raza" are one customer rather
    -- than two near-identical entries in the dropdown.
    CREATE UNIQUE INDEX idx_customers_identity
      ON customers (LOWER(name), LOWER(company));
    CREATE INDEX idx_customers_recent ON customers (last_seen_at DESC);
  `,
});

MIGRATIONS.push({
  version: 3,
  name: 'outbox quarantine for permanently rejected records',
  up: `
    -- A record the cloud will never accept — a slip number another record
    -- already holds, say, after this database was rebuilt and the counter
    -- restarted. Retrying it forever is an infinite loop that also blocks every
    -- record queued behind it, so the reason is stored and the record leaves
    -- the outbox. NULL means "still in the normal retry path".
    ALTER TABLE weighments ADD COLUMN sync_blocked_reason TEXT;
    ALTER TABLE weighments ADD COLUMN sync_blocked_at TEXT;
  `,
});

MIGRATIONS.push({
  version: 4,
  name: 'payment status on a weighment',
  up: `
    -- Did the customer pay at the gate, or is it going on their account?
    -- Defaulted to PAID because that is the normal case, and because every
    -- record that existed before this column was a cash weighing.
    ALTER TABLE weighments ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'PAID'
      CHECK (payment_status IN ('PAID', 'ON_ACCOUNT'));
  `,
});

MIGRATIONS.push({
  version: 5,
  name: 'manager-kept customers and vehicle types',
  up: `
    -- What the vehicle type was called when the slip was made. Carried on the
    -- record so a reprint after the manager renames a type still matches the
    -- copy the customer walked away with.
    ALTER TABLE weighments ADD COLUMN vehicle_type_label TEXT NOT NULL DEFAULT '';

    -- Customers can now also come from the manager, not only from being
    -- weighed. cloud_id links the two views of the same person; deleted is how
    -- a removal travels, since a bridge that never saw it has no other way to
    -- learn the customer is gone.
    ALTER TABLE customers ADD COLUMN cloud_id TEXT;
    ALTER TABLE customers ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

    -- The rate card, as the manager keeps it. The operator reads it and can no
    -- longer edit it; this copy is what keeps the bridge working offline.
    CREATE TABLE vehicle_types (
      key        TEXT PRIMARY KEY,
      label      TEXT NOT NULL,
      rate_pkr   REAL NOT NULL DEFAULT 0,
      deleted    INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX idx_vehicle_types_live ON vehicle_types (deleted) WHERE deleted = 0;
  `,
});

export function migrate(db: Database): number {
  const current = db.pragma('user_version', { simple: true }) as number;
  const pending = MIGRATIONS.filter((m) => m.version > current).sort(
    (a, b) => a.version - b.version,
  );

  for (const migration of pending) {
    // better-sqlite3's `exec` cannot run inside a prepared transaction, so the
    // transaction is opened manually around the whole migration.
    db.exec('BEGIN');
    try {
      db.exec(migration.up);
      db.pragma(`user_version = ${migration.version}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(
        `Migration ${migration.version} (${migration.name}) failed: ${(error as Error).message}`,
      );
    }
  }

  return pending.length;
}

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
