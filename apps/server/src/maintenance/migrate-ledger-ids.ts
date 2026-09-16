/**
 * Moves ledger accounts from a derived string id to a database-generated one.
 *
 * The first version of the ledger used `customerKey(name, company)` as the
 * `_id`. That made the id change whenever a name was corrected, and put a
 * customer's name into every URL. Accounts now carry a generated id, with the
 * key kept in `match_key` where it can still do its matching job.
 *
 * A document's `_id` cannot be changed in place, so each account is rewritten
 * under a new id and its entries repointed. Run once per database:
 *
 *   pnpm --filter @suarza/server migrate-ledger-ids          # report only
 *   pnpm --filter @suarza/server migrate-ledger-ids --write  # do it
 *
 * Safe to run again: accounts that already have a generated id are skipped.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { LedgerCustomerModel, LedgerEntryModel } from '../models/ledger.model.js';

/** The old ids were `name|company`; the new ones are 24 hex characters. */
function isLegacyId(id: unknown): boolean {
  return typeof id === 'string' && !mongoose.isValidObjectId(id);
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set — check apps/server/.env');

  await mongoose.connect(uri);
  try {
    const collection = mongoose.connection.db!.collection('ledger_customers');
    const docs = await collection.find({}).toArray();
    const legacy = docs.filter((doc) => isLegacyId(doc._id));

    console.log(`Ledger accounts: ${docs.length}`);
    console.log(`Still on the old id: ${legacy.length}`);

    if (legacy.length === 0) {
      console.log('\nNothing to do.');
      return;
    }

    for (const doc of legacy) {
      console.log(`  ${String(doc._id)}  →  new id, match_key "${String(doc._id)}"`);
    }

    if (!write) {
      console.log('\nNothing has been changed. Re-run with --write to migrate.');
      return;
    }

    let moved = 0;
    let repointed = 0;

    for (const doc of legacy) {
      const oldId = String(doc._id);
      const created = await LedgerCustomerModel.create({
        // The old id WAS the key, so it carries straight over.
        match_key: doc.match_key ?? oldId,
        name: doc.name,
        company: doc.company ?? '',
        phone: doc.phone ?? null,
        created_at: doc.created_at ?? new Date(),
        updated_at: new Date(),
      });

      const result = await LedgerEntryModel.updateMany(
        { customer_id: oldId },
        { $set: { customer_id: String(created._id) } },
      );

      await collection.deleteOne({ _id: oldId as never });

      moved += 1;
      repointed += result.modifiedCount;
      console.log(`  moved ${oldId} → ${String(created._id)} (${result.modifiedCount} entries)`);
    }

    console.log(`\nDone. ${moved} account(s) moved, ${repointed} entr(ies) repointed.`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
