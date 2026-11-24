export class AppError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.statusCode = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message = 'Bad request', details = null) {
  return new AppError(400, 'BAD_REQUEST', message, details);
}

export function unauthorized(message = 'Authentication required', details = null) {
  return new AppError(401, 'UNAUTHORIZED', message, details);
}

export function forbidden(message = 'Insufficient permissions', details = null) {
  return new AppError(403, 'FORBIDDEN', message, details);
}

export function notFound(message = 'Resource not found', details = null) {
  return new AppError(404, 'NOT_FOUND', message, details);
}

export function conflict(message = 'Conflict', details = null) {
  return new AppError(409, 'CONFLICT', message, details);
}

export function unprocessable(message = 'Unprocessable entity', details = null) {
  return new AppError(422, 'UNPROCESSABLE_ENTITY', message, details);
}
