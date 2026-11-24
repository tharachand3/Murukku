import { afterAll, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { PrismaClient } from '@prisma/client';
import { writeAudit } from '../src/lib/audit.js';

const prisma = new PrismaClient();
let auditId;

afterAll(async () => {
  if (auditId !== undefined) {
    await prisma.auditLog.delete({ where: { id: auditId } });
  }
  await prisma.$disconnect();
});

describe('writeAudit', () => {
  it('serializes Decimal, Date, and BigInt values into JSON-safe values', async () => {
    const createdAt = new Date('2026-11-24T10:00:00.000Z');
    const audit = await writeAudit(prisma, {
      action: 'TEST',
      entity: 'AuditTest',
      after: {
        amount: new Decimal('12.50'),
        createdAt,
        count: 2n
      }
    });
    auditId = audit.id;

    expect(audit.after).toEqual({
      amount: '12.5',
      createdAt: createdAt.toISOString(),
      count: '2'
    });
  });
});
