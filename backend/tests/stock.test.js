import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { config } from '../src/config/env.js';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { addMovement } from '../src/services/ledgerService.js';
import { db, resetDb, seedMinimal } from './helpers/db.js';

let fixture;
let salesman;
let production;

function tokenFor(user) {
  return jwt.sign(
    { sub: user.id, role: user.role },
    config.JWT_SECRET,
    { expiresIn: '12h' }
  );
}

beforeEach(async () => {
  await resetDb();
  fixture = await seedMinimal();
  salesman = await db.user.create({
    data: {
      name: 'Stock Salesman',
      email: 'stock-salesman@test.invalid',
      passwordHash: 'test-only',
      role: 'SALESMAN'
    }
  });
  production = await db.user.create({
    data: {
      name: 'Stock Production',
      email: 'stock-production@test.invalid',
      passwordHash: 'test-only',
      role: 'PRODUCTION'
    }
  });

  await addMovement(db, {
    itemId: fixture.items.flour.id,
    qtyChange: 5000,
    movementType: 'OPENING',
    sourceType: 'OPENING',
    sourceId: fixture.items.flour.id,
    sourceRef: 'OPENING-FLOUR',
    userId: fixture.users.admin.id
  });
  await addMovement(db, {
    itemId: fixture.items.finished.id,
    qtyChange: 24,
    movementType: 'PRODUCTION_OUTPUT',
    sourceType: 'PRODUCTION_RUN',
    sourceId: 1,
    sourceRef: 'RUN-TEST-1',
    userId: fixture.users.admin.id
  });

  const customer = await db.customer.create({
    data: {
      name: 'Stock test customer',
      type: 'RETAILER',
      stateCode: '33',
      stateName: 'Tamil Nadu'
    }
  });
  await db.order.create({
    data: {
      orderNo: 'ORD-STOCK-TEST-1',
      customerId: customer.id,
      salesmanId: salesman.id,
      status: 'APPROVED',
      lines: {
        create: {
          itemId: fixture.items.finished.id,
          qty: 8,
          approvedQty: 6,
          pricePaise: 5000
        }
      }
    }
  });
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('stock endpoints', () => {
  it('requires authentication for stock summary', async () => {
    const response = await request(app).get('/api/stock/summary');
    expect(response.status).toBe(401);
  });

  it('lets production read summaries but denies summary data to salesmen', async () => {
    const productionResponse = await request(app)
      .get('/api/stock/summary?type=RAW')
      .set('Authorization', `Bearer ${tokenFor(production)}`);
    expect(productionResponse.status).toBe(200);
    expect(productionResponse.body).toEqual([
      expect.objectContaining({
        code: 'TEST-FLOUR',
        balanceBase: 5000,
        balanceDisplay: '5 kg'
      })
    ]);

    const salesmanToken = tokenFor(salesman);
    const salesmanResponses = await Promise.all([
      request(app)
        .get('/api/stock/summary')
        .set('Authorization', `Bearer ${salesmanToken}`),
      request(app)
        .get(`/api/stock/ledger?itemId=${fixture.items.flour.id}`)
        .set('Authorization', `Bearer ${salesmanToken}`),
      request(app)
        .get(`/api/stock/items/${fixture.items.flour.id}/balance`)
        .set('Authorization', `Bearer ${salesmanToken}`)
    ]);
    expect(salesmanResponses.map(({ status }) => status)).toEqual([403, 403, 403]);
  });

  it('lets salesmen see only finished-goods availability after reservations', async () => {
    const response = await request(app)
      .get('/api/stock/finished-availability')
      .set('Authorization', `Bearer ${tokenFor(salesman)}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        itemId: fixture.items.finished.id,
        name: 'Test packet',
        availablePackets: 18
      }
    ]);
    expect(Object.keys(response.body[0]).sort()).toEqual([
      'availablePackets',
      'itemId',
      'name'
    ]);
  });

  it('lets accountants read a running ledger with display-unit strings', async () => {
    const from = '2026-01-01T00:00:00.000Z';
    const response = await request(app)
      .get(`/api/stock/ledger?itemId=${fixture.items.flour.id}&from=${encodeURIComponent(from)}`)
      .set('Authorization', `Bearer ${tokenFor(fixture.users.accountant)}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      openingBalance: 0,
      openingBalanceDisplay: '0 kg',
      closingBalance: 5000,
      closingBalanceDisplay: '5 kg',
      displayUnit: 'kg',
      rows: [
        expect.objectContaining({
          qtyIn: 5000,
          qtyInDisplay: '5 kg',
          balance: 5000,
          balanceDisplay: '5 kg'
        })
      ]
    });
  });

  it('returns a single item balance in base and display units', async () => {
    const response = await request(app)
      .get(`/api/stock/items/${fixture.items.flour.id}/balance`)
      .set('Authorization', `Bearer ${tokenFor(production)}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      itemId: fixture.items.flour.id,
      balanceBase: 5000,
      balanceDisplay: '5 kg'
    });
  });
});
