import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { config } from '../../src/config/env.js';
import { signInvoiceLinkToken, verifyInvoiceLinkToken } from '../../src/lib/shareToken.js';

describe('invoice link tokens', () => {
  const now = new Date('2026-05-04T12:00:00.000Z');

  it('signs and verifies an invoice link at an explicit time', () => {
    const token = signInvoiceLinkToken(42, { now, ttlSeconds: 60 });
    expect(verifyInvoiceLinkToken(token, { now })).toBe(42);
  });

  it.each([
    ['expired', () => signInvoiceLinkToken(42, { now, ttlSeconds: 1 }), new Date(now.getTime() + 2000)],
    ['wrong purpose', () => jwt.sign(
      { purpose: 'other', invoiceId: 42, iat: now.getTime() / 1000 },
      config.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: 60 }
    ), now],
    ['missing expiration', () => jwt.sign(
      { purpose: 'invoice-pdf', invoiceId: 42 },
      config.JWT_SECRET,
      { algorithm: 'HS256' }
    ), now],
    ['wrong signature', () => jwt.sign(
      { purpose: 'invoice-pdf', invoiceId: 42 },
      'a-different-secret-with-enough-length',
      { algorithm: 'HS256', expiresIn: 60 }
    ), now]
  ])('rejects %s tokens', (_label, makeToken, verifyAt) => {
    expect(() => verifyInvoiceLinkToken(makeToken(), { now: verifyAt }))
      .toThrow(expect.objectContaining({ code: 'INVALID_LINK', status: 401 }));
  });
});
