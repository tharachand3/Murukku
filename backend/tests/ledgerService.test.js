import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import {
  addMovement,
  addMovements,
  getBalance,
  getBalances,
  getLedger
} from '../src/services/ledgerService.js';
import { db, resetDb, seedMinimal } from './helpers/db.js';

let fixture;

function movement(itemId, overrides = {}) {
  return {
    itemId,
    qtyChange: 1,
    movementType: 'OPENING',
    sourceType: 'OPENING',
    sourceId: itemId,
    sourceRef: 'TEST-OPENING',
    ...overrides
  };
}

beforeEach(async () => {
  await resetDb();
  fixture = await seedMinimal();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('ledger service', () => {
  it('sums opening and purchase movements into the balance', async () => {
    const [opening, purchase] = await addMovements(db, [
      movement(fixture.items.flour.id, {
        qtyChange: 1000,
        ratePaisePerBase: '4.2',
        userId: fixture.users.admin.id
      }),
      movement(fixture.items.flour.id, {
        qtyChange: 500,
        movementType: 'PURCHASE',
        sourceType: 'PURCHASE',
        sourceId: 10,
        sourceRef: 'PUR/2026-27/0001',
        ratePaisePerBase: '4.5',
        userId: fixture.users.admin.id
      })
    ]);

    expect(await getBalance(db, fixture.items.flour.id)).toBe(1500);
    expect(opening.valuePaise).toBe(4200);
    expect(purchase.valuePaise).toBe(2250);
  });

  it('rolls back earlier entries when addMovements stops at an invalid outflow', async () => {
    await expect(addMovements(db, [
      movement(fixture.items.flour.id, { qtyChange: 50 }),
      movement(fixture.items.flour.id, {
        qtyChange: -60,
        movementType: 'DISPATCH',
        sourceType: 'DISPATCH',
        sourceId: 2,
        sourceRef: 'DSP-ROLLBACK'
      })
    ])).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });

    expect(await getBalance(db, fixture.items.flour.id)).toBe(0);
  });

  it('reduces stock for an outflow and formats display balances', async () => {
    await addMovement(db, movement(fixture.items.flour.id, { qtyChange: 2000 }));
    await addMovement(db, movement(fixture.items.flour.id, {
      qtyChange: -500,
      movementType: 'PRODUCTION_ISSUE',
      sourceType: 'PRODUCTION_RUN',
      sourceId: 1,
      sourceRef: 'RUN/2026-27/0001'
    }));

    expect(await getBalance(db, fixture.items.flour.id)).toBe(1500);
    await addMovement(db, movement(fixture.items.finished.id, { qtyChange: 12 }));
    const balances = await getBalances(db, { type: 'RAW', itemIds: [fixture.items.flour.id] });
    expect(balances).toEqual([
      expect.objectContaining({
        itemId: fixture.items.flour.id,
        code: 'TEST-FLOUR',
        type: 'RAW',
        baseUnit: 'g',
        displayUnit: 'kg',
        balanceBase: 1500,
        balanceDisplay: '1.5 kg'
      })
    ]);
  });

  it('rejects an outflow beyond stock with the exact shortage details', async () => {
    await addMovement(db, movement(fixture.items.flour.id, { qtyChange: 40 }));

    await expect(addMovement(db, movement(fixture.items.flour.id, {
      qtyChange: -55,
      movementType: 'DISPATCH',
      sourceType: 'DISPATCH',
      sourceId: 2,
      sourceRef: 'DSP/2026-27/0001'
    }))).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      status: 422,
      details: {
        itemId: fixture.items.flour.id,
        itemName: 'Test flour',
        available: 40,
        requested: 55,
        shortBy: 15
      }
    });
  });

  it('allows an explicitly authorized negative balance', async () => {
    await addMovement(db, movement(fixture.items.flour.id, { qtyChange: 10 }));
    await addMovement(db, movement(fixture.items.flour.id, {
      qtyChange: -15,
      movementType: 'ADJUSTMENT',
      sourceType: 'ADJUSTMENT',
      sourceId: 3,
      sourceRef: 'ADJ/TEST',
      allowNegative: true
    }));

    expect(await getBalance(db, fixture.items.flour.id)).toBe(-5);
  });

  it('returns a date-window ledger with opening and running balances', async () => {
    const before = new Date('2026-01-01T00:00:00.000Z');
    const from = new Date('2026-01-03T00:00:00.000Z');
    const sameDay = new Date('2026-01-05T00:00:00.000Z');
    const to = new Date('2026-01-06T00:00:00.000Z');

    await addMovement(db, movement(fixture.items.flour.id, {
      qtyChange: 100,
      movementDate: before,
      userId: fixture.users.admin.id
    }));
    await addMovement(db, movement(fixture.items.flour.id, {
      qtyChange: 50,
      movementType: 'PURCHASE',
      sourceType: 'PURCHASE',
      sourceId: 10,
      sourceRef: 'PUR-10',
      movementDate: from,
      ratePaisePerBase: '2.25',
      userId: fixture.users.accountant.id
    }));
    await addMovement(db, movement(fixture.items.flour.id, {
      qtyChange: -20,
      movementType: 'DISPATCH',
      sourceType: 'DISPATCH',
      sourceId: 20,
      sourceRef: 'DSP-20',
      movementDate: sameDay,
      userId: fixture.users.admin.id
    }));
    await addMovement(db, movement(fixture.items.flour.id, {
      qtyChange: 10,
      movementType: 'ADJUSTMENT',
      sourceType: 'ADJUSTMENT',
      sourceId: 30,
      sourceRef: 'ADJ-30',
      movementDate: sameDay,
      userId: fixture.users.admin.id
    }));
    await addMovement(db, movement(fixture.items.flour.id, {
      qtyChange: -3,
      movementType: 'DISPATCH',
      sourceType: 'DISPATCH',
      sourceId: 40,
      sourceRef: 'DSP-40',
      movementDate: new Date('2026-01-07T00:00:00.000Z')
    }));

    const ledger = await getLedger(db, {
      itemId: fixture.items.flour.id,
      from,
      to
    });
    expect(ledger.openingBalance).toBe(100);
    expect(ledger.rows.map(({ balance }) => balance)).toEqual([150, 130, 140]);
    expect(ledger.rows.map(({ qtyIn, qtyOut }) => [qtyIn, qtyOut])).toEqual([
      [50, 0],
      [0, 20],
      [10, 0]
    ]);
    expect(ledger.rows[0]).toMatchObject({
      sourceRef: 'PUR-10',
      rate: '2.25',
      user: { id: fixture.users.accountant.id, name: 'Ledger Accountant' }
    });
    expect(ledger.closingBalance).toBe(140);
    expect(await getBalance(db, fixture.items.flour.id, { asOf: to })).toBe(140);
  });

  it('blocks update and delete through the append-only database trigger', async () => {
    const row = await addMovement(db, movement(fixture.items.flour.id, { qtyChange: 25 }));

    await expect(db.stockMovement.update({
      where: { id: row.id },
      data: { qtyChange: 26 }
    })).rejects.toThrow();
    await expect(db.stockMovement.delete({
      where: { id: row.id }
    })).rejects.toThrow();
  });

  it('serializes concurrent outflows under the item row lock', async () => {
    await addMovement(db, movement(fixture.items.flour.id, { qtyChange: 100 }));

    const outcomes = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        db.$transaction((tx) => addMovement(tx, movement(fixture.items.flour.id, {
          qtyChange: -30,
          movementType: 'DISPATCH',
          sourceType: 'DISPATCH',
          sourceId: index + 1,
          sourceRef: `DSP-CONCURRENT-${index + 1}`,
          userId: fixture.users.admin.id
        })), { maxWait: 10000, timeout: 30000 }).then(
          () => true,
          (error) => {
            if (error instanceof AppError && error.code === 'INSUFFICIENT_STOCK') {
              return false;
            }
            throw error;
          }
        )
      )
    );

    expect(outcomes.filter(Boolean)).toHaveLength(3);
    expect(await getBalance(db, fixture.items.flour.id)).toBe(10);
  });
});
