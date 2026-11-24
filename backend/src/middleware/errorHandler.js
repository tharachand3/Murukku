import { AppError } from '../lib/errors.js';

export function errorHandler(error, _req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  let status = 500;
  let code = 'INTERNAL';
  let message = 'Internal server error';
  let details = null;

  if (error instanceof AppError) {
    status = error.status;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (error?.code === 'P2002') {
    status = 409;
    code = 'DUPLICATE';
    message = 'Resource already exists';
  } else if (error?.code === 'P2025') {
    status = 404;
    code = 'NOT_FOUND';
    message = 'Resource not found';
  } else {
    console.error(error?.stack ?? error);
  }

  return res.status(status).json({
    error: { code, message, details }
  });
}
