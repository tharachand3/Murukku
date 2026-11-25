import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { apiPost, loginAs, seedBenchmarkMasters } from './helpers/benchmark.js';
import { db, resetDb } from './helpers/db.js';

let invoice;

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  const admin = await db.user.findUnique({ where: { email: 'admin@demo.com' } });
  const production = await db.user.findUnique({ where: { email: 'production@demo.com' } });
  const salesman = await db.user.findUnique({ where: { email: 'salesman.a@demo.com' } });
  const finished = await db.item.findUnique({ where: { code: 'MURUKKU200' } });
  const pouch = await db.item.findUnique({ where: { code: 'POUCH200' } });
  const carton = await db.item.findUnique({ where: { code: 'CARTON' } });
  const retailer = await db.customer.findFirst({ where: { name: 'Retailer A' } });
  const [adminToken, productionToken, salesmanToken] = await Promise.all([
    loginAs(app, admin.email),
    loginAs(app, production.email),
    loginAs(app, salesman.email)
  ]);
  const started = await apiPost(app, productionToken, '/api/production/runs', {
    finishedItemId: finished.id,
    batchCount: '1'
  });
  expect(started.status).toBe(201);
  expect((await apiPost(
    app,
    productionToken,
    `/api/production/runs/${started.body.id}/complete`,
    {
      actualGoodQty: 188,
      consumption: [
        { itemId: pouch.id, qty: '188', unit: 'pcs' },
        { itemId: carton.id, qty: '9', unit: 'pcs' }
      ]
    }
  )).status).toBe(200);
  const orderResponse = await apiPost(app, salesmanToken, '/api/orders', {
    clientRef: 'invoice-immutable-order-001',
    customerId: retailer.id,
    lines: [{ itemId: finished.id, qty: 10 }]
  });
  expect(orderResponse.status).toBe(201);
  const order = orderResponse.body.order;
  expect((await apiPost(app, adminToken, `/api/orders/${order.id}/approve`, {})).status)
    .toBe(200);
  const created = await apiPost(app, adminToken, '/api/invoices', { orderId: order.id });
  expect(created.status).toBe(201);
  invoice = created.body;
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('invoice database immutability triggers', () => {
  it('blocks deletes and edits to posted invoice fields and lines', async () => {
    await expect(db.$executeRaw`
      DELETE FROM "InvoiceLine" WHERE "invoiceId" = ${invoice.id}
    `).rejects.toThrow(/Invoices cannot be deleted/);
    await expect(db.$executeRaw`
      DELETE FROM "Invoice" WHERE id = ${invoice.id}
    `).rejects.toThrow(/Invoices cannot be deleted/);
    await expect(db.$executeRaw`
      UPDATE "InvoiceLine" SET description = 'Changed'
      WHERE "invoiceId" = ${invoice.id}
    `).rejects.toThrow(/Invoice lines are immutable/);
    await expect(db.$executeRaw`
      UPDATE "Invoice" SET "totalPaise" = 1 WHERE id = ${invoice.id}
    `).rejects.toThrow(/Posted invoice fields are immutable/);
  });

  it('permits one cancellation update but locks a cancelled invoice', async () => {
    const updated = await db.$executeRaw`
      UPDATE "Invoice"
      SET status = 'CANCELLED', "cancelledAt" = NOW(), "cancelReason" = 'Credit note issued'
      WHERE id = ${invoice.id}
    `;
    expect(updated).toBe(1);
    await expect(db.$executeRaw`
      UPDATE "Invoice" SET "cancelReason" = 'Changed after cancellation'
      WHERE id = ${invoice.id}
    `).rejects.toThrow(/Cancelled invoices cannot be changed/);
  });
});
