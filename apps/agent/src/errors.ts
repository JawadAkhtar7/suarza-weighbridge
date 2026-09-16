/**
 * Typed application errors.
 *
 * Each carries a stable `code` the operator UI switches on, because several of
 * these are not failures at all but flows with their own screen — a completed
 * slip offers a reprint, a missing slip just needs re-typing (brief §3B).
 * Matching on message strings would make that fragile.
 */

export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'SLIP_NOT_FOUND'
  | 'ALREADY_COMPLETED'
  | 'ALREADY_VOID'
  | 'CANNOT_VOID_COMPLETED'
  | 'SIMULATOR_DISABLED'
  | 'NOT_FOUND'
  // Pulling the manager's lists: the operator is watching a button, so these
  // are separated to say whether to check the wiring or the connection.
  | 'CLOUD_NOT_CONFIGURED'
  | 'CLOUD_UNREACHABLE'
  | 'CLOUD_REJECTED'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  VALIDATION_ERROR: 400,
  SLIP_NOT_FOUND: 404,
  // 409, not 400: the request was well-formed, the record's state refuses it.
  ALREADY_COMPLETED: 409,
  ALREADY_VOID: 409,
  CANNOT_VOID_COMPLETED: 409,
  SIMULATOR_DISABLED: 404,
  NOT_FOUND: 404,
  CLOUD_NOT_CONFIGURED: 409,
  // 503, not 500: nothing here is broken, the far end is simply not answering.
  CLOUD_UNREACHABLE: 503,
  CLOUD_REJECTED: 502,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;
  readonly details: unknown;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = details;
  }

  toResponse(): { error: { code: string; message: string; details?: unknown } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
