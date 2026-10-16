/**
 * Camera stills on the cloud: writing them down, finding them again, and
 * throwing the old ones away.
 */

import { mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { CaptureModel } from '../models/capture.model.js';

export interface StoreCaptureInput {
  id: string;
  weighmentId: string;
  slipNumber: string;
  pass: 'FIRST' | 'SECOND';
  view: 'FRONT' | 'SIDE';
  takenAt: Date;
  body: Buffer;
}

/** Where the JPEGs live. Outside the repo, so a deploy cannot delete them. */
let root = resolve(process.env['CAPTURE_PATH'] ?? '/var/lib/suarza/captures');

export function setCaptureRoot(path: string): void {
  root = resolve(path);
}

export function captureRoot(): string {
  return root;
}

/** `2026/10/20265-SECOND-FRONT.jpg` — dated folders make retention a delete. */
function relativePathFor(input: StoreCaptureInput): string {
  const year = String(input.takenAt.getUTCFullYear());
  const month = String(input.takenAt.getUTCMonth() + 1).padStart(2, '0');
  const slip = input.slipNumber.replace(/[^A-Za-z0-9_-]/g, '');
  return join(year, month, `${slip}-${input.pass}-${input.view}.jpg`);
}

/**
 * Resolve a stored path to a real file, refusing anything that climbs out.
 *
 * The path comes from the database rather than a request, but it got there
 * from a request once, and a `..` that survived would read any file the
 * server can. Cheap to check, and the check is the only thing standing
 * between a stored string and the filesystem.
 */
export function resolveCapturePath(relative: string): string | null {
  const absolute = resolve(root, normalize(relative));
  return absolute === root || absolute.startsWith(root + sep) ? absolute : null;
}

export async function storeCapture(input: StoreCaptureInput): Promise<void> {
  const relative = relativePathFor(input);
  const absolute = resolveCapturePath(relative);
  if (!absolute) throw new Error('Refusing to write outside the capture folder');

  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, input.body);

  /* Upsert, because the agent retries an upload whose response it never saw.
     The id is the agent's, so the retry lands on the same document. */
  await CaptureModel.updateOne(
    { _id: input.id },
    {
      $set: {
        weighment_id: input.weighmentId,
        slip_number: input.slipNumber,
        pass: input.pass,
        view: input.view,
        path: relative,
        bytes: input.body.byteLength,
        taken_at: input.takenAt,
        received_at: new Date(),
      },
    },
    { upsert: true },
  );
}

export interface SlipImages {
  front: string | null;
  side: string | null;
}

/**
 * The newest still of each view for a weighing.
 *
 * Newest, so a completed weighing shows the second pass — the loaded truck,
 * which is the state the slip describes — while a slip printed after pass one
 * shows the only pictures there are.
 */
export async function imagesForWeighment(weighmentId: string): Promise<SlipImages> {
  const rows = await CaptureModel.find({ weighment_id: weighmentId }).sort({ taken_at: 1 }).lean();

  const out: SlipImages = { front: null, side: null };
  for (const row of rows) {
    if (row.view === 'FRONT') out.front = String(row._id);
    if (row.view === 'SIDE') out.side = String(row._id);
  }
  return out;
}

/**
 * The same, for a whole page of weighings at once.
 *
 * One query rather than one per row: a page of twenty-five rows asking
 * separately is twenty-five round trips to Atlas in Mumbai, from a droplet in
 * New York, to answer something the list already knows it will be asked.
 *
 * Weighings with no pictures are simply absent from the map; the caller fills
 * them in as a pair of nulls, which is what a bridge without cameras means.
 */
export async function imagesForWeighments(
  weighmentIds: readonly string[],
): Promise<Map<string, SlipImages>> {
  const out = new Map<string, SlipImages>();
  if (weighmentIds.length === 0) return out;

  const rows = await CaptureModel.find({ weighment_id: { $in: [...weighmentIds] } })
    .sort({ taken_at: 1 })
    .lean();

  for (const row of rows) {
    const id = String(row.weighment_id);
    const images = out.get(id) ?? { front: null, side: null };
    // Sorted by when it was taken, so the second pass's picture wins — the
    // same rule imagesForWeighment follows, and the later one shows the truck
    // as it left rather than as it arrived.
    if (row.view === 'FRONT') images.front = String(row._id);
    if (row.view === 'SIDE') images.side = String(row._id);
    out.set(id, images);
  }

  return out;
}

export async function findCapture(id: string) {
  return CaptureModel.findById(id).lean();
}

export async function captureFileExists(relative: string): Promise<boolean> {
  const absolute = resolveCapturePath(relative);
  if (!absolute) return false;
  try {
    await stat(absolute);
    return true;
  } catch {
    return false;
  }
}

/**
 * Drop everything from a calendar year.
 *
 * A whole year at a time, and a directory removal rather than a walk: that is
 * the entire reason the paths start with the year. Returns how many index
 * rows went with it.
 */
/**
 * Delete every photograph of one weighing, files and all.
 *
 * The files go first. A row without its file is a 404 the slip page already
 * handles; a file without its row is a few hundred kilobytes nothing will
 * ever look at or clean up, because the prune works from the rows.
 */
export async function removeCapturesFor(weighmentId: string): Promise<number> {
  const rows = await CaptureModel.find({ weighment_id: weighmentId }).lean();
  if (rows.length === 0) return 0;

  for (const row of rows) {
    const absolute = resolveCapturePath(row.path);
    // A file already gone — pruned, or a disk restored without it — is the
    // ordinary case rather than a failure.
    if (absolute) await rm(absolute, { force: true });
  }

  await CaptureModel.deleteMany({ weighment_id: weighmentId });
  return rows.length;
}

export async function pruneCaptureYear(year: number): Promise<number> {
  const folder = resolveCapturePath(String(year));
  if (!folder) return 0;

  await rm(folder, { recursive: true, force: true });

  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const result = await CaptureModel.deleteMany({ taken_at: { $gte: from, $lt: to } });
  return result.deletedCount ?? 0;
}
