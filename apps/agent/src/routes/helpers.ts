/** Shared route helpers: one validation path, one error shape. */

import type { z } from 'zod';
import { AppError } from '../errors.js';

/**
 * Validate with a shared Zod schema (brief coding standards: the schemas in
 * `@suarza/shared` are the single validation source on client and server).
 * Field errors are returned intact so the operator form can highlight the
 * exact input rather than showing one generic message.
 */
export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Please check the highlighted fields.', {
      field_errors: result.error.flatten().fieldErrors,
      form_errors: result.error.flatten().formErrors,
    });
  }
  return result.data;
}
