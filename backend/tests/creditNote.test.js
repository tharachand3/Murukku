import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { getBalance } from '../src/services/ledgerService.js';
import { getReservedPackets } from '../src/services/availabilityService.js';
import {
  apiGet,
  apiPost,
  loginAs,
  seedBenchmarkMasters,
  BENCH
} from './helpers/benchmark.js';
import { db, resetDb } from './helpers/db.js';

let items;
let customers;
let tokens;
let order;
let invoice;

async function setupBenchmarkInvoice() {
  await resetDb();
  await seedBenchmarkMasters();
  const [
    admin,
    owner,
    accountant,
    salesmanA,
    salesmanB,
    production,
    finished,
    pouch,
    carton,
    retailerA,
    distributorB
  ] = await Promise.all([
    db.user.findUnique({ where: { email: 'admin@demo.com' } }),
    db.user.findUnique({ where: { email: 'owner@demo.com' } }),
    db.user.findUnique({ where: { email: 'accountant@demo.com' } }),
    db.user.findUnique({ where: { email: 'salesman.a@demo.com' } }),
    db.user.findUnique({ where: { email: 'salesman.b@demo.com' } }),
    db.user.findUnique({ where: { email: 'production@demo.com' } }),
    db.item.findUnique({ where: { code: 'MURUKKU200' } }),
    db.item.findUnique({ where: { code: 'POUCH200' } }),
    db.item.findUnique({ where: { code: 'CARTON' } }),
    db.customer.findFirst({ where: { name: 'Retailer A' } }),
    db.customer.findFirst({ where: { name: 'Distributor B' } })
  ]);
  items = { finished, pouch, carton };
  customers = { retailerA, distributorB };
  const [adminToken, ownerToken, accountantToken, salesmanAToken, salesmanBToken, productionToken] =
    await Promise.all([
      loginAs(app, admin.email),
      loginAs(app, owner.email),
      loginAs(app, accountant.email),
      loginAs(app, salesmanA.email),
      loginAs(app, salesmanB.email),
      loginAs(app, production.email)
    ]);
  tokens = {
    admin: adminToken,
    owner: ownerToken,
    accountant: accountantToken,
    salesmanA: salesmanAToken,
    salesmanB: salesmanBToken,
    production: productionToken
  };

  const started = await apiPost(app, tokens.production, '/api/production/runs', {
    finishedItemId: items.finished.id,
    batchCount: '1'
  });
  expect(started.status).toBe(201);
  const completed = await apiPost(
    app,
    tokens.production,
    `/api/production/runs/${started.body.id}/complete`,
    {
      actualGoodQty: 188,
      consumption: [
        { itemId: items.pouch.id, qty: '188', unit: 'pcs', scrapQty: '6' },
        { itemId: items.carton.id, qty: '9', unit: 'pcs' }
      ]
    }
  );
  expect(completed.status).toBe(200);
  expect(await getBalance(db, items.finished.id)).toBe(BENCH.afterRun.MURUKKU200);

  const orderResponse = await apiPost(app, tokens.salesmanA, '/api/orders', {
    clientRef: 'step31-retailer-0001',
    customerId: customers.retailerA.id,
    lines: [{ itemId: items.finished.id, qty: 150 }]
  });
  expect(orderResponse.status).toBe(201);
  order = orderResponse.body.order;
  expect((await apiPost(app, tokens.admin, `/api/orders/${order.id}/approve`, {})).status)
    .toBe(200);
  const invoiceResponse = await apiPost(app, tokens.admin, '/api/invoices', {
    orderId: order.id
  });
  expect(invoiceResponse.status).toBe(201);
  invoice = invoiceResponse.body;
  expect(invoice.totalPaise).toBe(787500);
}

async function createDistributorInvoice() {
  const created = await apiPost(app, tokens.salesmanB, '/api/orders', {
    clientRef: 'step31-dist-000001',
    customerId: customers.distributorB.id,
    lines: [{ itemId: items.finished.id, qty: 10 }]
  });
  expect(created.status).toBe(201);
  expect((await apiPost(
    app,
    tokens.admin,
    `/api/orders/${created.body.order.id}/approve`,
    {}
  )).status).toBe(200);
  const response = await apiPost(app, tokens.admin, '/api/invoices', {
    orderId: created.body.order.id
  });
  expect(response.status).toBe(201);
  return { order: created.body.order, invoice: response.body };
}

async function cancel(reason = 'Wrong customer') {
  return apiPost(app, tokens.admin, `/api/invoices/${invoice.id}/cancel`, { reason });
}

