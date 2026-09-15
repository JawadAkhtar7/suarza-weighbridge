/** Uniform error handling. Express 5 forwards async rejections here by itself. */

import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ApiError, isApiError } from '../errors.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new ApiError('NOT_FOUND', `No route for ${req.method} ${req.originalUrl}`));
};

export function errorHandler(logger: Pick<Console, 'error'>): ErrorRequestHandler {
  // Express identifies an error handler by its four-argument shape, so `next`
  // stays even though it is unused.
  return (error, _req, res, _next) => {
    if (isApiError(error)) {
      if (error.statusCode >= 500) logger.error(error);
      res.status(error.statusCode).json(error.toResponse());
      return;
    }

    // Never leak a stack trace or a Mongo error string to a client — it can
    // carry collection names and, in some drivers, parts of the URI.
    logger.error(error);
    res.status(500).json(new ApiError('INTERNAL_ERROR', 'Something went wrong.').toResponse());
  };
}
