/**
 * The ledger: balances, statements, and the posting rules.
 *
 * Two ways an entry appears:
 *
 *  - automatically, when a COMPLETED weighing syncs up from the weighbridge
 *  - by hand, when the manager records a payment or a correction
 *
 * The automatic path has to survive the sync retrying, a slip being corrected,
 * and a slip being voided — all of which happen in normal operation — without
 * ever charging a customer twice or leaving a charge standing for a weighing
 * that was cancelled. That is what most of this file is about.
 */

import {
  balanceState,
  customerKey,
  newId,
  signedAmount,
  type CreateLedgerEntryInput,
  type LedgerCustomer,
  type LedgerDirection,
  type LedgerEntry,
  type LedgerEntryWithBalance,
  type LedgerQuery,
  type LedgerSummary,
  type Weighment,
} from '@suarza/shared';
import mongoose from 'mongoose';
import { LedgerCustomerModel, LedgerEntryModel } from '../models/ledger.model.js';
import type { LedgerEntryDocument } from '../models/ledger.model.js';
import { ApiError } from '../errors.js';

const isValidObjectId = (id: string) => mongoose.isValidObjectId(id);

/** Rupees, to the paisa. Floats accumulate error; money must not. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toEntry(doc: LedgerEntryDocument): LedgerEntry {
  return {
    id: String(doc._id),
    customer_id: doc.customer_id,
    direction: doc.direction as LedgerDirection,
    kind: doc.kind as LedgerEntry['kind'],
    amount_pkr: doc.amount_pkr,
    at: new Date(doc.at).toISOString(),
    note: doc.note ?? null,
    weighment_id: doc.weighment_id ?? null,
    slip_number: doc.slip_number ?? null,
    created_by: doc.created_by,
    created_at: new Date(doc.created_at).toISOString(),
    voided: doc.voided,
    voided_at: doc.voided_at ? new Date(doc.voided_at).toISOString() : null,
    voided_by: doc.voided_by ?? null,
    void_reason: doc.void_reason ?? null,
  };
}

/**
 * Totals per customer, from the entries themselves.
 *
 * One aggregation for every customer asked about, rather than one query each:
 * the list page shows 25 customers and would otherwise fire 25 round trips.
 */
async function totalsFor(customerIds: string[]): Promise<
  Map<
    string,
    { balance: number; charged: number; paid: number; count: number; lastAt: Date | null }
  >
> {
  if (customerIds.length === 0) return new Map();

  const rows = await LedgerEntryModel.aggregate<{
    _id: string;
    credits: number;
    debits: number;
    charged: number;
    paid: number;
    count: number;
    lastAt: Date | null;
  }>([
    // Voided entries stay in the history but must not move the balance.
    { $match: { customer_id: { $in: customerIds }, voided: false } },
    {
      $group: {
        _id: '$customer_id',
        credits: {
          $sum: { $cond: [{ $eq: ['$direction', 'CREDIT'] }, '$amount_pkr', 0] },
        },
        debits: {
          $sum: { $cond: [{ $eq: ['$direction', 'DEBIT'] }, '$amount_pkr', 0] },
        },
        charged: {
          $sum: { $cond: [{ $eq: ['$kind', 'WEIGHING'] }, '$amount_pkr', 0] },
        },
        paid: {
          $sum: { $cond: [{ $eq: ['$kind', 'PAYMENT'] }, '$amount_pkr', 0] },
        },
        count: { $sum: 1 },
        lastAt: { $max: '$at' },
      },
    },
  ]);

  return new Map(
    rows.map((row) => [
      row._id,
      {
        balance: round2(row.credits - row.debits),
        charged: round2(row.charged),
        paid: round2(row.paid),
        count: row.count,
        lastAt: row.lastAt ?? null,
      },
    ]),
  );
}

const EMPTY_TOTALS = { balance: 0, charged: 0, paid: 0, count: 0, lastAt: null };

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface LedgerCustomerPage {
  customers: LedgerCustomer[];
  total: number;
  page: number;
  page_size: number;
}

