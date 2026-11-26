import type { ErrorRequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import type { ErrorCode } from '@workbench/shared';

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(what: string): AppError {
    return new AppError('NOT_FOUND', 404, `${what} not found`);
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError('VALIDATION_FAILED', 400, message, details);
  }
}

function fromMulter(err: multer.MulterError, maxFileMb: number, maxFiles: number): AppError {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return new AppError('PAYLOAD_TOO_LARGE', 413, `A file exceeds the hard upload limit (${maxFileMb * 2} MB).`);
    case 'LIMIT_FILE_COUNT':
      return AppError.validation(`Too many files: at most ${maxFiles} per upload.`);
    case 'LIMIT_UNEXPECTED_FILE':
      return AppError.validation('Unexpected form field: upload files using the "files" field.');
    default:
      return AppError.validation(`Upload failed: ${err.message}`);
  }
}

/** Central error middleware: every error leaves the API as `{ error: { code, message, details? } }`. */
export function errorHandler(opts: { maxFileMb: number; maxFiles: number }): ErrorRequestHandler {
  return (err, req, res, _next) => {
    let appErr: AppError;
    if (err instanceof AppError) {
      appErr = err;
    } else if (err instanceof ZodError) {
      appErr = AppError.validation(
        err.issues[0]?.message ?? 'Invalid request',
        err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    } else if (err instanceof multer.MulterError) {
      appErr = fromMulter(err, opts.maxFileMb, opts.maxFiles);
    } else if (typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.too.large') {
      appErr = new AppError('PAYLOAD_TOO_LARGE', 413, 'Request body too large.');
    } else if (typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.parse.failed') {
      appErr = AppError.validation('Malformed JSON body.');
    } else {
      // Unknown error: log it server-side, never leak internals to the client.
      console.error(`[error] ${req.method} ${req.path}`, err);
      appErr = new AppError('INTERNAL', 500, 'Something went wrong. Please try again.');
    }
    res.status(appErr.status).json({
      error: { code: appErr.code, message: appErr.message, ...(appErr.details ? { details: appErr.details } : {}) },
    });
  };
}
