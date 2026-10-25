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

MIGRATIONS.push({
  version: 6,
  name: 'camera stills',
  up: `
    -- One row per picture, not four columns on the weighment.
    --
    -- Pictures are files, and files sync differently from records: the
    -- weighment travels as JSON in a batch, a JPEG cannot. Its own table with
    -- its own 'synced' flag lets the image follow its weighment up to the
    -- cloud on its own schedule, and lets a bridge with no cameras carry no
    -- empty columns.
    CREATE TABLE captures (
      id           TEXT PRIMARY KEY,
      weighment_id TEXT NOT NULL,
      -- Denormalised on purpose: the file is named after the slip, and a
      -- prune walking the table should not have to join to read a filename.
      slip_number  TEXT NOT NULL,
      pass         TEXT NOT NULL CHECK (pass IN ('FIRST', 'SECOND')),
      view         TEXT NOT NULL CHECK (view IN ('FRONT', 'SIDE')),
      -- Relative to CAPTURE_PATH, so moving the folder does not rewrite rows.
      path         TEXT NOT NULL,
      bytes        INTEGER NOT NULL,
      taken_at     TEXT NOT NULL,
      synced       INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (weighment_id) REFERENCES weighments (id)
    );

    -- One picture per weighment, pass and view: a retried capture replaces
    -- rather than piling up a second copy of the same moment.
    CREATE UNIQUE INDEX idx_captures_slot ON captures (weighment_id, pass, view);
    CREATE INDEX idx_captures_weighment ON captures (weighment_id);
    CREATE INDEX idx_captures_unsynced ON captures (synced) WHERE synced = 0;
  `,
});

MIGRATIONS.push({
  version: 7,
  name: 'users who may change the settings',
  up: `
    -- Who is allowed to change this station's settings.
    --
    -- No roles and no sessions: one thing is protected, and the question at
    -- the moment of saving is only whether this person may. See db/users.ts
    -- for why the password is a scrypt hash rather than the password.
    CREATE TABLE users (
      username      TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
  `,
});

MIGRATIONS.push({
  version: 8,
  name: 'operator sign-in: accounts, sessions and shift log',
  up: `
    -- The operator accounts, as the manager keeps them in the cloud.
    --
    -- A COPY, pulled with the rest of the manager's lists, and the reason it
    -- is a copy is the only reason it exists: a shift starts at six in the
    -- morning and the link to the cloud is down as often as not. Asking the
    -- internet whether somebody may start work would mean a yard that cannot
    -- weigh a truck because a router in another city is rebooting.
    --
    -- The hash is bcrypt because that is what the cloud stores; this machine
    -- only ever compares against it and can produce no hash of its own.
    CREATE TABLE operator_accounts (
      username      TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      slot          TEXT NOT NULL CHECK (slot IN ('MORNING', 'NIGHT', 'ADMIN')),
      password_hash TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      synced_at     TEXT NOT NULL
    );

    -- A shift in progress.
    --
    -- In the database rather than in memory so that restarting the agent —
    -- a deploy, a Windows update, a power cut — does not throw the operator
    -- out at eleven at night. One row per token; ending a shift deletes it.
    CREATE TABLE operator_sessions (
      token      TEXT PRIMARY KEY,
      username   TEXT NOT NULL,
      name       TEXT NOT NULL,
      slot       TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    -- Shifts starting and ending, on their way to the manager's log.
    --
    -- Written here first and pushed up afterwards, like every other thing
    -- this machine records: the shift has started whether or not anybody can
    -- be told about it yet.
    CREATE TABLE operator_logs (
      id       TEXT PRIMARY KEY,
      kind     TEXT NOT NULL CHECK (kind IN ('SHIFT_START', 'SHIFT_END')),
      username TEXT NOT NULL,
      name     TEXT NOT NULL,
      slot     TEXT NOT NULL,
      detail   TEXT,
      at       TEXT NOT NULL,
      synced   INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX idx_operator_logs_unsynced ON operator_logs (synced) WHERE synced = 0;
  `,
});

MIGRATIONS.push({
  version: 9,
  name: 'the cash a shift hands over',
  up: `
    -- A shift's own id, shared by its start and its end.
    --
    -- Not the session token: the token opens the screen on this PC and has
    -- no business leaving it, while this id travels to the cloud so the
    -- manager's audit screen can read a start and an end back as one shift.
    ALTER TABLE operator_sessions ADD COLUMN session_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE operator_logs ADD COLUMN session_id TEXT;

    -- The four amounts and four names, as typed, kept as JSON.
    --
    -- JSON rather than eight columns because this machine never reads inside
    -- it: the operator types it, the row goes up, and the cloud is where it
    -- is added up. Eight columns would be eight migrations the day the
    -- client wants a fifth figure.
    ALTER TABLE operator_logs ADD COLUMN cash TEXT;
  `,
});

MIGRATIONS.push({
  version: 10,
  name: 'every movement of cash during a shift, not just two',
  up: `
    -- One row per handing-over, with its own time.
    --
    -- A LIST, where the previous version kept one set of figures per end of
    -- the shift and overwrote it. Money changes hands more than twice in a
    -- day — the manager collects at noon, a colleague covers an hour, the
    -- float is topped up — and overwriting meant a shift could only ever
    -- show the last thing that happened.
    --
    -- Its own table rather than more columns on operator_logs: these are not
    -- events in the shift's life, they are a ledger of one kind of thing,
    -- and they sync on their own because a movement can be written down long
    -- after the entry it belongs beside.
    CREATE TABLE operator_cash_entries (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL,
      username      TEXT NOT NULL,
      stage         TEXT NOT NULL CHECK (stage IN ('START', 'END')),
      person_name   TEXT NOT NULL DEFAULT '',
      person_taken  REAL NOT NULL DEFAULT 0,
      person_given  REAL NOT NULL DEFAULT 0,
      manager_name  TEXT NOT NULL DEFAULT '',
      manager_taken REAL NOT NULL DEFAULT 0,
      manager_given REAL NOT NULL DEFAULT 0,
      at            TEXT NOT NULL,
      synced        INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX idx_cash_entries_session ON operator_cash_entries (session_id, at);
    CREATE INDEX idx_cash_entries_unsynced ON operator_cash_entries (synced) WHERE synced = 0;
  `,
});

MIGRATIONS.push({
  version: 11,
  name: 'a load the owner declared rather than the bridge weighing it',
  up: `
    -- The container re-weigh (step 4) issues a slip on the customer's own
    -- figure for what is inside his container. Stored rather than worked
    -- out, because the slip must carry its disclaimer for ever — on a
    -- reprint, and on the page behind the QR code.
    --
    -- Not the same thing as second_weight_src = MANUAL: an operator typing
    -- a figure the indicator could not read is the bridge's own reading by
    -- another route, and a customer telling us what he is carrying is not.
    ALTER TABLE weighments ADD COLUMN owner_declared INTEGER NOT NULL DEFAULT 0;
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
