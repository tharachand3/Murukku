import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { getBalance } from '../src/services/ledgerService.js';
import { apiGet, apiPost, BENCH, loginAs, seedBenchmarkMasters } from './helpers/benchmark.js';
import { db, resetDb } from './helpers/db.js';

let users;
let items;
let customers;
let tokens;
let nextClientRef;

function istDate(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const part = (type) => parts.find((entry) => entry.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function currentFinancialYear() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric'
  }).formatToParts(new Date());
  const year = Number(parts.find(({ type }) => type === 'year').value);
  const month = Number(parts.find(({ type }) => type === 'month').value);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

async function createOrder({ token = tokens.salesmanA, customer = customers.retailerA, qty }) {
  const orderResponse = await apiPost(app, token, '/api/orders', {
    clientRef: `dispatch-case-${String(nextClientRef++).padStart(4, '0')}`,
    customerId: customer.id,
    lines: [{ itemId: items.finished.id, qty }]
  });
  expect(orderResponse.status).toBe(201);
  return orderResponse.body.order;
}

async function createApprovedInvoice({
  qty,
  token = tokens.salesmanA,
  customer = customers.retailerA,
  approvedQty
}) {
  const order = await createOrder({ token, customer, qty });
  const approval = await apiPost(app, tokens.admin, `/api/orders/${order.id}/approve`,
    approvedQty === undefined
      ? {}
      : { lines: [{ lineId: order.lines[0].lineId, approvedQty }] });
  expect(approval.status).toBe(200);
  const invoiceResponse = await apiPost(app, tokens.admin, '/api/invoices', {
    orderId: order.id
  });
  expect(invoiceResponse.status).toBe(201);
  return { order, invoice: invoiceResponse.body };
}

async function postAdjustment(direction, qty) {
  return apiPost(app, tokens.admin, '/api/stock/adjustments', {
    itemId: items.finished.id,
    qty: String(qty),
    unit: 'packet',
    direction,
    reason: 'COUNT_CORRECTION'
  });
}