beforeEach(async () => {
  await setupBenchmarkInvoice();
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('invoice credit notes and sales returns', () => {
  it('cancels an undispatched invoice with a mirrored credit note and no stock movement', async () => {
    const beforeLines = await db.invoiceLine.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { id: 'asc' }
    });
    const beforeMovements = await db.stockMovement.count();
    const response = await cancel();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      invoice: { id: invoice.id, invoiceNo: invoice.invoiceNo, status: 'CANCELLED' },
      creditNote: {
        noteNo: expect.stringMatching(/^CN\/\d{4}-\d{2}\/0001$/),
        taxableValuePaise: 750000,
        cgstPaise: 18750,
        sgstPaise: 18750,
        igstPaise: 0,
        totalPaise: 787500
      },
      stockReversed: [],
      customerBalance: { outstandingPaise: 0, creditPaise: 0 }
    });
    expect(await getBalance(db, items.finished.id)).toBe(BENCH.afterRun.MURUKKU200);
    expect(await db.stockMovement.count()).toBe(beforeMovements);
    expect(await getReservedPackets(db, items.finished.id)).toBe(0);
    expect((await db.order.findUnique({ where: { id: order.id } })).status).toBe('CANCELLED');
    expect(await db.invoiceLine.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { id: 'asc' }
    })).toEqual(beforeLines);

    const invoiceDetails = await apiGet(app, tokens.admin, `/api/invoices/${invoice.id}`);
    expect(invoiceDetails.body.creditNote).toMatchObject({
      id: response.body.creditNote.id,
      noteNo: response.body.creditNote.noteNo,
      totalPaise: 787500
    });
    const notes = await apiGet(app, tokens.accountant, '/api/credit-notes');
    expect(notes.status).toBe(200);
    expect(notes.body).toMatchObject({
      page: 1,
      limit: 20,
      total: 1,
      items: [{ noteNo: response.body.creditNote.noteNo }]
    });
    expect((await apiGet(
      app,
      tokens.owner,
      `/api/credit-notes/${response.body.creditNote.id}`
    )).status).toBe(200);

    const auditRows = await db.auditLog.findMany({
      where: {
        OR: [
          { entity: 'Invoice', entityId: invoice.id, action: 'CANCEL' },
          { entity: 'CreditNote', entityId: response.body.creditNote.id, action: 'CREATE' },
          { entity: 'Order', entityId: order.id, action: 'UPDATE' }
        ]
      }
    });
    expect(auditRows).toHaveLength(3);
  });

  it('reverses dispatched stock through one SALES_RETURN ledger movement', async () => {
    const dispatch = await apiPost(app, tokens.admin, '/api/dispatches', {
      invoiceId: invoice.id
    });
    expect(dispatch.status).toBe(201);
    expect(await getBalance(db, items.finished.id)).toBe(88);
    const originalDispatchMovement = await db.stockMovement.findFirst({
      where: { sourceType: 'DISPATCH', sourceId: dispatch.body.dispatch.id }
    });
    expect(originalDispatchMovement).not.toBeNull();

    const response = await cancel();
    expect(response.status).toBe(200);
    expect(response.body.stockReversed).toEqual([{
      itemId: items.finished.id,
      name: items.finished.name,
      qty: 150,
      display: '150 packet'
    }]);
    const reversal = await db.stockMovement.findMany({
      where: { sourceType: 'CREDIT_NOTE', sourceId: response.body.creditNote.id }
    });
    expect(reversal).toHaveLength(1);
    expect(reversal[0]).toMatchObject({
      qtyChange: 150,
      movementType: 'SALES_RETURN',
      sourceRef: response.body.creditNote.noteNo,
      ratePaisePerBase: null,
      valuePaise: null
    });
    expect(await db.stockMovement.findFirst({
      where: { sourceType: 'DISPATCH', sourceId: dispatch.body.dispatch.id }
    })).not.toBeNull();
    const movementTotal = await db.stockMovement.aggregate({
      where: { itemId: items.finished.id },
      _sum: { qtyChange: true }
    });
    expect(movementTotal._sum.qtyChange).toBe(await getBalance(db, items.finished.id));
    expect(await getBalance(db, items.finished.id)).toBe(238);
  });

  it('returns only quantities from partial dispatches', async () => {
    const dispatch = await apiPost(app, tokens.admin, '/api/dispatches', {
      invoiceId: invoice.id,
      lines: [{ itemId: items.finished.id, qty: 100 }]
    });
    expect(dispatch.status).toBe(201);
    expect(await getBalance(db, items.finished.id)).toBe(138);

    const response = await cancel();
    expect(response.status).toBe(200);
    expect(response.body.stockReversed.map(({ qty }) => qty)).toEqual([100]);
    expect(await getBalance(db, items.finished.id)).toBe(238);
    expect(await db.stockMovement.count({
      where: { sourceType: 'CREDIT_NOTE', sourceId: response.body.creditNote.id }
    })).toBe(1);
  });

  it('rolls back cancellation when a dispatched item is inactive', async () => {
    const dispatch = await apiPost(app, tokens.admin, '/api/dispatches', {
      invoiceId: invoice.id
    });
    expect(dispatch.status).toBe(201);
    const movementsBeforeCancel = await db.stockMovement.count();
    await db.item.update({
      where: { id: items.finished.id },
      data: { isActive: false }
    });

    const response = await cancel();
    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({
      code: 'UNPROCESSABLE_ENTITY',
      details: { itemId: items.finished.id }
    });
    expect(await db.creditNote.count({ where: { invoiceId: invoice.id } })).toBe(0);
    expect((await db.invoice.findUnique({ where: { id: invoice.id } })).status).toBe('POSTED');
    expect(await db.stockMovement.count()).toBe(movementsBeforeCancel);
  });

  it('copies inter-state GST amounts without recomputing tax', async () => {
    const { invoice: distributorInvoice } = await createDistributorInvoice();
    expect(distributorInvoice).toMatchObject({
      taxableValuePaise: 50000,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 2500,
      totalPaise: 52500
    });
    const response = await apiPost(
      app,
      tokens.admin,
      `/api/invoices/${distributorInvoice.id}/cancel`,
      { reason: 'Wrong customer' }
    );
    expect(response.status).toBe(200);
    expect(response.body.creditNote).toMatchObject({
      taxableValuePaise: 50000,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 2500,
      totalPaise: 52500
    });
  });

  it('rejects repeated cancellation, dispatch, and payment without duplicating reversals', async () => {
    const first = await cancel();
    expect(first.status).toBe(200);
    const second = await cancel();
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('INVOICE_ALREADY_CANCELLED');
    expect(await db.creditNote.count({ where: { invoiceId: invoice.id } })).toBe(1);
    expect(await db.stockMovement.count({
      where: { sourceType: 'CREDIT_NOTE', sourceId: first.body.creditNote.id }
    })).toBe(0);

    const dispatch = await apiPost(app, tokens.admin, '/api/dispatches', {
      invoiceId: invoice.id
    });
    expect(dispatch.status).toBe(409);
    const payment = await apiPost(app, tokens.admin, '/api/payments', {
      customerId: customers.retailerA.id,
      invoiceId: invoice.id,
      amountPaise: 1,
      mode: 'CASH'
    });
    expect(payment.status).toBe(409);
  });

  it('retains payments as customer credit after invoice cancellation', async () => {
    const payment = await apiPost(app, tokens.admin, '/api/payments', {
      customerId: customers.retailerA.id,
      invoiceId: invoice.id,
      amountPaise: 400000,
      mode: 'CASH'
    });
    expect(payment.status).toBe(201);

    const response = await cancel();
    expect(response.status).toBe(200);
    expect(response.body.customerBalance).toEqual({
      outstandingPaise: 0,
      creditPaise: 400000
    });
    expect(await db.payment.count({ where: { id: payment.body.payment.id } })).toBe(1);
    const balance = await apiGet(
      app,
      tokens.admin,
      `/api/payments/outstanding/${customers.retailerA.id}`
    );
    expect(balance.body).toMatchObject({
      outstandingPaise: 0,
      creditPaise: 400000,
      unallocatedPaidPaise: 400000
    });
  });

  it('allows exactly one of two concurrent cancellation requests', async () => {
    const results = await Promise.all([cancel(), cancel()]);
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.filter((result) => result.status === 409)).toHaveLength(1);
    expect(await db.creditNote.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });

  it('validates reason, enforces roles, and exposes no invoice edit or delete routes', async () => {
    expect((await apiPost(app, tokens.admin, `/api/invoices/${invoice.id}/cancel`, {})).status)
      .toBe(400);
    expect((await cancel('Bad')).status).toBe(400);
    expect((await apiPost(
      app,
      tokens.salesmanA,
      `/api/invoices/${invoice.id}/cancel`,
      { reason: 'Wrong customer' }
    )).status).toBe(403);
    expect((await apiPost(
      app,
      tokens.accountant,
      `/api/invoices/${invoice.id}/cancel`,
      { reason: 'Wrong customer' }
    )).status).toBe(403);
    expect((await apiGet(app, tokens.accountant, '/api/credit-notes')).status).toBe(200);
    expect((await apiGet(app, tokens.owner, '/api/credit-notes')).status).toBe(200);
    expect((await request(app).get('/api/credit-notes')).status).toBe(401);
    expect((await request(app).post(`/api/invoices/${invoice.id}/cancel`)
      .send({ reason: 'Wrong customer' })).status).toBe(401);

    expect((await request(app).put(`/api/invoices/${invoice.id}`).send({})).status).toBe(404);
    expect((await request(app).patch(`/api/invoices/${invoice.id}`).send({})).status).toBe(404);
    expect((await request(app).delete(`/api/invoices/${invoice.id}`)).status).toBe(404);
  });
});
