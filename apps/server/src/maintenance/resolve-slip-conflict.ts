/**
 * Slip-number conflict resolver (brief §11).
 *
 * The situation it exists for: an agent database is rebuilt or restored from an
 * older backup, so its slip counter restarts over numbers the cloud already
 * holds. The rebuilt agent then produces a *different* record claiming a slip
 * number an *older* record already occupies, and since `slip_number` is unique
 * in Mongo, every sync attempt is refused with a duplicate key error.
 *
 * The agent now quarantines such a record rather than retrying it forever, but
 * quarantine is not a fix: the weighment still exists only on the weighbridge
 * PC. Somebody has to decide which of the two records is real. That decision
 * cannot be automated — hence this script, run by hand, printing both records
 * side by side and changing nothing until asked.
 *
 *   pnpm --filter @suarza/server resolve-conflict SI-000001
 *   pnpm --filter @suarza/server resolve-conflict SI-000001 --delete-cloud
 *
 * The local record always wins, because the brief makes the agent the source of
 * truth: the cloud copy is a replica, and the weighbridge PC holds the one that
 * matches the paper the customer was handed.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { WeighmentModel } from '../models/weighment.model.js';
import { AuditModel } from '../models/audit.model.js';

/** Where the agent listens on the weighbridge PC. Overridable for a remote run. */
const AGENT_URL = process.env.AGENT_URL ?? 'http://127.0.0.1:3100';

interface CloudRecord {
  _id: string;
  slip_number: string;
  status: string;
  customer_name: string;
  customer_company: string;
  vehicle_plate: string;
  product: string;
  first_weight_kg: number;
  second_weight_kg: number | null;
  amount_charged: number;
  created_at: Date;
}

function describe(record: CloudRecord): string {
  return [
    `  id            ${record._id}`,
    `  slip          ${record.slip_number}  (${record.status})`,
    `  customer      ${record.customer_name} — ${record.customer_company}`,
    `  vehicle       ${record.vehicle_plate}`,
    `  product       ${record.product}`,
    `  weights       ${record.first_weight_kg} kg → ${record.second_weight_kg ?? '—'} kg`,
    `  charged       ${record.amount_charged}`,
    `  created       ${record.created_at.toISOString()}`,
  ].join('\n');
}

/**
 * The agent's copy, read over its HTTP API rather than by opening the SQLite
 * file: this script runs on the cloud server, which has no access to the
 * weighbridge PC's disk, and the agent is the only thing allowed to write that
 * database anyway.
 */
async function fetchAgentRecord(slip: string): Promise<CloudRecord | null> {
  try {
    const response = await fetch(`${AGENT_URL}/weighments/${slip}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { weighment?: Record<string, unknown> };
    const weighment = body.weighment;
    if (!weighment) return null;
    return {
      ...weighment,
      created_at: new Date(String(weighment.created_at)),
    } as unknown as CloudRecord;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const [slipArg, ...flags] = process.argv.slice(2);
  const slip = slipArg?.toUpperCase();
  const doDelete = flags.includes('--delete-cloud');

  if (!slip) {
    console.error('Usage: resolve-conflict <SLIP-NUMBER> [--delete-cloud]');
    process.exitCode = 1;
    return;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set — check apps/server/.env');

  await mongoose.connect(uri);
  try {
    const cloud = (await WeighmentModel.findOne({ slip_number: slip }).lean()) as CloudRecord | null;
    const agent = await fetchAgentRecord(slip);

    console.log(`\nSlip ${slip}\n${'='.repeat(40)}`);

    console.log('\nCLOUD copy:');
    console.log(cloud ? describe(cloud) : '  (none — nothing is occupying this slip number)');

    console.log(`\nAGENT copy (${AGENT_URL}):`);
    console.log(
      agent
        ? describe(agent)
        : '  (unreachable or absent — is the agent running on this machine?)',
    );

    if (!cloud || !agent) {
      console.log('\nNo conflict to resolve: both copies are needed to compare.');
      return;
    }

    if (cloud._id === agent._id) {
      console.log('\nNo conflict: both are the same record. Nothing to do.');
      return;
    }

    console.log(
      '\nCONFLICT: two different records claim this slip number.\n' +
        'The cloud copy above is the orphan — its agent database no longer exists,\n' +
        'which is why the agent keeps being refused.',
    );

    if (!doDelete) {
      console.log(
        '\nNothing has been changed. Re-run with --delete-cloud to remove the cloud\n' +
          'orphan and let the agent copy through:\n' +
          `  pnpm --filter @suarza/server resolve-conflict ${slip} --delete-cloud\n`,
      );
      return;
    }

    // Print the doomed record in full first: this is the last moment it exists,
    // and a console scrollback is a cheaper backup than a restore from Atlas.
    console.log('\nDeleting the cloud orphan. Full document, for the record:');
    console.log(JSON.stringify(cloud, null, 2));

    const audits = await AuditModel.deleteMany({ weighment_id: cloud._id });
    const removed = await WeighmentModel.deleteOne({ _id: cloud._id });
    console.log(
      `\nDeleted ${removed.deletedCount} weighment and ${audits.deletedCount} audit entr(ies).`,
    );

    // The agent quarantined its copy when the cloud refused it; clearing that is
    // what actually puts the record back in the outbox.
    const retry = await fetch(`${AGENT_URL}/sync/blocked/${slip}/retry`, { method: 'POST' });
    console.log(
      retry.ok
        ? `Agent has un-quarantined ${slip}; it will sync on the next sweep.`
        : `Could not reach the agent to un-quarantine ${slip} (HTTP ${retry.status}).\n` +
            `Run this on the weighbridge PC once the agent is up:\n` +
            `  curl -X POST ${AGENT_URL}/sync/blocked/${slip}/retry`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