beforeEach(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  const [
    admin,
    owner,
    production,
    salesmanA,
    salesmanB,
    accountant,
    finished,
    pouch,
    carton,
    retailerA,
    distributorB
  ] = await Promise.all([
    db.user.findUnique({ where: { email: 'admin@demo.com' } }),
    db.user.findUnique({ where: { email: 'owner@demo.com' } }),
    db.user.findUnique({ where: { email: 'production@demo.com' } }),
    db.user.findUnique({ where: { email: 'salesman.a@demo.com' } }),
    db.user.findUnique({ where: { email: 'salesman.b@demo.com' } }),
    db.user.findUnique({ where: { email: 'accountant@demo.com' } }),
    db.item.findUnique({ where: { code: 'MURUKKU200' } }),
    db.item.findUnique({ where: { code: 'POUCH200' } }),
    db.item.findUnique({ where: { code: 'CARTON' } }),
    db.customer.findFirst({ where: { name: 'Retailer A' } }),
    db.customer.findFirst({ where: { name: 'Distributor B' } })
  ]);
  users = { admin, owner, production, salesmanA, salesmanB, accountant };
  items = { finished, pouch, carton };
  customers = { retailerA, distributorB };
  nextClientRef = 1;

  const [adminToken, ownerToken, productionToken, salesmanAToken, salesmanBToken, accountantToken] =
    await Promise.all([
      loginAs(app, admin.email),
      loginAs(app, owner.email),
      loginAs(app, production.email),
      loginAs(app, salesmanA.email),
      loginAs(app, salesmanB.email),
      loginAs(app, accountant.email)
    ]);
  tokens = {
    admin: adminToken,
    owner: ownerToken,
    production: productionToken,
    salesmanA: salesmanAToken,
    salesmanB: salesmanBToken,
    accountant: accountantToken
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
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('dispatch API', () => {
  it('dispatches the full benchmark invoice, updates reservations, audit, and ledger', async () => {
    const { order, invoice } = await createApprovedInvoice({ qty: 150 });
    const response = await apiPost(app, tokens.admin, '/api/dispatches', {
      invoiceId: invoice.id
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      dispatch: {
        dispatchNo: `DSP/${currentFinancialYear()}/0001`,
        invoice: { id: invoice.id, invoiceNo: invoice.invoiceNo },
        customer: { id: customers.retailerA.id, name: 'Retailer A' },
        lines: [{ itemId: items.finished.id, name: 'Murukku 200 g', qty: 150, display: '150 packet' }],
        orderStatus: 'DISPATCHED'
      },
      invoiceFullyDispatched: true
    });
    expect(await getBalance(db, items.finished.id)).toBe(88);
    const [movement] = await db.stockMovement.findMany({
      where: { sourceType: 'DISPATCH', sourceId: response.body.dispatch.id }
    });
    expect(movement).toMatchObject({
      itemId: items.finished.id,
      qtyChange: -150,
      movementType: 'DISPATCH',
      sourceType: 'DISPATCH',
      sourceId: response.body.dispatch.id,
      sourceRef: response.body.dispatch.dispatchNo,
      ratePaisePerBase: null
    });
    expect(await db.auditLog.count({
      where: {
        entity: 'Dispatch',
        entityId: response.body.dispatch.id,
        action: 'CREATE'
      }
    })).toBe(1);
    expect(await db.auditLog.count({
      where: { entity: 'Order', entityId: order.id, action: 'UPDATE' }
    })).toBe(1);

    const orderDetail = await apiGet(app, tokens.salesmanA, `/api/orders/${order.id}`);
    expect(orderDetail.body).toMatchObject({
      status: 'DISPATCHED',
      dispatches: [{
        dispatchNo: response.body.dispatch.dispatchNo,
        dispatchDate: response.body.dispatch.dispatchDate
      }]
    });
    expect((await apiGet(
      app,
      tokens.admin,
      `/api/orders/${order.id}/availability`
    )).body.lines[0].reservedByOthers).toBe(0);
    expect((await apiGet(app, tokens.admin, '/api/stock/finished-availability').then(
      ({ body }) => body[0]
    )).freePackets).toBe(88);
    expect((await apiGet(
      app,
      tokens.admin,
      `/api/invoices/${invoice.id}/dispatch-status`
    )).body).toMatchObject({
      invoiceId: invoice.id,
      fullyDispatched: true,
      lines: [{ invoicedQty: 150, dispatchedQty: 150, remainingQty: 0 }]
    });

    const repeated = await apiPost(app, tokens.admin, '/api/dispatches', {
      invoiceId: invoice.id
    });
    expect(repeated.status).toBe(409);
    expect(repeated.body.error.code).toBe('ALREADY_DISPATCHED');

    const summary = await apiGet(app, tokens.admin, '/api/stock/summary');
    const sums = await db.stockMovement.groupBy({
      by: ['itemId'],
      _sum: { qtyChange: true }
    });
    const sumByItem = new Map(sums.map((row) => [row.itemId, row._sum.qtyChange ?? 0]));
    for (const item of summary.body) {
      expect(item.balanceBase).toBe(sumByItem.get(item.itemId) ?? 0);
    }
  });

  it('supports partial dispatches and merges repeated item IDs', async () => {
    const { order, invoice } = await createApprovedInvoice({ qty: 150 });
    const first = await apiPost(app, tokens.admin, '/api/dispatches', {
      invoiceId: invoice.id,
      lines: [
        { itemId: items.finished.id, qty: 40 },
        { itemId: items.finished.id, qty: 60 }
      ]
    });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      dispatch: {
        lines: [{ itemId: items.finished.id, qty: 100 }],
        orderStatus: 'INVOICED'
      },
      invoiceFullyDispatched: false
    });
    expect(await getBalance(db, items.finished.id)).toBe(138);

    const status = await apiGet(
      app,
      tokens.admin,
      `/api/invoices/${invoice.id}/dispatch-status`
    );
    expect(status.body).toMatchObject({
      fullyDispatched: false,
      lines: [{ invoicedQty: 150, dispatchedQty: 100, remainingQty: 50, display: '50 packet' }]
    });

    const second = await apiPost(app, tokens.admin, '/api/dispatches', {
      invoiceId: invoice.id
    });
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({
      dispatch: {
        dispatchNo: `DSP/${currentFinancialYear()}/0002`,
        lines: [{ itemId: items.finished.id, qty: 50 }],
        orderStatus: 'DISPATCHED'
      },
      invoiceFullyDispatched: true
    });
    expect(await getBalance(db, items.finished.id)).toBe(88);
    expect((await apiGet(app, tokens.admin, `/api/orders/${order.id}/availability`))
      .body.lines[0].reservedByOthers).toBe(0);
  });

  it('rejects excess, foreign-item, missing, and cancelled invoice dispatches', async () => {
    const { invoice } = await createApprovedInvoice({ qty: 10 });
    const excess = await apiPost(app, tokens.admin, '/api/dispatches', {
      invoiceId: invoice.id,
      lines: [{ itemId: items.finished.id, qty: 11 }]
    });
    expect(excess.status).toBe(422);
    expect(excess.body.error).toMatchObject({
      code: 'DISPATCH_EXCEEDS_INVOICE',
      details: { itemId: items.finished.id, remaining: 10, requested: 11 }
    });

    const foreign = await apiPost(app, tokens.admin, '/api/dispatches', {
      invoiceId: invoice.id,
      lines: [{ itemId: items.pouch.id, qty: 1 }]
    });
    expect(foreign.status).toBe(422);
    expect(foreign.body.error).toMatchObject({
      code: 'ITEM_NOT_ON_INVOICE',
      details: { itemId: items.pouch.id }
    });

    const missing = await apiPost(app, tokens.admin, '/api/dispatches', {
      invoiceId: 2147483647
    });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');

    await db.invoice.update({
      where: { id: invoice.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Test cancellation' }
    });
    const cancelled = await apiPost(app, tokens.admin, '/api/dispatches', {
      invoiceId: invoice.id
    });
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.error.code).toBe('INVOICE_CANCELLED');
    expect(await db.dispatch.count()).toBe(0);
    expect(await db.stockMovement.count({ where: { movementType: 'DISPATCH' } })).toBe(0);
  });

  it('rolls back insufficient-stock attempts and the dispatch number', async () => {
    const { invoice } = await createApprovedInvoice({ qty: 150 });
    const reduced = await postAdjustment('OUT', 138);
    expect(reduced.status).toBe(201);
    expect(await getBalance(db, items.finished.id)).toBe(100);

    const shortage = await apiPost(app, tokens.admin, '/api/dispatches', {
      invoiceId: invoice.id
    });
    expect(shortage.status).toBe(422);
    expect(shortage.body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: {
        itemId: items.finished.id,
        onHand: 100,
        reservedByOthers: 0,
        available: 100,
        requested: 150,
        shortBy: 50
      }
    });
    expect(await db.dispatch.count()).toBe(0);
    expect(await db.stockMovement.count({ where: { movementType: 'DISPATCH' } })).toBe(0);

    expect((await postAdjustment('IN', 50)).status).toBe(201);
    const successful = await apiPost(app, tokens.admin, '/api/dispatches', {
      invoiceId: invoice.id
    });
    expect(successful.status).toBe(201);
    expect(successful.body.dispatch.dispatchNo).toBe(
      `DSP/${currentFinancialYear()}/0001`
    );
    expect(await db.stockMovement.count({ where: { movementType: 'DISPATCH' } })).toBe(1);
  });

  it('does not dispatch stock reserved for another invoiced order', async () => {
    const first = await createApprovedInvoice({ qty: 150 });
    const second = await createApprovedInvoice({
      qty: 100,
      token: tokens.salesmanB,
      customer: customers.distributorB,
      approvedQty: 88
    });
    expect((await postAdjustment('OUT', 38)).status).toBe(201);
    expect(await getBalance(db, items.finished.id)).toBe(200);

    const blocked = await apiPost(app, tokens.admin, '/api/dispatches', {
      invoiceId: first.invoice.id
    });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: {
        onHand: 200,
        reservedByOthers: 88,
        available: 112,
        requested: 150,
        shortBy: 38
      }
    });
    expect(await db.dispatch.count()).toBe(0);
    expect(await db.stockMovement.count({ where: { movementType: 'DISPATCH' } })).toBe(0);
    expect((await apiGet(
      app,
      tokens.admin,
      `/api/invoices/${second.invoice.id}/dispatch-status`
    )).body.lines[0].remainingQty).toBe(88);
  });

  it('serializes concurrent full dispatches of the same invoice', async () => {
    const { invoice } = await createApprovedInvoice({ qty: 150 });
    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        apiPost(app, tokens.admin, '/api/dispatches', { invoiceId: invoice.id })
      )
    );
    expect(responses.filter(({ status }) => status === 201)).toHaveLength(1);
    expect(responses.filter(({ status }) => status === 409)).toHaveLength(1);
    expect(responses.find(({ status }) => status === 409).body.error.code)
      .toBe('ALREADY_DISPATCHED');
    expect(await getBalance(db, items.finished.id)).toBe(88);
    expect(await db.dispatch.count({ where: { invoiceId: invoice.id } })).toBe(1);
    expect(await db.stockMovement.count({ where: { movementType: 'DISPATCH' } })).toBe(1);
  });

  it('lists and details dispatches with ledger rows and role checks', async () => {
    const { invoice } = await createApprovedInvoice({ qty: 10 });
    const created = await apiPost(app, tokens.admin, '/api/dispatches', {
      invoiceId: invoice.id,
      vehicleNo: 'TN-01-AB-1234',
      notes: 'Morning delivery'
    });
    expect(created.status).toBe(201);
    const dispatchId = created.body.dispatch.id;
    const date = istDate(new Date(created.body.dispatch.dispatchDate));
    const list = await apiGet(
      app,
      tokens.accountant,
      `/api/dispatches?invoiceId=${invoice.id}&customerId=${customers.retailerA.id}` +
        `&from=${date}&to=${date}&page=1&limit=1`
    );
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({
      page: 1,
      limit: 1,
      total: 1,
      items: [{
        id: dispatchId,
        dispatchNo: created.body.dispatch.dispatchNo,
        invoice: { id: invoice.id, invoiceNo: invoice.invoiceNo },
        customer: { id: customers.retailerA.id, name: 'Retailer A' }
      }]
    });

    const detail = await apiGet(app, tokens.owner, `/api/dispatches/${dispatchId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      dispatchNo: created.body.dispatch.dispatchNo,
      vehicleNo: 'TN-01-AB-1234',
      notes: 'Morning delivery',
      invoice: { id: invoice.id, invoiceNo: invoice.invoiceNo },
      customer: { id: customers.retailerA.id, name: 'Retailer A' },
      lines: [{ itemId: items.finished.id, qty: 10, display: '10 packet' }],
      ledgerRows: [{
        itemId: items.finished.id,
        qtyChange: -10,
        movementType: 'DISPATCH',
        sourceRef: created.body.dispatch.dispatchNo
      }]
    });
    expect((await apiGet(app, tokens.admin, '/api/dispatches')).status).toBe(200);
    expect((await apiGet(app, tokens.production, '/api/dispatches')).status).toBe(403);
    expect((await apiPost(app, tokens.salesmanA, '/api/dispatches', {
      invoiceId: invoice.id
    })).status).toBe(403);
    expect((await apiPost(app, tokens.accountant, '/api/dispatches', {
      invoiceId: invoice.id
    })).status).toBe(403);
    expect((await request(app).get('/api/dispatches')).status).toBe(401);
    expect((await request(app).post('/api/dispatches').send({ invoiceId: invoice.id })).status)
      .toBe(401);
  });

  it('validates strict request shapes, quantities, and future dispatch dates', async () => {
    const { invoice } = await createApprovedInvoice({ qty: 10 });
    const path = '/api/dispatches';
    const unknownKey = await apiPost(app, tokens.admin, path, {
      invoiceId: invoice.id,
      status: 'POSTED'
    });
    expect(unknownKey.status).toBe(400);

    const zero = await apiPost(app, tokens.admin, path, {
      invoiceId: invoice.id,
      lines: [{ itemId: items.finished.id, qty: 0 }]
    });
    expect(zero.status).toBe(400);
    const fractional = await apiPost(app, tokens.admin, path, {
      invoiceId: invoice.id,
      lines: [{ itemId: items.finished.id, qty: 1.5 }]
    });
    expect(fractional.status).toBe(400);

    const future = await apiPost(app, tokens.admin, path, {
      invoiceId: invoice.id,
      dispatchDate: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    });
    expect(future.status).toBe(400);
    expect(await db.dispatch.count()).toBe(0);
  });
});
