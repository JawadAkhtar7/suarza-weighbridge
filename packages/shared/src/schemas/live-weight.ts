/**
 * Live weight payload from the agent's `GET /live-weight` (brief §7.1).
 *
 * `stable` is tri-state on purpose: some indicators send a stability flag and
 * some do not, and the UI must tell "the indicator says unstable" apart from
 * "this indicator can't tell us". `null` means unknown, which downgrades the
 * capture UX to freeze-and-confirm rather than blocking the operator.
 */

import { z } from 'zod';

export const liveWeightSchema = z.object({
  weight_kg: z.number().finite(),
  stable: z.boolean().nullable(),
  /** False when the serial port is closed/erroring — UI shows the fallback. */
  connected: z.boolean(),
  /** UTC timestamp of the reading, so the UI can grey out a stale value. */
  at: z.string().datetime({ offset: true }),
  /** Set when the reading came from the dev simulator, never in production. */
  simulated: z.boolean().default(false),
  /** Last serial error message, surfaced non-disruptively. */
  error: z.string().nullable().default(null),
});

export type LiveWeight = z.infer<typeof liveWeightSchema>;

export const syncStatusSchema = z.object({
  online: z.boolean(),
  pending_count: z.number().int().min(0),
  last_success_at: z.string().datetime({ offset: true }).nullable(),
  last_error: z.string().nullable(),
  syncing: z.boolean().default(false),
  /**
   * Records the cloud permanently refused. They are out of the retry loop, so
   * they are NOT in pending_count — without their own number they would just
   * disappear from the operator's view.
   */
  blocked_count: z.number().int().min(0).default(0),
});

export type SyncStatus = z.infer<typeof syncStatusSchema>;