export async function listCustomers(query: LedgerQuery): Promise<LedgerCustomerPage> {
  const filter: Record<string, unknown> = {};
  if (query.q) {
    // Escaped: a customer called "A+B (Pvt)" must not be read as a pattern.
    const safe = query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(safe, 'i');
    // The match key too: it is shown in the table, so it should be searchable.
    filter.$or = [
      { name: pattern },
      { company: pattern },
      { phone: pattern },
      { match_key: pattern },
    ];
  }

  const matching = await LedgerCustomerModel.find(filter).lean();
  const totals = await totalsFor(matching.map((doc) => String(doc._id)));

  const all: LedgerCustomer[] = matching.map((doc) => {
    const t = totals.get(String(doc._id)) ?? EMPTY_TOTALS;
    return {
      id: String(doc._id),
      match_key: doc.match_key,
      name: doc.name,
      company: doc.company ?? '',
      phone: doc.phone ?? null,
      balance_pkr: t.balance,
      total_charged_pkr: t.charged,
      total_paid_pkr: t.paid,
      entry_count: t.count,
      last_entry_at: t.lastAt ? new Date(t.lastAt).toISOString() : null,
    };
  });

  // Filtered here rather than in the query: the balance is derived, so the
  // database cannot filter on it without storing a total we have deliberately
  // chosen not to keep.
  const filtered =
    query.status === 'all' ? all : all.filter((c) => balanceState(c.balance_pkr) === query.status);

  // Deepest in the red first — that is the list a manager is looking for. Ties
  // and settled accounts fall back to alphabetical so the order is stable.
  filtered.sort((a, b) => a.balance_pkr - b.balance_pkr || a.name.localeCompare(b.name));

  const start = (query.page - 1) * query.page_size;
  return {
    customers: filtered.slice(start, start + query.page_size),
    total: filtered.length,
    page: query.page,
    page_size: query.page_size,
  };
}

export async function getCustomer(id: string): Promise<LedgerCustomer> {
  // A malformed id is a 404, not a 500: these arrive from URLs people edit.
  const doc = isValidObjectId(id) ? await LedgerCustomerModel.findById(id).lean() : null;
  if (!doc) throw new ApiError('NOT_FOUND', 'No ledger account for that customer.', { id });

  const t = (await totalsFor([id])).get(id) ?? EMPTY_TOTALS;
  return {
    id,
    match_key: doc.match_key,
    name: doc.name,
    company: doc.company ?? '',
    phone: doc.phone ?? null,
    balance_pkr: t.balance,
    total_charged_pkr: t.charged,
    total_paid_pkr: t.paid,
    entry_count: t.count,
    last_entry_at: t.lastAt ? new Date(t.lastAt).toISOString() : null,
  };
}

/**
 * The statement: every entry, oldest first, each with the balance as it stood
 * afterwards.
 *
 * Voided entries are included — they are part of the history — but contribute
 * nothing, so the running balance steps over them.
 */
export async function listEntries(customerId: string): Promise<LedgerEntryWithBalance[]> {
  const docs = await LedgerEntryModel.find({ customer_id: customerId })
    .sort({ at: 1, created_at: 1 })
    .lean();

  let balance = 0;
  return docs.map((doc) => {
    const entry = toEntry(doc as LedgerEntryDocument);
    if (!entry.voided) balance = round2(balance + signedAmount(entry.direction, entry.amount_pkr));
    return { ...entry, balance_after_pkr: balance };
  });
}

