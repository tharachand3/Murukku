import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { config } from '../src/config/env.js';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { addMovement, getBalance } from '../src/services/ledgerService.js';
import { getAverageRate } from '../src/services/costingService.js';
import { db, resetDb, seedMinimal } from './helpers/db.js';

const PURCHASE_DATE = '2026-11-24T12:00:00.000Z';

let fixture;
let supplier;
let production;
let salesman;

function tokenFor(user) {
  return jwt.sign(
    { sub: user.id, role: user.role },
    config.JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function purchaseInput(overrides = {}) {
  return {
    supplierId: supplier.id,
    purchaseDate: PURCHASE_DATE,
    supplierInvoiceNo: 'FLOUR-INV-001',
    lines: [{
      itemId: fixture.items.flour.id,
      qty: '60',
      unit: 'kg',
      ratePerUnitRupees: '45'
    }],
    ...overrides
  };
}

beforeEach(async () => {
  await resetDb();
  fixture = await seedMinimal();
  [supplier, production, salesman] = await Promise.all([
    db.supplier.create({
      data: { name: 'Test flour supplier', stateCode: '33' }
    }),
    db.user.create({
      data: {
        name: 'Purchase Production',
        email: 'purchase-production@test.invalid',
        passwordHash: 'test-only',
        role: 'PRODUCTION'
      }
    }),
    db.user.create({
      data: {
        name: 'Purchase Salesman',
        email: 'purchase-salesman@test.invalid',
        passwordHash: 'test-only',
        role: 'SALESMAN'
      }
    })
  ]);
  await addMovement(db, {
    itemId: fixture.items.flour.id,
    qtyChange: 100000,
    movementType: 'OPENING',
    sourceType: 'OPENING',
    sourceId: fixture.items.flour.id,
    sourceRef: 'OPENING-FLOUR',
    ratePaisePerBase: '4.2',
    movementDate: new Date('2026-04-01T00:00:00.000Z'),
    userId: fixture.users.admin.id
  });
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('purchase API and average-rate helper', () => {
  it('creates a purchase, writes the ledger, and returns display values', async () => {
    const response = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${tokenFor(production)}`)
      .send(purchaseInput());

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      number: 'PUR/2026-27/0001',
      supplierId: supplier.id,
      totalPaise: 270000,
      totalDisplay: '2,700.00',
      lines: [
        {
          qty: 60000,
          qtyBase: 60000,
          qtyDisplay: '60 kg',
          ratePaisePerBase: '4.5',
          rateDisplay: '4.5 paise/g',
          amountPaise: 270000,
          amountDisplay: '2,700.00'
        }
      ]
    });

    expect(await getBalance(db, fixture.items.flour.id)).toBe(160000);
    const movement = await db.stockMovement.findFirst({
      where: { sourceRef: 'PUR/2026-27/0001' }
    });
    expect(movement).toMatchObject({
      itemId: fixture.items.flour.id,
      movementType: 'PURCHASE',
      sourceType: 'PURCHASE',
      qtyChange: 60000,
      valuePaise: 270000
    });
    expect(movement.ratePaisePerBase.toString()).toBe('4.5');
    expect((await getAverageRate(db, fixture.items.flour.id)).toString()).toBe('4.3125');
    expect(
      (await getAverageRate(db, fixture.items.flour.id, {
        asOf: new Date('2026-04-02T00:00:00.000Z')
      })).toString()
    ).toBe('4.2');

    const audit = await db.auditLog.findFirst({
      where: { entity: 'Purchase', entityId: response.body.id }
    });
    expect(audit).toMatchObject({ action: 'CREATE', userId: production.id });

    const listResponse = await request(app)
      .get(`/api/purchases?supplierId=${supplier.id}&page=1&limit=10`)
      .set('Authorization', `Bearer ${tokenFor(fixture.users.accountant)}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.items).toHaveLength(1);
    expect(listResponse.body.items[0].lines[0].qtyDisplay).toBe('60 kg');

    const detailResponse = await request(app)
      .get(`/api/purchases/${response.body.id}`)
      .set('Authorization', `Bearer ${tokenFor(fixture.users.accountant)}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.number).toBe('PUR/2026-27/0001');
  });

  it('rejects a unit from a different dimension', async () => {
    const response = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${tokenFor(production)}`)
      .send(purchaseInput({
        lines: [{
          itemId: fixture.items.flour.id,
          qty: '60',
          unit: 'l',
          ratePerUnitRupees: '45'
        }]
      }));

    expect(response.status).toBe(400);
    expect(await db.purchase.count()).toBe(0);
  });

  it('allows purchase writes only for authorized roles', async () => {
    const response = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${tokenFor(salesman)}`)
      .send(purchaseInput());
    expect(response.status).toBe(403);

    const readResponse = await request(app)
      .get('/api/purchases')
      .set('Authorization', `Bearer ${tokenFor(salesman)}`);
    expect(readResponse.status).toBe(403);
  });

  it('returns not found for an unknown supplier', async () => {
    const response = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${tokenFor(production)}`)
      .send(purchaseInput({ supplierId: supplier.id + 100 }));
    expect(response.status).toBe(404);
  });

  it('rejects inactive suppliers and non-inventory items', async () => {
    await db.supplier.update({
      where: { id: supplier.id },
      data: { isActive: false }
    });
    const inactiveSupplierResponse = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${tokenFor(production)}`)
      .send(purchaseInput());
    expect(inactiveSupplierResponse.status).toBe(422);

    await db.supplier.update({
      where: { id: supplier.id },
      data: { isActive: true }
    });
    const nonInventoryResponse = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${tokenFor(production)}`)
      .send(purchaseInput({
        lines: [{
          itemId: fixture.items.finished.id,
          qty: '10',
          unit: 'packet',
          ratePerUnitRupees: '30'
        }]
      }));
    expect(nonInventoryResponse.status).toBe(422);
  });

  it('rolls back failed lines and does not consume the purchase number', async () => {
    const inactiveItem = await db.item.create({
      data: {
        code: 'INACTIVE-FLOUR',
        name: 'Inactive flour',
        type: 'RAW',
        baseUnitId: fixture.units.g.id,
        displayUnitId: fixture.units.kg.id,
        isActive: false
      }
    });

    const failedResponse = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${tokenFor(production)}`)
      .send(purchaseInput({
        lines: [
          {
            itemId: fixture.items.flour.id,
            qty: '10',
            unit: 'g',
            ratePerUnitRupees: '1'
          },
          {
            itemId: inactiveItem.id,
            qty: '10',
            unit: 'g',
            ratePerUnitRupees: '1'
          }
        ]
      }));

    expect(failedResponse.status).toBe(422);
    expect(await db.purchase.count()).toBe(0);
    expect(await db.purchaseLine.count()).toBe(0);
    expect(await db.stockMovement.count()).toBe(1);
    expect(await db.documentCounter.findUnique({
      where: { key: 'PUR:2026-27' }
    })).toBeNull();

    const successfulResponse = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${tokenFor(production)}`)
      .send(purchaseInput({
        lines: [{
          itemId: fixture.items.flour.id,
          qty: '10',
          unit: 'g',
          ratePerUnitRupees: '1'
        }]
      }));
    expect(successfulResponse.status).toBe(201);
    expect(successfulResponse.body.number).toBe('PUR/2026-27/0001');
  });

  it('returns a zero Decimal when an item has no priced receipts', async () => {
    const rate = await getAverageRate(db, fixture.items.finished.id);
    expect(rate.toString()).toBe('0');
  });
});
