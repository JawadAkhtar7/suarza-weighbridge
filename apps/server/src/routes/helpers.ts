/** One validation path, one error shape — shared Zod schemas do the work. */

import type { z } from 'zod';
import { ApiError } from '../errors.js';

export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError('VALIDATION_ERROR', 'The request could not be processed.', {
      field_errors: result.error.flatten().fieldErrors,
      form_errors: result.error.flatten().formErrors,
    });
  }
  return result.data;
}
