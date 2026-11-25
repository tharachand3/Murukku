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
let clientRef;

async function setupBenchmarkStock() {
  await resetDb();
  await seedBenchmarkMasters();
  const [
    admin,
    owner,
    salesmanA,
    salesmanB,
    accountant,
    production,
    finished,
    pouch,
    carton,
    retailerA,
    distributorB
  ] = await Promise.all([
    db.user.findUnique({ where: { email: 'admin@demo.com' } }),
    db.user.findUnique({ where: { email: 'owner@demo.com' } }),
    db.user.findUnique({ where: { email: 'salesman.a@demo.com' } }),
    db.user.findUnique({ where: { email: 'salesman.b@demo.com' } }),
    db.user.findUnique({ where: { email: 'accountant@demo.com' } }),
    db.user.findUnique({ where: { email: 'production@demo.com' } }),
    db.item.findUnique({ where: { code: 'MURUKKU200' } }),
    db.item.findUnique({ where: { code: 'POUCH200' } }),
    db.item.findUnique({ where: { code: 'CARTON' } }),
    db.customer.findFirst({ where: { name: 'Retailer A' } }),
    db.customer.findFirst({ where: { name: 'Distributor B' } })
  ]);
  items = { finished, pouch, carton };
  customers = { retailerA, distributorB };
  const [
    adminToken,
    ownerToken,
    salesmanAToken,
    salesmanBToken,
    accountantToken,
    productionToken
  ] = await Promise.all([
    loginAs(app, admin.email),
    loginAs(app, owner.email),
    loginAs(app, salesmanA.email),
    loginAs(app, salesmanB.email),
    loginAs(app, accountant.email),
    loginAs(app, production.email)
  ]);
  tokens = {
    admin: adminToken,
    owner: ownerToken,
    salesmanA: salesmanAToken,
    salesmanB: salesmanBToken,
    accountant: accountantToken,
    production: productionToken
  };
  clientRef = 1;

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
}

async function createOrder({ customer, token, qty }) {
  const response = await apiPost(app, token, '/api/orders', {
    clientRef: `step32-ref-${String(clientRef++).padStart(6, '0')}`,
    customerId: customer.id,
    lines: [{ itemId: items.finished.id, qty }]
  });
  expect(response.status).toBe(201);
  return response.body.order;
}

async function createRetailerDispatch() {
  const retailerOrder = await createOrder({
    customer: customers.retailerA,
    token: tokens.salesmanA,
    qty: 150
  });
  const approval = await apiPost(
    app,
    tokens.admin,
    `/api/orders/${retailerOrder.id}/approve`,
    {}
  );
  expect(approval.status).toBe(200);
  const createdInvoice = await apiPost(app, tokens.admin, '/api/invoices', {
    orderId: retailerOrder.id
  });
  expect(createdInvoice.status).toBe(201);
  const dispatch = await apiPost(app, tokens.admin, '/api/dispatches', {
    invoiceId: createdInvoice.body.id
  });
  expect(dispatch.status).toBe(201);
  expect(await getBalance(db, items.finished.id)).toBe(88);
  return { order: retailerOrder, invoice: createdInvoice.body, dispatch: dispatch.body };
}

async function createDistributorOrder(qty = 120) {
  return createOrder({
    customer: customers.distributorB,
    token: tokens.salesmanB,
    qty
  });
}