export async function summary(): Promise<LedgerSummary> {
  const ids = (await LedgerCustomerModel.find().select({ _id: 1 }).lean()).map((d) => String(d._id));
  const totals = await totalsFor(ids);

  let receivable = 0;
  let advance = 0;
  let owing = 0;
  let inCredit = 0;

  for (const id of ids) {
    const balance = totals.get(id)?.balance ?? 0;
    switch (balanceState(balance)) {
      case 'owing':
        receivable += -balance;
        owing += 1;
        break;
      case 'credit':
        advance += balance;
        inCredit += 1;
        break;
      case 'settled':
        break;
    }
  }

  return {
    total_receivable_pkr: round2(receivable),
    total_advance_pkr: round2(advance),
    customers_owing: owing,
    customers_in_credit: inCredit,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function ensureCustomer(input: {
  name: string;
  company: string;
  phone?: string | null;
}): Promise<LedgerCustomer> {
  const key = customerKey(input.name, input.company);
  const now = new Date();

  const doc = await LedgerCustomerModel.findOneAndUpdate(
    { match_key: key },
    {
      // The display spelling follows the most recent sighting, but the identity
      // does not: the key is normalised, so "ALI RAZA" and "Ali Raza" stay one
      // account whichever was typed last.
      $set: {
        name: input.name.trim(),
        company: input.company.trim(),
        updated_at: now,
        ...(input.phone ? { phone: input.phone } : {}),
      },
      $setOnInsert: { created_at: now, match_key: key },
    },
    { upsert: true, new: true },
  );

  return getCustomer(String(doc._id));
}

export async function addEntry(
  customerId: string,
  input: CreateLedgerEntryInput,
  actor: string,
): Promise<LedgerEntry> {
  // Proves the account exists before writing an entry that would otherwise
  // dangle against nothing.
  await getCustomer(customerId);

  const doc = await LedgerEntryModel.create({
    _id: newId(),
    customer_id: customerId,
    direction: input.direction,
    kind: input.kind,
    amount_pkr: round2(input.amount_pkr),
    at: input.at ? new Date(input.at) : new Date(),
    note: input.note?.trim() || null,
    weighment_id: null,
    slip_number: null,
    created_by: actor,
    created_at: new Date(),
    voided: false,
  });

  return toEntry(doc.toObject() as LedgerEntryDocument);
}

export async function voidEntry(
  entryId: string,
  reason: string,
  actor: string,
): Promise<LedgerEntry> {
  const doc = await LedgerEntryModel.findById(entryId);
  if (!doc) throw new ApiError('NOT_FOUND', 'No such ledger entry.', { id: entryId });

  if (doc.kind === 'WEIGHING') {
    // Voiding the charge while the slip still stands would put the ledger and
    // the weighbridge record into permanent disagreement. Void the weighment
    // instead and the charge follows automatically.
    throw new ApiError(
      'VALIDATION_ERROR',
      'A weighing charge cannot be voided here. Void the weighment itself and this entry will follow.',
      { id: entryId },
    );
  }

  if (doc.voided) return toEntry(doc.toObject() as LedgerEntryDocument);

  doc.voided = true;
  doc.voided_at = new Date();
  doc.voided_by = actor;
  doc.void_reason = reason.trim();
  await doc.save();

  return toEntry(doc.toObject() as LedgerEntryDocument);
}

// ---------------------------------------------------------------------------
// The automatic side: charges from weighings
// ---------------------------------------------------------------------------

/**
 * Brings the ledger into line with a batch of synced weighments.
 *
 * Called from ingest, so it runs on every sync — including the retries that
 * re-send a batch the cloud already has. It is therefore written to be safe to
 * run any number of times on the same records:
 *
 *  - one entry per weighment, keyed on the weighment id
 *  - a corrected amount updates the entry rather than adding another
 *  - a voided weighment voids its charge; an un-voided one brings it back
 *  - an OPEN weighing posts nothing — there is no final amount yet
 *
 * A failure here must never fail the sync: the weighbridge's records reaching
 * the cloud matters more than the ledger being instantly current, and the next
 * batch will bring it into line anyway.
 */
export async function postWeighmentCharges(weighments: Weighment[]): Promise<number> {
  let posted = 0;

  for (const weighment of weighments) {
    const chargeable = weighment.status === 'COMPLETED' && weighment.amount_charged > 0;
    const amount = round2(weighment.amount_charged);
    const at = new Date(weighment.second_weight_at ?? weighment.created_at);

    // A weighing settled at the gate posts BOTH lines: the charge, and the
    // payment that cleared it. The balance nets to zero, which is the point —
    // a customer who paid cash must not appear in "total owed to you" — while
    // the statement still shows every weighing they have ever had.
    const wanted: { kind: 'WEIGHING' | 'PAYMENT'; direction: LedgerDirection; note: string | null }[] =
      chargeable
        ? weighment.payment_status === 'PAID'
          ? [
              { kind: 'WEIGHING', direction: 'DEBIT', note: null },
              { kind: 'PAYMENT', direction: 'CREDIT', note: 'Paid at the weighbridge' },
            ]
          : [{ kind: 'WEIGHING', direction: 'DEBIT', note: null }]
        : [];

    const existing = await LedgerEntryModel.find({ weighment_id: weighment.id });

    // Anything the slip no longer calls for — it was voided, its charge was
    // corrected away, or it moved from PAID to ON_ACCOUNT — is voided rather
    // than deleted. The customer may already have been told about it.
    for (const entry of existing) {
      if (wanted.some((w) => w.kind === entry.kind)) continue;
      if (entry.voided) continue;

      entry.voided = true;
      entry.voided_at = new Date();
      entry.voided_by = 'system';
      entry.void_reason =
        weighment.status === 'VOID'
          ? `Weighment ${weighment.slip_number} was voided`
          : `Weighment ${weighment.slip_number} no longer carries this entry`;
      await entry.save();
      posted += 1;
    }

    if (wanted.length === 0) continue;

    const customer = await ensureCustomer({
      name: weighment.customer_name,
      company: weighment.customer_company,
      phone: weighment.customer_phone ?? null,
    });

    for (const want of wanted) {
      const entry = existing.find((candidate) => candidate.kind === want.kind);

      if (!entry) {
        await LedgerEntryModel.create({
          _id: newId(),
          customer_id: customer.id,
          direction: want.direction,
          kind: want.kind,
          amount_pkr: amount,
          at,
          note: want.note,
          weighment_id: weighment.id,
          slip_number: weighment.slip_number,
          created_by: 'system',
          created_at: new Date(),
          voided: false,
        });
        posted += 1;
        continue;
      }

      const unchanged =
        entry.amount_pkr === amount && !entry.voided && entry.customer_id === customer.id;
      if (unchanged) continue;

      // A corrected slip: same entries, new figures. Un-voids itself if the
      // weighment came back from VOID.
      entry.amount_pkr = amount;
      entry.customer_id = customer.id;
      entry.at = at;
      entry.slip_number = weighment.slip_number;
      entry.voided = false;
      entry.voided_at = null;
      entry.voided_by = null;
      entry.void_reason = null;
      await entry.save();
      posted += 1;
    }
  }

  return posted;
}
