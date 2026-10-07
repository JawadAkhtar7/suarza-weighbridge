/**
 * Throw away camera stills from completed years.
 *
 * Run from cron once a month:
 *   cd /opt/suarza && pnpm --filter @suarza/server prune-captures
 *
 * Keeps the current year and the one before it, so on any day of 2027 the
 * 2026 pictures are still there and 2025's are gone. That is "a year" in the
 * sense a person means it — not a rolling 365 days that would delete last
 * December's slip on this December's first.
 *
 * Deliberately a whole year at a time and a directory removal rather than a
 * walk. It is why the paths start with the year, and it means the sweep costs
 * the same whether it is clearing ten pictures or ten thousand.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { loadConfig } from '../config.js';
import { pruneCaptureYear, captureRoot } from '../services/capture.service.js';

/** How many completed years to keep besides the current one. */
const KEEP_YEARS = 1;

async function main(): Promise<void> {
  const config = loadConfig();
  await mongoose.connect(config.MONGODB_URI);

  const thisYear = new Date().getUTCFullYear();
  const oldestKept = thisYear - KEEP_YEARS;

  console.info(`Capture folder: ${captureRoot()}`);
  console.info(`Keeping ${oldestKept} onwards; anything earlier goes.`);

  let removed = 0;
  /*
   * Walk back a decade rather than reading the directory. A year folder that
   * is already gone costs one failed stat, and this way a box that missed a
   * few runs catches up instead of only ever clearing the year before last.
   */
  for (let year = oldestKept - 1; year > oldestKept - 11; year--) {
    const rows = await pruneCaptureYear(year);
    if (rows > 0) {
      console.info(`  ${year}: removed ${rows} image(s)`);
      removed += rows;
    }
  }

  console.info(removed === 0 ? 'Nothing to remove.' : `Removed ${removed} image(s) in total.`);
  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  console.error('Prune failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