beforeEach(async () => {
  await setupBenchmarkStock();
});

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('insufficient stock, FIFO shortage planning, and IGST', () => {
  it('accepts Distributor B demand, reports the 32-packet shortage, and restricts the shortage list', async () => {
    await createRetailerDispatch();
    const movementCount = await db.stockMovement.count();
    const distributorOrder = await createDistributorOrder();
    expect(distributorOrder.status).toBe('SUBMITTED');
    expect(await db.stockMovement.count()).toBe(movementCount);

    const availability = await apiGet(
      app,
      tokens.admin,
      `/api/orders/${distributorOrder.id}/availability`
    );
    expect(availability.status).toBe(200);
    expect(availability.body).toMatchObject({
      allCovered: false,
      totalShortPackets: 32,
      message: 'Short by 32 packets of Murukku 200 g',
      lines: [{
        onHand: 88,
        free: 88,
        shortBy: 32
      }]
    });

    const summary = await apiGet(app, tokens.admin, '/api/orders/shortages');
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({
      totalShortPackets: 32,
      items: [{
        itemId: items.finished.id,
        name: 'Murukku 200 g',
        onHand: 88,
        reservedByApproved: 0,
        free: 88,
        openDemand: 120,
        totalShortPackets: 32,
        suggestedBatches: 1,
        message: 'Short by 32 packets of Murukku 200 g',
        orders: [{
          orderId: distributorOrder.id,
          orderNo: distributorOrder.orderNo,
          customerName: 'Distributor B',
          qty: 120,
          allocated: 88,
          shortBy: 32
        }]
      }]
    });
    expect((await apiGet(
      app,
      tokens.owner,
      '/api/orders/shortages'
    )).status).toBe(200);
    expect((await apiGet(
      app,
      tokens.salesmanB,
      '/api/orders/shortages'
    )).status).toBe(403);
    expect((await request(app).get('/api/orders/shortages')).status).toBe(401);
  });

  it('allocates free stock to earlier submitted orders before later demand', async () => {
    await createRetailerDispatch();
    const distributorOrder = await createDistributorOrder(120);
    const laterOrder = await createDistributorOrder(50);
    const summary = await apiGet(app, tokens.admin, '/api/orders/shortages');

    expect(summary.status).toBe(200);
    expect(summary.body.totalShortPackets).toBe(82);
    expect(summary.body.items[0].orders).toEqual([
      {
        orderId: distributorOrder.id,
        orderNo: distributorOrder.orderNo,
        customerName: 'Distributor B',
        qty: 120,
        allocated: 88,
        shortBy: 32
      },
      {
        orderId: laterOrder.id,
        orderNo: laterOrder.orderNo,
        customerName: 'Distributor B',
        qty: 50,
        allocated: 0,
        shortBy: 50
      }
    ]);
  });

  it('refuses full approval with the real Step 26 conflict shape and leaves order untouched', async () => {
    await createRetailerDispatch();
    const distributorOrder = await createDistributorOrder();
    const movementCount = await db.stockMovement.count();
    const approval = await apiPost(
      app,
      tokens.admin,
      `/api/orders/${distributorOrder.id}/approve`,
      {}
    );

    expect(approval.status).toBe(409);
    expect(approval.body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: {
        totalShortPackets: 32,
        lines: [{ onHand: 88, free: 88, shortBy: 32 }]
      }
    });
    expect((await db.order.findUnique({
      where: { id: distributorOrder.id },
      select: { status: true, invoice: { select: { id: true } } }
    }))).toMatchObject({ status: 'SUBMITTED', invoice: null });
    expect(await db.stockMovement.count()).toBe(movementCount);
  });

  it('approves only the free 88 packets and posts the correct inter-state invoice', async () => {
    await createRetailerDispatch();
    const distributorOrder = await createDistributorOrder();
    const approval = await apiPost(
      app,
      tokens.admin,
      `/api/orders/${distributorOrder.id}/approve`,
      {
        lines: [{
          lineId: distributorOrder.lines[0].lineId,
          approvedQty: 88
        }]
      }
    );
    expect(approval.status).toBe(200);
    expect(approval.body.status).toBe('APPROVED');

    const invoiceResponse = await apiPost(app, tokens.admin, '/api/invoices', {
      orderId: distributorOrder.id
    });
    expect(invoiceResponse.status).toBe(201);
    expect(invoiceResponse.body).toMatchObject({
      isInterState: true,
      placeOfSupplyStateCode: '29',
      taxableValuePaise: 440000,
      igstPaise: 22000,
      cgstPaise: 0,
      sgstPaise: 0,
      totalPaise: 462000
    });

    const dispatch = await apiPost(app, tokens.admin, '/api/dispatches', {
      invoiceId: invoiceResponse.body.id
    });
    expect(dispatch.status).toBe(201);
    expect(await getBalance(db, items.finished.id)).toBe(0);
    expect((await db.order.findUnique({
      where: { id: distributorOrder.id },
      select: { status: true }
    })).status).toBe('DISPATCHED');
  });

  it('fulfils a backorder after a real stock adjustment and invoices the full 120 packets', async () => {
    await createRetailerDispatch();
    const distributorOrder = await createDistributorOrder();
    expect((await apiGet(app, tokens.admin, '/api/orders/shortages'))
      .body.totalShortPackets).toBe(32);

    const adjustment = await apiPost(app, tokens.admin, '/api/stock/adjustments', {
      itemId: items.finished.id,
      qty: '200',
      unit: 'packet',
      direction: 'IN',
      reason: 'OTHER',
      note: 'Test production top-up'
    });
    expect(adjustment.status).toBe(201);
    expect(await getBalance(db, items.finished.id)).toBe(288);
    expect((await apiGet(app, tokens.admin, '/api/orders/shortages')).body)
      .toEqual({ items: [], totalShortPackets: 0 });

    const approval = await apiPost(
      app,
      tokens.admin,
      `/api/orders/${distributorOrder.id}/approve`,
      {}
    );
    expect(approval.status).toBe(200);
    const invoice = await apiPost(app, tokens.admin, '/api/invoices', {
      orderId: distributorOrder.id
    });
    expect(invoice.status).toBe(201);
    expect(invoice.body).toMatchObject({
      isInterState: true,
      placeOfSupplyStateCode: '29',
      taxableValuePaise: 600000,
      igstPaise: 30000,
      cgstPaise: 0,
      sgstPaise: 0,
      totalPaise: 630000,
      totalDisplay: 'Rs 6,300.00'
    });
  });

  it('keeps Retailer A invoices intra-state and calculates CGST and SGST', async () => {
    const retailerOrder = await createOrder({
      customer: customers.retailerA,
      token: tokens.salesmanA,
      qty: 150
    });
    expect((await apiPost(
      app,
      tokens.admin,
      `/api/orders/${retailerOrder.id}/approve`,
      {}
    )).status).toBe(200);
    const invoice = await apiPost(app, tokens.admin, '/api/invoices', {
      orderId: retailerOrder.id
    });
    expect(invoice.status).toBe(201);
    expect(invoice.body).toMatchObject({
      isInterState: false,
      placeOfSupplyStateCode: '33',
      taxableValuePaise: 750000,
      cgstPaise: 18750,
      sgstPaise: 18750,
      igstPaise: 0,
      totalPaise: 787500
    });
  });

  it('rejects with a reason and removes rejected demand from the shortage list', async () => {
    await createRetailerDispatch();
    const distributorOrder = await createDistributorOrder();
    expect((await apiGet(app, tokens.admin, '/api/orders/shortages'))
      .body.totalShortPackets).toBe(32);

    const rejection = await apiPost(
      app,
      tokens.admin,
      `/api/orders/${distributorOrder.id}/reject`,
      { reason: 'Wait for next production' }
    );
    expect(rejection.status).toBe(200);
    expect(rejection.body.status).toBe('REJECTED');
    expect(await getReservedPackets(db, items.finished.id)).toBe(0);
    expect((await apiGet(app, tokens.admin, '/api/orders/shortages')).body)
      .toEqual({ items: [], totalShortPackets: 0 });
  });
});
