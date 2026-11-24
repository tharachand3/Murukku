import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { config } from '../src/config/env.js';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { financialYearOf } from '../src/lib/fy.js';
import { addMovement, getBalance, getLedger } from '../src/services/ledgerService.js';
import { db, resetDb, seedMinimal } from './helpers/db.js';

let fixture;
let production;

function tokenFor(user) {
  return jwt.sign(
    { sub: user.id, role: user.role },
    config.JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function adjustmentInput(overrides = {}) {
  return {
    itemId: fixture.items.flour.id,
    qty: '500',
    unit: 'g',
    direction: 'IN',
    reason: 'COUNT_CORRECTION',
    ...overrides
  };
}

beforeEach(async () => {
  await resetDb();
  fixture = await seedMinimal();
  production = await db.user.create({
    data: {
      name: 'Adjustment Production',
      email: 'adjustment-production@test.invalid',
      passwordHash: 'test-only',
      role: 'PRODUCTION'
    }
  });
  await addMovement(db, {
    itemId: fixture.items.flour.id,
    qtyChange: 1000,
    movementType: 'OPENING',
    ratePaisePerBase: '4.2',
    sourceType: 'OPENING',
    sourceId: fixture.items.flour.id,
    sourceRef: 'OPENING-FLOUR',
    movementDate: new Date(),
    userId: fixture.users.admin.id
  });
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('stock adjustment API', () => {
  it('records an IN adjustment with its ADJ ledger reference and before/after audit', async () => {
    const response = await request(app)
      .post('/api/stock/adjustments')
      .set('Authorization', `Bearer ${tokenFor(production)}`)
      .send(adjustmentInput());

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      number: `ADJ/${financialYearOf(new Date())}/0001`,
      itemId: fixture.items.flour.id,
      qtyChange: 500,
      direction: 'IN',
      qtyBase: 500,
      qtyDisplay: '0.5 kg',
      reason: 'COUNT_CORRECTION',
      balanceBeforeBase: 1000,
      balanceAfterBase: 1500,
      movement: {
        ratePaisePerBase: '4.2',
        valuePaise: 2100
      }
    });

    const ledger = await getLedger(db, { itemId: fixture.items.flour.id });
    expect(ledger.rows[1]).toMatchObject({
      movementType: 'ADJUSTMENT',
      sourceType: 'ADJUSTMENT',
      sourceId: response.body.id,
      sourceRef: response.body.number,
      qtyIn: 500
    });
    expect(await getBalance(db, fixture.items.flour.id)).toBe(1500);

    const audit = await db.auditLog.findFirst({
      where: { entity: 'StockAdjustment', entityId: response.body.id }
    });
    expect(audit).toMatchObject({
      action: 'CREATE',
      userId: production.id,
      before: { itemId: fixture.items.flour.id, balanceBase: 1000 },
      after: { itemId: fixture.items.flour.id, balanceBase: 1500 }
    });

    const listResponse = await request(app)
      .get(`/api/stock/adjustments?itemId=${fixture.items.flour.id}&page=1&limit=10`)
      .set('Authorization', `Bearer ${tokenFor(fixture.users.accountant)}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.items).toHaveLength(1);
    expect(listResponse.body.items[0].number).toBe(response.body.number);
  });

  it('records an OUT adjustment as a negative ledger movement', async () => {
    const response = await request(app)
      .post('/api/stock/adjustments')
      .set('Authorization', `Bearer ${tokenFor(production)}`)
      .send(adjustmentInput({
        qty: '200',
        direction: 'OUT',
        reason: 'DAMAGE'
      }));

    expect(response.status).toBe(201);
    expect(response.body.qtyChange).toBe(-200);
    expect(response.body.direction).toBe('OUT');
    expect(response.body.balanceAfterBase).toBe(800);
    const movement = await db.stockMovement.findFirst({
      where: { sourceRef: response.body.number }
    });
    expect(movement).toMatchObject({
      movementType: 'ADJUSTMENT',
      qtyChange: -200,
      valuePaise: 840
    });
    expect(await getBalance(db, fixture.items.flour.id)).toBe(800);
  });

  it('rejects a missing reason and forbids accountant writes', async () => {
    const missingReason = await request(app)
      .post('/api/stock/adjustments')
      .set('Authorization', `Bearer ${tokenFor(production)}`)
      .send(adjustmentInput({ reason: undefined }));
    expect(missingReason.status).toBe(400);

    const accountant = await request(app)
      .post('/api/stock/adjustments')
      .set('Authorization', `Bearer ${tokenFor(fixture.users.accountant)}`)
      .send(adjustmentInput());
    expect(accountant.status).toBe(403);
  });

  it('rolls back the adjustment and number when an OUT exceeds stock', async () => {
    const response = await request(app)
      .post('/api/stock/adjustments')
      .set('Authorization', `Bearer ${tokenFor(production)}`)
      .send(adjustmentInput({
        qty: '1001',
        direction: 'OUT',
        reason: 'COUNT_CORRECTION'
      }));

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await db.stockAdjustment.count()).toBe(0);
    expect(await db.stockMovement.count()).toBe(1);
    expect(await db.documentCounter.findUnique({
      where: { key: `ADJ:${financialYearOf(new Date())}` }
    })).toBeNull();
  });

  it('appends a movement without modifying any earlier ledger row', async () => {
    const beforeRows = await db.stockMovement.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        itemId: true,
        qtyChange: true,
        movementType: true,
        sourceRef: true,
        valuePaise: true
      }
    });

    const response = await request(app)
      .post('/api/stock/adjustments')
      .set('Authorization', `Bearer ${tokenFor(production)}`)
      .send(adjustmentInput());
    expect(response.status).toBe(201);

    const afterRows = await db.stockMovement.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        itemId: true,
        qtyChange: true,
        movementType: true,
        sourceRef: true,
        valuePaise: true
      }
    });
    expect(afterRows).toHaveLength(beforeRows.length + 1);
    expect(afterRows.slice(0, beforeRows.length)).toEqual(beforeRows);
  });
});
