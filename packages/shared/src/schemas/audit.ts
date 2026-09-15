/** Append-only audit log (brief §6, §12). Nothing is ever updated or deleted. */

import { z } from 'zod';
import { AUDIT_ACTIONS } from '../constants/domain.js';

export const auditActionSchema = z.enum(AUDIT_ACTIONS);

export const auditEntrySchema = z.object({
  id: z.string().uuid(),
  weighment_id: z.string().uuid(),
  action: auditActionSchema,
  actor_username: z.string().trim().min(1).max(64),
  /** Free-form JSON context: old/new values, void reason, manual-entry flag. */
  detail: z.record(z.unknown()).default({}),
  at: z.string().datetime({ offset: true }),
});

export type AuditEntry = z.infer<typeof auditEntrySchema>;
