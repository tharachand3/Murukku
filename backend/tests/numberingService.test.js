import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import { nextNumber } from '../src/services/numberingService.js';
import { db, resetDb } from './helpers/db.js';

const DATE_IN_FY_2026_27 = new Date('2026-07-01T00:00:00.000Z');

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('numbering service', () => {
  it('increments a prefix counter sequentially', async () => {
    await expect(nextNumber(db, 'INV', DATE_IN_FY_2026_27)).resolves.toBe('INV/2026-27/0001');
    await expect(nextNumber(db, 'INV', DATE_IN_FY_2026_27)).resolves.toBe('INV/2026-27/0002');
    await expect(nextNumber(db, 'INV', DATE_IN_FY_2026_27)).resolves.toBe('INV/2026-27/0003');
  });

  it('keeps counters independent for different prefixes', async () => {
    await nextNumber(db, 'INV', DATE_IN_FY_2026_27);
    await expect(nextNumber(db, 'PUR', DATE_IN_FY_2026_27)).resolves.toBe('PUR/2026-27/0001');
  });

  it('starts a new counter for the new financial year', async () => {
    await nextNumber(db, 'ORD', new Date('2027-03-31T18:00:00.000Z'));
    await expect(
      nextNumber(db, 'ORD', new Date('2027-03-31T19:00:00.000Z'))
    ).resolves.toBe('ORD/2027-28/0001');
  });

  it('returns distinct consecutive numbers across parallel transactions', async () => {
    const numbers = await Promise.all(
      Array.from({ length: 10 }, () =>
        db.$transaction((tx) => nextNumber(tx, 'DSP', DATE_IN_FY_2026_27))
      )
    );

    expect(new Set(numbers).size).toBe(10);
    expect(numbers.sort()).toEqual(
      Array.from({ length: 10 }, (_, index) =>
        `DSP/2026-27/${String(index + 1).padStart(4, '0')}`
      )
    );
  });

  it('does not consume a number when its transaction rolls back', async () => {
    await expect(
      db.$transaction(async (tx) => {
        await nextNumber(tx, 'CN', DATE_IN_FY_2026_27);
        throw new Error('force rollback');
      })
    ).rejects.toThrow('force rollback');

    await expect(nextNumber(db, 'CN', DATE_IN_FY_2026_27)).resolves.toBe('CN/2026-27/0001');
  });

  it('rejects unsupported prefixes with an internal AppError', async () => {
    await expect(nextNumber(db, 'BAD', DATE_IN_FY_2026_27)).rejects.toBeInstanceOf(AppError);
    await expect(nextNumber(db, 'BAD', DATE_IN_FY_2026_27)).rejects.toMatchObject({
      status: 500,
      code: 'INVALID_DOCUMENT_PREFIX'
    });
  });

  it('pads to at least four digits and keeps larger counters intact', async () => {
    await db.documentCounter.create({
      data: { key: 'RCT:2026-27', lastNumber: 9999 }
    });

    await expect(nextNumber(db, 'RCT', DATE_IN_FY_2026_27)).resolves.toBe('RCT/2026-27/10000');
  });
});
