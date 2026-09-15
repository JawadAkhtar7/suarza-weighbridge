/**
 * Posts ledger charges for weighments that were already in the cloud before
 * the ledger existed.
 *
 * Charges are normally posted as weighments sync up, so this is only needed
 * once, when the module is first deployed onto a database that already holds
 * records. It is safe to run again: every charge is keyed on the weighment id,
 * so a second run updates nothing and creates nothing.
 *
 *   pnpm --filter @suarza/server backfill-ledger          # report only
 *   pnpm --filter @suarza/server backfill-ledger --write  # actually post
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import type { Weighment } from '@suarza/shared';
import { WeighmentModel } from '../models/weighment.model.js';
import { LedgerEntryModel } from '../models/ledger.model.js';
import { postWeighmentCharges } from '../services/ledger.service.js';

const BATCH = 200;

function toWeighment(doc: Record<string, unknown>): Weighment {
  // The ledger only reads identity, status and money off the record, but the
  // shape has to match what ingest passes so one code path serves both.
  return {
    ...doc,
    id: String(doc._id),
    first_weight_at: new Date(doc.first_weight_at as Date).toISOString(),
    second_weight_at: doc.second_weight_at
      ? new Date(doc.second_weight_at as Date).toISOString()
      : null,
    created_at: new Date(doc.created_at as Date).toISOString(),
    updated_at: new Date(doc.updated_at as Date).toISOString(),
  } as unknown as Weighment;
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set — check apps/server/.env');

  await mongoose.connect(uri);
  try {
    const total = await WeighmentModel.countDocuments({ status: 'COMPLETED' });
    const already = await LedgerEntryModel.countDocuments({ kind: 'WEIGHING' });

    console.log(`Completed weighments: ${total}`);
    console.log(`Charges already posted: ${already}`);

    if (!write) {
      console.log('\nNothing has been changed. Re-run with --write to post the missing charges.');
      return;
    }

    let processed = 0;
    let posted = 0;

    for (let skip = 0; skip < total; skip += BATCH) {
      const docs = await WeighmentModel.find({ status: 'COMPLETED' })
        .sort({ created_at: 1 })
        .skip(skip)
        .limit(BATCH)
        .lean();

      posted += await postWeighmentCharges(docs.map((doc) => toWeighment(doc)));
      processed += docs.length;
      console.log(`  ${processed}/${total} examined, ${posted} charge(s) written`);
    }

    console.log(`\nDone. ${posted} charge(s) written or corrected.`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
