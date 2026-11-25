import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { AppError } from './errors.js';

const TOKEN_TTL_SECONDS = 604800;

function invalidLink() {
  return new AppError(401, 'INVALID_LINK', 'The invoice link is invalid or expired');
}

export function signInvoiceLinkToken(
  invoiceId,
  { now = new Date(), ttlSeconds = TOKEN_TTL_SECONDS } = {}
) {
  if (
    !Number.isSafeInteger(invoiceId) ||
    invoiceId <= 0 ||
    !(now instanceof Date) ||
    Number.isNaN(now.getTime()) ||
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < 1
  ) {
    throw new RangeError('Invoice link token options are invalid');
  }
  return jwt.sign(
    {
      purpose: 'invoice-pdf',
      invoiceId,
      iat: Math.floor(now.getTime() / 1000)
    },
    config.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: ttlSeconds }
  );
}

export function verifyInvoiceLinkToken(token, { now = new Date() } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }

  try {
    const payload = jwt.verify(token, config.JWT_SECRET, {
      algorithms: ['HS256'],
      clockTimestamp: Math.floor(now.getTime() / 1000)
    });
    if (
      typeof payload !== 'object' ||
      payload === null ||
      payload.purpose !== 'invoice-pdf' ||
      !Number.isSafeInteger(payload.invoiceId) ||
      payload.invoiceId <= 0 ||
      !Number.isSafeInteger(payload.exp)
    ) {
      throw invalidLink();
    }
    return payload.invoiceId;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw invalidLink();
  }
}
